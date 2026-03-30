/**
 * history.js — Persistencia de análisis de cuadrícula en disco.
 *
 * Guarda cada análisis en analysis_history.json dentro del directorio del backend.
 * Formato del fichero: array de entradas, de más antiguo a más reciente.
 *
 * Entrada:
 *   { id, timestamp, center: { lat, lon }, radius, cellM, cells: [...] }
 *
 * Una "cell" tiene al menos: { lat, lon, canFly, score, maxAllowedHeight?, reasons? }
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH   = path.join(__dirname, 'analysis_history.json');
const MAX_ENTRIES    = 200; // límite para que el fichero no crezca indefinidamente

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[HISTORY] Error leyendo historial:', e.message);
    return [];
  }
}

function writeHistory(history) {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('[HISTORY] Error escribiendo historial:', e.message);
    throw e;
  }
}

/**
 * Combina las celdas de todos los análisis en un único array flat.
 * Si una celda (misma lat/lon redondeada a 5 decimales) aparece en varios
 * análisis, se conserva la del análisis más reciente.
 */
export function mergeAllCells(history) {
  const map = new Map();
  for (const entry of history) {
    for (const cell of entry.cells ?? []) {
      const key = `${cell.lat.toFixed(5)},${cell.lon.toFixed(5)}`;
      map.set(key, cell);
    }
  }
  return Array.from(map.values());
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Devuelve todo el historial.
 */
export function getHistory() {
  return readHistory();
}

/**
 * Añade un análisis al historial y lo persiste en disco.
 * @param {{ center: {lat,lon}, radius: number, cellM: number, cells: Array }} analysis
 * @returns {{ id: number, timestamp: string }} entry guardada (sin cells para ahorrar ancho de banda)
 */
export function addAnalysis(analysis) {
  const history = readHistory();
  const entry = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    center:    analysis.center,
    radius:    analysis.radius,
    cellM:     analysis.cellM,
    cells:     analysis.cells,
  };

  // Limitar tamaño: si supera MAX_ENTRIES eliminamos las más antiguas
  const updated = [...history, entry].slice(-MAX_ENTRIES);
  writeHistory(updated);
  console.log(`[HISTORY] Guardado análisis #${entry.id} (${entry.cells?.length ?? 0} celdas). Total entradas: ${updated.length}`);
  return { id: entry.id, timestamp: entry.timestamp };
}

/**
 * Elimina todo el historial.
 */
export function clearHistory() {
  writeHistory([]);
  console.log('[HISTORY] Historial borrado.');
}
