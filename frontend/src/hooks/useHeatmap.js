import { useState, useCallback, useRef } from 'react';

/**
 * Hook para el análisis de cuadrícula de vuelo (heatmap).
 *
 * Expone:
 *   heatmap        — { cellM, rows, cols, cells } | null
 *   heatmapLoading — boolean
 *   heatmapError   — string | null
 *   heatmapCenter  — { lat, lon } | null
 *   progress       — { done, total } | null  (actualizado en tiempo real via SSE)
 *   fetchHeatmap(lat, lon, options) — lanza la consulta
 *   clearHeatmap() — limpia el resultado
 */
export function useHeatmap() {
  const [heatmap, setHeatmap]       = useState(null);
  const [heatmapLoading, setLoading] = useState(false);
  const [heatmapError, setError]    = useState(null);
  const [heatmapCenter, setCenter]  = useState(null);
  const [progress, setProgress]     = useState(null); // { phase, done, total }
  const esRef                       = useRef(null);   // EventSource activo

  const clearHeatmap = useCallback(() => {
    esRef.current?.close();
    setHeatmap(null);
    setError(null);
    setCenter(null);
    setProgress(null);
  }, []);

  /**
   * Abre un SSE a /api/heatmap y va actualizando progress hasta recibir el resultado.
   */
  const fetchHeatmap = useCallback((lat, lon, options = {}) => {
    // Cerrar SSE anterior si existe
    esRef.current?.close();

    const { radiusKm = 1, cellM = 100, concurrency = 15 } = options;

    setLoading(true);
    setError(null);
    setHeatmap(null);
    setCenter({ lat, lon });
    setProgress(null);

    const url = `/api/heatmap?lat=${lat}&lon=${lon}&radiusKm=${radiusKm}&cellM=${cellM}&concurrency=${concurrency}`;
    const es  = new EventSource(url);
    esRef.current = es;

    es.addEventListener('progress', e => {
      const { phase, done, total } = JSON.parse(e.data);
      setProgress({ phase, done, total });
    });

    es.addEventListener('result', e => {
      const data = JSON.parse(e.data);
      setHeatmap(data);
      setProgress({ done: data.cells.length, total: data.cells.length });
      setLoading(false);
      es.close();
    });

    es.addEventListener('error', e => {
      // e.data existe si es nuestro evento 'error', si no es un fallo de conexión
      const msg = e.data ? JSON.parse(e.data).error : 'Error de conexión con el servidor';
      setError(msg);
      setLoading(false);
      es.close();
    });
  }, []);

  return {
    heatmap,
    heatmapLoading,
    heatmapError,
    heatmapCenter,
    progress,
    fetchHeatmap,
    clearHeatmap,
  };
}
