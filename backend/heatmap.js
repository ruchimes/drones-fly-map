/**
 * heatmap.js — Generación de rejilla y análisis por punto para el heatmap.
 */

import { ENAIRE_LAYERS }       from './enaireLayers.js';
import { getElevationLocal }   from './elevation.js';
import { queryEnaireLayer, queryNotamLayer, normalizeFeature } from './enaire.js';
import { filterRestrictiveZones, analyzeFlightPermission }     from './analyze.js';

// ─── Elevación ────────────────────────────────────────────────────────────────

async function getElevation(lat, lon) {
  try { return await getElevationLocal(lat, lon); }
  catch { return null; }
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

/**
 * Genera coordenadas centrales de una rejilla de celdas de `cellM` metros
 * que cubre el área de `radiusKm` km alrededor de (lat, lon).
 */
export function buildGrid(lat, lon, radiusKm, cellM = 100) {
  const cellKm  = cellM / 1000;
  const halfLat = radiusKm / 111;
  const halfLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const stepLat = cellKm  / 111;
  const stepLon = cellKm  / (111 * Math.cos((lat * Math.PI) / 180));

  const cells = [];
  let row = 0;
  for (let dlat = halfLat - stepLat / 2; dlat > -halfLat; dlat -= stepLat, row++) {
    let col = 0;
    for (let dlon = -halfLon + stepLon / 2; dlon < halfLon; dlon += stepLon, col++) {
      cells.push({ lat: lat + dlat, lon: lon + dlon, rowIdx: row, colIdx: col });
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

  const zones           = [...layerResults, notamResult].flatMap(r => r.features.map(f => normalizeFeature(f, r.layer)));
  const restrictiveZones = filterRestrictiveZones(zones);
  const result           = analyzeFlightPermission(restrictiveZones, zones, terrainElevation);

  return {
    canFly:           result.canFly,
    maxAllowedHeight: result.maxAllowedHeight,
    terrainElevation,
    reasons:          result.reasons || [],
    zoneNames:        restrictiveZones.map(z => z.name || z.attributes?.identifier || '?'),
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
