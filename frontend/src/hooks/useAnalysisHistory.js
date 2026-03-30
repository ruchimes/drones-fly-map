/**
 * useAnalysisHistory
 *
 * Persistencia de análisis de cuadrícula en el BACKEND (fichero JSON en servidor).
 * Así el historial es accesible desde cualquier dispositivo.
 *
 * Entrada de historial:
 *   { id, timestamp, center: { lat, lon }, radius, cellM, cells: [...] }
 *
 * Endpoints usados:
 *   GET    /api/history         → devuelve { history: [...] }
 *   GET    /api/history/merged  → devuelve { cells: [...], totalAnalyses: N }
 *   POST   /api/history         → body: { center, radius, cellM, cells }
 *   DELETE /api/history         → borra todo
 */

import { useState, useCallback, useEffect } from 'react';
import API_BASE from '../api';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalysisHistory() {
  // Solo guardamos el count de entradas para saber si hay historial
  // (evitamos cargar todas las celdas en memoria hasta que se necesiten)
  const [entryCount, setEntryCount] = useState(0);

  // Al montar, comprueba si hay entradas en el backend
  useEffect(() => {
    fetch(`${API_BASE}/api/history`)
      .then(r => r.json())
      .then(data => setEntryCount(data.history?.length ?? 0))
      .catch(() => {}); // silencioso — no bloquea la UI
  }, []);

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
      if (res.ok) {
        setEntryCount(prev => prev + 1);
      } else {
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

  /**
   * Elimina todo el historial en el backend.
   */
  const clearHistory = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/history`, { method: 'DELETE' });
      setEntryCount(0);
    } catch (e) {
      console.warn('[AnalysisHistory] Error borrando historial:', e.message);
    }
  }, []);

  return {
    hasSavedAnalyses: entryCount > 0,
    saveAnalysis,
    getMergedCells,
  };
}
