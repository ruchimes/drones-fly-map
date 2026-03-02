
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENAIRE_LAYERS } from './enaireLayers.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH  = path.join(__dirname, 'enaire_zones_log.json');
const PORT      = process.env.PORT || 4000;

const ARCGIS_BASE =
  'https://servais.enaire.es/insignia/rest/services/NSF_SRV/SRV_UAS_ZG_V1/MapServer';

const RADIUS_MIN_M = 100;
const RADIUS_MAX_M = 1000;

// ─── Patrones de restricción ──────────────────────────────────────────────────

/** Vuelo prohibido de forma absoluta */
const FORBIDDEN_PATTERNS = [
  /no\s+(est[aá]\s+)?permitido\s+el\s+vuelo\s+(a|de)\s+(drones?|uas|rpas)/i,
  /vuelo\s+(a|de)\s+(drones?|uas|rpas)\s+(no\s+)?permitido/i,
  /prohibido\s+el\s+vuelo\s+(a|de)\s+(drones?|uas|rpas)/i,
  /prohibido\s+el\s+vuelo/i,
  /no\s+(est[aá]\s+)?permitido\s+el\s+vuelo/i,
];

/** Vuelo fotográfico / captación de datos restringido */
const PHOTO_FLIGHT_PATTERNS = [
  /restringida al vuelo fotogr[aá]fico/i,
  /restringida al vuelo de fotograf[ií]a/i,
  /restringida al vuelo para fotograf[ií]a/i,
  /restringida al vuelo de captaci[oó]n de datos/i,
  /restringida al vuelo de imagen/i,
  /restringida al vuelo de c[aá]maras/i,
];

/** Avisos meramente informativos — no restringen el vuelo */
const INFO_ONLY_PATTERNS = [
  /antes de volar compruebe si la zona.*entorno urbano/is,
];

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Elimina etiquetas HTML y normaliza espacios en blanco */
const stripHtml = str => str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Devuelve el texto combinado (message + warning) de una zona, sin HTML y en minúsculas */
const zoneText = zone =>
  stripHtml(`${zone.message || ''} ${zone.warning || ''}`).toLowerCase();

/** true si alguno de los patrones coincide con el texto */
const matchesAny = (patterns, text) => patterns.some(p => p.test(text));

// ─── Log ──────────────────────────────────────────────────────────────────────

/** Convierte un feature ArcGIS al formato compacto que se guarda en el log */
function featureToLogEntry(feature) {
  const a = feature.attributes || {};
  const rawMsg = a.message || a.DESCRIPCION || a.description || '';
  return {
    identifier: a.identifier || a.NOMBRE || a.name || null,
    name:       a.name_authority || a.provider || a.originator || null,
    type:       a.type || null,
    lower:      a.lower != null ? `${a.lower}${a.uom || 'm'} ${a.lowerReference || ''}`.trim() : null,
    upper:      a.upper != null ? `${a.upper}${a.uom || 'm'} ${a.upperReference || ''}`.trim() : null,
    message:    stripHtml(rawMsg) || null,
  };
}

/**
 * Sobreescribe el fichero de log con las zonas de la última consulta.
 * Solo incluye capas con features; omite geometría y HTML.
 */
function saveEnaireLog(query, results) {
  try {
    const layers = results
      .filter(r => r.features.length > 0)
      .map(r => ({
        layer:        r.layer,
        featureCount: r.features.length,
        zones:        r.features.map(featureToLogEntry),
      }));

    fs.writeFileSync(
      LOG_PATH,
      JSON.stringify([{ timestamp: new Date().toISOString(), query, layers }], null, 2),
      'utf-8',
    );
    console.log(`[LOG] Zonas ENAIRE guardadas en ${LOG_PATH}`);
  } catch (err) {
    console.warn('[LOG] Error guardando log:', err.message);
  }
}

// ─── Normalización de features ────────────────────────────────────────────────

/**
 * Convierte un feature ArcGIS a un objeto de zona normalizado.
 * Geometría: rings [[lon,lat]] → [[lat,lon]] (formato Leaflet).
 */
function normalizeFeature(feature, layerName) {
  const a = feature.attributes || {};

  const name       = a.NOMBRE || a.nombre || a.NAME || a.name || a.identifier || layerName;
  const message    = a.message || a.DESCRIPCION || a.descripcion || a.DESCRIPTION || a.description || a.OBSERVACIONES || '';
  const warning    = a.warning || a.ADVERTENCIA || a.advertencia || a.WARNING || '';
  const prohibited = a.PROHIBIDO === 'SI' || a.prohibited === true;

  let geometry = null;
  if (feature.geometry?.rings?.length > 0) {
    geometry = feature.geometry.rings[0].map(([lon, lat]) => [lat, lon]);
  }

  return { name, layer: layerName, message, warning, prohibited, attributes: a, geometry };
}

// ─── Consulta ENAIRE ─────────────────────────────────────────────────────────

