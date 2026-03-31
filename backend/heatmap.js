/**
 * heatmap.js — Generación de rejilla y análisis por punto para el heatmap.
 */

import { ENAIRE_LAYERS }       from './enaireLayers.js';
import { queryEnaireLayer, queryNotamLayer, normalizeFeature } from './enaire.js';
import { filterRestrictiveZones, analyzeFlightPermission }     from './analyze.js';

// Latitud de referencia fija para calcular stepLon.
// Usar una constante garantiza que la rejilla global sea idéntica
// independientemente del centro de cada análisis.
// 40.0° cubre bien la Península; Canarias (~28°) tiene error <3% en lon → aceptable.
const GRID_REF_LAT = 40.0;

/**
 * Genera coordenadas centrales de una rejilla de celdas de `cellM` metros
 * usando una cuadrícula GLOBAL FIJA anclada en (0, 0) con pasos constantes.
 *
 * Tanto stepLat como stepLon son constantes (no dependen del centro del
 * análisis), por lo que dos análisis solapados producen exactamente las
 * mismas coordenadas de celda → sin solapamiento visual ni en el historial.
 */
export function buildGrid(lat, lon, radiusKm, cellM = 100) {
  const cellKm  = cellM / 1000;
  const stepLat = cellKm / 111;
  const stepLon = cellKm / (111 * Math.cos((GRID_REF_LAT * Math.PI) / 180));

  // Límites de la zona a cubrir
  const halfLat = radiusKm / 111;
  const halfLon = radiusKm / (111 * Math.cos((GRID_REF_LAT * Math.PI) / 180));

  const minLat = lat - halfLat;
  const maxLat = lat + halfLat;
  const minLon = lon - halfLon;
  const maxLon = lon + halfLon;

  // Primer centro de celda alineado a la rejilla global
  const startLat = Math.ceil(minLat / stepLat) * stepLat;
  const startLon = Math.ceil(minLon / stepLon) * stepLon;

  const cells = [];
  let row = 0;
  for (let clat = startLat; clat < maxLat; clat += stepLat, row++) {
    let col = 0;
    for (let clon = startLon; clon < maxLon; clon += stepLon, col++) {
      cells.push({ lat: clat, lon: clon, rowIdx: row, colIdx: col });
    }
  }
  return cells;
}

// ─── Análisis de punto ────────────────────────────────────────────────────────

/**
 * Analiza un único punto con radio `cellM/2` metros.
 * Si se pasa `precomputedElevation` se usa directamente.
 */
export async function analyzePoint(lat, lon, cellM = 100, precomputedElevation = undefined) {
  const radiusKm = (cellM / 2) / 1000;

  const elevationPromise = precomputedElevation !== undefined
    ? Promise.resolve(precomputedElevation)
    : getElevation(lat, lon);

  const [layerResults, notamResult, terrainElevation] = await Promise.all([
    Promise.all(ENAIRE_LAYERS.map(layer => queryEnaireLayer(layer, { lat, lon, radiusKm }))),
    queryNotamLayer({ lat, lon, radiusKm }),
    elevationPromise,
  ]);

  // Si alguna capa falló, la celda no es fiable — marcarla como error
  const allResults = [...layerResults, notamResult];
  const hadFetchError = allResults.some(r => r.fetchError);

  const zones            = allResults.flatMap(r => r.features.map(f => normalizeFeature(f, r.layer)));
  const restrictiveZones = filterRestrictiveZones(zones);
  const result           = analyzeFlightPermission(restrictiveZones, zones, terrainElevation);

  return {
    canFly:           result.canFly,
    maxAllowedHeight: result.maxAllowedHeight,
    terrainElevation,
    reasons:          result.reasons || [],
    zoneNames:        restrictiveZones.map(z => z.name || z.attributes?.identifier || '?'),
    fetchError:       hadFetchError,
  };
}

// ─── Concurrencia ─────────────────────────────────────────────────────────────

/** Ejecuta tareas asíncronas con concurrencia máxima `limit`. */
export async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
