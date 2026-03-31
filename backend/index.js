/**
 * index.js — Servidor Express. Solo rutas y arranque.
 * La lógica está dividida en: patterns.js, enaire.js, analyze.js, heatmap.js
 */
import './env.js';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { getElevationLocal, getElevationBatchLocal } from './elevation.js';
import { queryAllLayers, saveEnaireLog } from './enaire.js';
import { filterRestrictiveZones, analyzeFlightPermission } from './analyze.js';
import { buildGrid, analyzePoint, pLimit } from './heatmap.js';
import { checkUrban } from './urban.js';
import { getHistory, addAnalysis, clearHistory, clearCellsInArea, mergeAllCells, connectDB } from './history.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PORT         = process.env.PORT || 4000;
const RADIUS_MIN_M = 100;
const RADIUS_MAX_M = 1000;

// ─── Elevación ────────────────────────────────────────────────────────────────

async function getElevation(lat, lon) {
  try { return await getElevationLocal(lat, lon); }
  catch { return null; }
}

async function getElevationBatch(coords) {
  try { return await getElevationBatchLocal(coords); }
  catch (err) {
    console.warn(`[ELEVACIÓN BATCH] Error: ${err.message}`);
    return new Array(coords.length).fill(null);
  }
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // necesario para recibir el body con las celdas

// ─── GET /api/health ──────────────────────────────────────────────────────────
// Render lo usa para comprobar que el servicio está activo.

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── GET /api/geocode ─────────────────────────────────────────────────────────

app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address required' });

  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'drones-app/1.0' },
    });

    if (!data.length) return res.status(404).json({ error: 'Not found' });

    const { lat, lon, display_name } = data[0];
    res.json({ location: { lat: parseFloat(lat), lon: parseFloat(lon), name: display_name } });
  } catch {
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// ─── GET /api/heatmap ────────────────────────────────────────────────────────
//
// Streaming via Server-Sent Events (SSE).
// Envía eventos durante el análisis:
//   event: progress  data: { done, total }
//   event: result    data: { cellM, radiusKm, rows, cols, cells }
//   event: error     data: { error }
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/heatmap', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat/lon requeridos' });
  }

  const radiusKm    = Math.min(2,   Math.max(0.1, parseFloat(req.query.radiusKm   || 1)));
  const cellM       = Math.min(500, Math.max(50,  parseInt(req.query.cellM        || 100, 10)));
  const concurrency = Math.min(30,  Math.max(1,   parseInt(req.query.concurrency  || 15,  10)));

  const grid = buildGrid(lat, lon, radiusKm, cellM);

  // ── Cargar celdas ya analizadas desde el historial (MongoDB) ──────────────
  let knownCellsMap = new Map();
  try {
    const history = await getHistory();
    for (const entry of history) {
      for (const c of entry.cells ?? []) {
        const key = `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
        knownCellsMap.set(key, c);
      }
    }
  } catch (e) {
    console.warn('[HEATMAP] No se pudo cargar historial para caché:', e.message);
  }

  // Separar celdas nuevas de celdas ya conocidas
  const newGrid   = grid.filter(c => !knownCellsMap.has(`${c.lat.toFixed(6)},${c.lon.toFixed(6)}`));
  const skipCount = grid.length - newGrid.length;
  const total     = newGrid.length;

  console.log(`[HEATMAP] ${grid.length} celdas totales — ${skipCount} ya analizadas, ${total} nuevas (radio ${radiusKm}km, celda ${cellM}m)`);

  // ── Cabeceras SSE ──
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Si todas las celdas ya estaban analizadas, devolver resultado inmediatamente
    if (total === 0) {
      const knownCells = grid.map(c => knownCellsMap.get(`${c.lat.toFixed(6)},${c.lon.toFixed(6)}`));
      const rows = Math.max(...knownCells.map(c => c.rowIdx)) + 1;
      const cols = Math.max(...knownCells.map(c => c.colIdx)) + 1;
      console.log('[HEATMAP] Todas las celdas ya estaban analizadas — devolviendo caché.');
      send('result', { cellM, radiusKm, rows, cols, cells: knownCells, fromCache: true });
      res.end();
      return;
    }

    // ── Elevaciones en batch solo para las celdas nuevas ──
    console.log(`[HEATMAP] Consultando elevaciones batch para ${total} celdas nuevas…`);
    send('progress', { phase: 'elevaciones', done: 0, total });
    let elevations;
    try {
      elevations = await getElevationBatch(newGrid.map(c => ({ lat: c.lat, lon: c.lon })));
    } catch (elevErr) {
      console.warn(`[HEATMAP] Error en elevaciones batch: ${elevErr.message}. Usando null.`);
      elevations = new Array(total).fill(null);
    }
    const elevNull = elevations.filter(e => e === null).length;
    console.log(`[HEATMAP] Elevaciones obtenidas: ${total - elevNull}/${total} (${elevNull} nulas)`);

    let done = 0;
    const newCells = new Array(total);

    const tasks = newGrid.map((cell, i) => async () => {
      const result = await analyzePoint(cell.lat, cell.lon, cellM, elevations[i]);
      newCells[i] = {
        lat:              cell.lat,
        lon:              cell.lon,
        rowIdx:           cell.rowIdx,
        colIdx:           cell.colIdx,
        canFly:           result.canFly,
        maxAllowedHeight: result.maxAllowedHeight,
        terrainElevation: result.terrainElevation,
        reasons:          result.reasons,
        zoneNames:        result.zoneNames,
        fetchError:       result.fetchError || false,
      };
      done++;
      send('progress', { done, total });
      if (done % 20 === 0 || done === total) {
        console.log(`[HEATMAP] Progreso: ${done}/${total}`);
      }
    });

    await pLimit(tasks, concurrency);

    // Construir mapa de nuevas celdas para lookup rápido
    const newCellsMap = new Map(newCells.map(c => [`${c.lat.toFixed(6)},${c.lon.toFixed(6)}`, c]));

    // Combinar: para cada celda de la grid, usar la nueva o la del caché
    const allCells = grid.map(c => {
      const key = `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
      return knownCellsMap.get(key) ?? newCellsMap.get(key);
    });

    const errorCount = newCells.filter(c => c.fetchError).length;
    if (errorCount > 0) {
      console.warn(`[HEATMAP] ${errorCount} celdas con error de ENAIRE — no se guardarán en historial`);
    }

    const rows = Math.max(...allCells.map(c => c.rowIdx)) + 1;
    const cols = Math.max(...allCells.map(c => c.colIdx)) + 1;

    console.log(`[HEATMAP] Completado. ${rows}×${cols} grid. Nuevas: ${total}, Caché: ${skipCount}, Errores: ${errorCount}`);
    send('result', { cellM, radiusKm, rows, cols, cells: allCells, newCount: total, cachedCount: skipCount, errorCount });
    res.end();

  } catch (err) {
    console.error('[HEATMAP] Error:', err);
    send('error', { error: err.message });
    res.end();
  }
});

