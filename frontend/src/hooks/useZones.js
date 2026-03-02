import { useState, useCallback } from 'react';

/**
 * Gestiona la consulta de zonas ENAIRE y el estado derivado (canFly, reasons, etc.).
 * Tanto el click en el mapa como la búsqueda por texto comparten esta lógica.
 */
export function useZones(radius) {
  const [location, setLocation]   = useState(null);
  const [zones, setZones]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [summary, setSummary]     = useState(null); // { canFly, reasons, maxAllowedHeight }

  const clearSummary = useCallback(() => setSummary(null), []);

  /** Consulta /api/zones para unas coordenadas dadas y actualiza el estado. */
  const fetchZones = useCallback(async (lat, lon) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/zones?lat=${lat}&lon=${lon}&radius=${radius}`);
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
      const geoRes = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
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
    setLocation({ lat, lon: lng });
    fetchZones(lat, lng);
  }, [fetchZones]);

  return { location, setLocation, zones, loading, summary, setSummary, clearSummary, handleMapClick, fetchByAddress };
}
