import { useState, useCallback } from 'react';
import API_BASE from '../api';

/**
 * Gestiona la consulta de zonas ENAIRE y el estado derivado (canFly, reasons, etc.).
 * Tanto el click en el mapa como la búsqueda por texto comparten esta lógica.
 */
export function useZones(radius, cellClickedRef) {
  const [location, setLocation]   = useState(null);
  const [zones, setZones]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [summary, setSummary]     = useState(null); // { canFly, reasons, maxAllowedHeight }

  const clearSummary = useCallback(() => setSummary(null), []);

  /** Consulta /api/zones para unas coordenadas dadas y actualiza el estado. */
  const fetchZones = useCallback(async (lat, lon) => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/zones?lat=${lat}&lon=${lon}&radius=${radius}`);
      const data = await res.json();
      setZones(Array.isArray(data.zones) ? data.zones : []);
      setSummary({ canFly: data.canFly, reasons: data.reasons, maxAllowedHeight: data.maxAllowedHeight });
    } catch {
      setZones([]);
      setSummary({ canFly: null, reasons: ['Error al cargar zonas'], maxAllowedHeight: null });
    } finally {
      setLoading(false);
    }
  }, [radius]);

  /** Geocodifica una dirección y luego consulta zonas. */
  const fetchByAddress = useCallback(async (address) => {
    try {
      const geoRes = await fetch(`${API_BASE}/api/geocode?address=${encodeURIComponent(address)}`);
      if (!geoRes.ok) throw new Error('Geocoding failed');
      const { location: loc } = await geoRes.json();
      setLocation({ lat: loc.lat, lon: loc.lon });
      await fetchZones(loc.lat, loc.lon); // fetchZones gestiona loading por sí solo
    } catch {
      setZones([]);
      setSummary(null);
      throw new Error('No se pudo encontrar la dirección o zonas.');
    }
  }, [fetchZones]);

  /** Handler para el click en el mapa (recibe latlng de Leaflet). */
  const handleMapClick = useCallback(({ lat, lng }) => {
    const now = Date.now();
    const diff = now - (cellClickedRef?.current || 0);
    console.log('[ZONES] handleMapClick fired, diff=', diff, 'ms, ref=', cellClickedRef?.current);
    // Si han pasado menos de 600ms desde un click en celda/marker, ignorar
    if (cellClickedRef?.current && diff < 600) {
      console.log('[ZONES] ignorado por cellClickedRef');
      return;
    }
    setLocation({ lat, lon: lng });
    fetchZones(lat, lng);
  }, [fetchZones, cellClickedRef]);

  return { location, setLocation, zones, loading, summary, setSummary, clearSummary, handleMapClick, fetchByAddress };
}