// ─── GET /api/zones ───────────────────────────────────────────────────────────

app.get('/api/zones', async (req, res) => {
  const { lat, lon, radius } = req.query;

  console.log('--- Nueva consulta /api/zones ---');
  console.log('Parámetros:', { lat, lon, radius });

  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });

  const radiusKm = radius
    ? Math.max(RADIUS_MIN_M, Math.min(RADIUS_MAX_M, parseInt(radius, 10))) / 1000
    : 1;

  try {
    const [{ zones, allResults }, terrainElevation, urbanInfo] = await Promise.all([
      queryAllLayers({ lat: parseFloat(lat), lon: parseFloat(lon), radiusKm }),
      getElevation(parseFloat(lat), parseFloat(lon)),
      checkUrban(parseFloat(lat), parseFloat(lon)),
    ]);

    if (terrainElevation !== null) {
      console.log(`[ELEVACIÓN] Terreno: ${terrainElevation}m AMSL`);
    } else {
      console.log('[ELEVACIÓN] No disponible (se usará lógica sin elevación)');
    }
    console.log(`[URBAN] isUrban=${urbanInfo.isUrban} (${urbanInfo.confidence}) — ${urbanInfo.reason}`);

    saveEnaireLog({ lat, lon, radius: radiusKm, urban: { isUrban: urbanInfo.isUrban, confidence: urbanInfo.confidence, reason: urbanInfo.reason } }, allResults);

    console.log(`Total zonas: ${zones.length}`);
    zones.forEach(z =>
      console.log(`  [ZONA] ${z.layer} | ${z.name} | "${(z.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}..."`),
    );

    const restrictiveZones = filterRestrictiveZones(zones);
    console.log(
      `Zonas restrictivas: ${restrictiveZones.length} / informativas: ${zones.length - restrictiveZones.length}`,
    );

    const result = analyzeFlightPermission(restrictiveZones, zones, terrainElevation);
    console.log('Resultado final:', { canFly: result.canFly, maxAllowedHeight: result.maxAllowedHeight, reasons: result.reasons });
    return res.json({ ...result, urban: urbanInfo });

  } catch (err) {
    console.error('Error en /api/zones:', err);
    res.status(500).json({ error: 'ENAIRE query failed', details: err.message });
  }
});