/** Lanza la query ArcGIS para una capa y devuelve { layer, features }. Nunca rechaza. */
async function queryEnaireLayer(layer, { lat, lon, radiusKm }) {
  try {
    const { data } = await axios.get(`${ARCGIS_BASE}/${layer.id}/query`, {
      params: {
        geometry:     `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        spatialRel:   'esriSpatialRelIntersects',
        distance:     radiusKm,
        units:        'esriSRUnit_Kilometer',
        outFields:    '*',
        f:            'json',
        inSR:         4326,
      },
    });
    const features = data.features || [];
    console.log(`[ENAIRE] ${layer.name} (${layer.id}): ${features.length} features`);
    return { layer: layer.name, features };
  } catch (err) {
    console.warn(`[ENAIRE] Error en capa ${layer.name} (${layer.id}):`, err.message);
    return { layer: layer.name, features: [] };
  }
}

// ─── Lógica de vuelo ──────────────────────────────────────────────────────────

const FREE_FLIGHT = {
  canFly:           true,
  maxAllowedHeight: 120,
  reasons:          ['No hay restricciones activas en la zona. Permitido hasta 120m.'],
  zones:            [],
};

/**
 * Analiza un array de zonas restrictivas y devuelve el resultado de vuelo.
 * No incluye las zonas informativas (ya filtradas antes de llamar aquí).
 * @param {object[]} restrictiveZones
 * @param {object[]} allZones  — todas las zonas, para incluirlas en la respuesta al frontend
 * @returns {{ canFly, maxAllowedHeight, reasons, zones }}
 */
function analyzeFlightPermission(restrictiveZones, allZones) {
  // Sin restricciones
  if (restrictiveZones.length === 0) return FREE_FLIGHT;

  // Bloqueo por restricción fotográfica
  const photoBlocked = restrictiveZones.filter(z => matchesAny(PHOTO_FLIGHT_PATTERNS, zoneText(z)));
  if (photoBlocked.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons:          photoBlocked.map(z => `Bloqueo por restricción fotográfica: ${z.name}`),
      zones:            allZones,
    };
  }

  // Prohibición absoluta
  const forbidden = restrictiveZones.filter(z => matchesAny(FORBIDDEN_PATTERNS, zoneText(z)));
  if (forbidden.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons:          forbidden.map(z => `Prohibido: ${z.name}`),
      zones:            allZones,
    };
  }

  // Análisis de alturas permitidas
  const reasons          = [];
  const permittedHeights = [];
  let allZonesAreHigh    = true;

  for (const z of restrictiveZones) {
    const msg = z.message || z.warning || '';

    const heightMatch =
      msg.match(/por debajo de\s*(\d{1,4})\s*m/iu)       ||
      msg.match(/altura m[aá]xima de\s*(\d{1,4})\s*m/iu)  ||
      msg.match(/permitidas?\s*[^\d]*(\d{1,4})\s*m/iu)    ||
      msg.match(/hasta\s*(\d{1,4})\s*m/iu);

    const lowerFtMatch = msg.match(/Nivel inferior:\s*(\d{3,5})ft/iu);

    if (heightMatch) {
      const h = parseInt(heightMatch[1], 10);
      permittedHeights.push(h);
      reasons.push(`Permitido hasta ${h}m: ${z.name}`);
      allZonesAreHigh = false;
    } else if (lowerFtMatch) {
      if (parseInt(lowerFtMatch[1], 10) <= 400) allZonesAreHigh = false;
    } else {
      allZonesAreHigh = false;
    }
  }

  if (allZonesAreHigh)          return FREE_FLIGHT;
  if (permittedHeights.length > 0) {
    return { canFly: true, maxAllowedHeight: Math.min(...permittedHeights), reasons, zones: allZones };
  }

  // Requiere coordinación
  return {
    canFly:           false,
    maxAllowedHeight: null,
    reasons:          restrictiveZones.map(z => `Requiere coordinación: ${z.name}`),
    zones:            allZones,
  };
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());

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
    const layerResults = await Promise.all(
      ENAIRE_LAYERS.map(layer => queryEnaireLayer(layer, { lat, lon, radiusKm })),
    );

    saveEnaireLog({ lat, lon, radius: radiusKm }, layerResults);

    const zones = layerResults.flatMap(r =>
      r.features.map(f => normalizeFeature(f, r.layer)),
    );

    console.log(`Total zonas: ${zones.length}`);
    zones.forEach(z =>
      console.log(`  [ZONA] ${z.layer} | ${z.name} | "${stripHtml(z.message).slice(0, 80)}..."`),
    );

    const restrictiveZones = zones.filter(
      z => !matchesAny(INFO_ONLY_PATTERNS, stripHtml(z.message)),
    );
    console.log(
      `Zonas restrictivas: ${restrictiveZones.length} / informativas: ${zones.length - restrictiveZones.length}`,
    );

    const result = analyzeFlightPermission(restrictiveZones, zones);
    console.log('Resultado final:', { canFly: result.canFly, maxAllowedHeight: result.maxAllowedHeight, reasons: result.reasons });
    return res.json(result);

  } catch (err) {
    console.error('Error en /api/zones:', err);
    res.status(500).json({ error: 'ENAIRE query failed', details: err.message });
  }
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
