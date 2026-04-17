// Capas del servicio ArcGIS de ENAIRE para restricciones de drones.
// Estructura actualizada según los servicios activos de drones.enaire.es (abril 2026).
// Cada capa tiene su propio servicio y, opcionalmente, un filtro WHERE de altitud.

const BASE = 'https://servais.enaire.es/insignias/rest/services';

export const ENAIRE_LAYERS = [
  // ── Zonas aeronáuticas (Drones_ZG_Aero_V3) ──────────────────────────────
  { service: `${BASE}/NSF/Drones_ZG_Aero_V3/MapServer`,   id: 1,  name: 'CTR/ATZ Aeropuertos' },
  { service: `${BASE}/NSF/Drones_ZG_Aero_V3/MapServer`,   id: 2,  name: 'Zonas prohibidas',           where: 'RESTRICCION_LOWER < 120' },
  { service: `${BASE}/NSF/Drones_ZG_Aero_V3/MapServer`,   id: 3,  name: 'Zonas restringidas' },
  { service: `${BASE}/NSF/Drones_ZG_Aero_V3/MapServer`,   id: 6,  name: 'Zonas militares' },
  { service: `${BASE}/NSF/Drones_ZG_Aero_V3/MapServer`,   id: 10, name: 'Zonas UAS particulares',      where: 'RESTRICCION_LOWER < 120' },
  // ── Infraestructuras (Drones_ZG_Infra_V0) ───────────────────────────────
  { service: `${BASE}/NSF/Drones_ZG_Infra_V0/MapServer`,  id: 11, name: 'Zonas de infraestructuras',   where: 'RESTRICCION_LOWER < 120' },
  // ── Espacios Naturales Protegidos (ENP_APP_Local_V4) ────────────────────
  { service: `${BASE}/ENP/ENP_APP_Local_V4/MapServer`,    id: 0,  name: 'Espacios Naturales Protegidos' },
  { service: `${BASE}/ENP/ENP_APP_Local_V4/MapServer`,    id: 1,  name: 'Espacios Naturales Protegidos (local)' },
  // ── Zonas urbanas UAS (Drones_ZG_Urbano_V0) ─────────────────────────────
  { service: `${BASE}/NSF/Drones_ZG_Urbano_V0/MapServer`, id: 11, name: 'Zonas urbanas UAS' },
];