// ─── GET /api/history ─────────────────────────────────────────────────────────
// Devuelve el historial completo (todas las entradas con sus celdas).

app.get('/api/history', async (_req, res) => {
  try {
    const history = await getHistory();
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo historial', details: err.message });
  }
});

// ─── GET /api/history/merged ──────────────────────────────────────────────────
// Devuelve todas las celdas de todos los análisis deduplicadas (para el heatmap unificado).

app.get('/api/history/merged', async (_req, res) => {
  try {
    const history = await getHistory();
    const cells   = mergeAllCells(history);
    res.json({ cells, totalAnalyses: history.length });
  } catch (err) {
    res.status(500).json({ error: 'Error leyendo historial', details: err.message });
  }
});

// ─── POST /api/history ────────────────────────────────────────────────────────
// Guarda un nuevo análisis.
// Body: { center: {lat, lon}, radius, cellM, cells: [...] }

app.post('/api/history', async (req, res) => {
  try {
    const { center, radius, cellM, cells } = req.body;
    if (!cells?.length) return res.status(400).json({ error: 'cells requerido' });
    if (!center?.lat || !center?.lon) return res.status(400).json({ error: 'center requerido' });
    const saved = await addAnalysis({ center, radius, cellM, cells });
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: 'Error guardando análisis', details: err.message });
  }
});

// ─── DELETE /api/history ──────────────────────────────────────────────────────
// Borra todo el historial.

app.delete('/api/history', async (_req, res) => {
  try {
    await clearHistory();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando historial', details: err.message });
  }
});

// ─── DELETE /api/history/area ─────────────────────────────────────────────────
// Borra las celdas de un área circular (lat, lon, radiusKm) de todos los análisis.
// Query params: lat, lon, radiusKm (por defecto 2km)

app.delete('/api/history/area', async (req, res) => {
  const lat     = parseFloat(req.query.lat);
  const lon     = parseFloat(req.query.lon);
  const radiusKm = parseFloat(req.query.radiusKm ?? 2);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat y lon son requeridos' });
  }

  // Construir bbox a partir del radio
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };

  try {
    const result = await clearCellsInArea(bbox);
    console.log(`[DELETE /api/history/area] lat=${lat} lon=${lon} radio=${radiusKm}km →`, result);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Error borrando celdas del área', details: err.message });
  }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
