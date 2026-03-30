/**
 * useAnalysisHistory
 *
 * Persistencia de análisis de cuadrícula en el BACKEND (MongoDB Atlas).
 *
 * Entrada de historial:
 *   { id, timestamp, center: { lat, lon }, radius, cellM, cells: [...] }
 *
 * Endpoints usados:
 *   GET    /api/history/merged  → devuelve { cells: [...], totalAnalyses: N }
 *   POST   /api/history         → body: { center, radius, cellM, cells }
 */

import { useCallback } from 'react';
import API_BASE from '../api';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalysisHistory() {

  /**
   * Guarda un nuevo análisis en el backend.
   * @param {{ center: {lat,lon}, radius: number, cellM: number, cells: Array }} analysis
   */
  const saveAnalysis = useCallback(async ({ center, radius, cellM, cells }) => {
    if (!cells?.length) return;
    try {
      const res = await fetch(`${API_BASE}/api/history`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ center, radius, cellM, cells }),
      });
      if (!res.ok) {
        console.warn('[AnalysisHistory] Error guardando análisis:', await res.text());
      }
    } catch (e) {
      console.warn('[AnalysisHistory] No se pudo conectar con el backend:', e.message);
    }
  }, []);

  /**
   * Obtiene del backend todas las celdas de todos los análisis, deduplicadas.
   * @returns {Promise<Array>}
   */
  const getMergedCells = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/history/merged`);
      const data = await res.json();
      return data.cells ?? [];
    } catch (e) {
      console.warn('[AnalysisHistory] Error cargando historial:', e.message);
      return [];
    }
  }, []);

  return {
    saveAnalysis,
    getMergedCells,
  };
}
