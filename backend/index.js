
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

const NOTAM_BASE =
  'https://servais.enaire.es/insignias/rest/services/NOTAM/NOTAM_UAS_APP_V3/MapServer';

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

/**
 * Detecta zonas con altura libre hasta Xm y prohibición por encima.
 * Captura: [1] límite en metros AGL desde ref. aeródromo, [2] cota AMSL del aeródromo (opcional).
 * Ej: "Por debajo de 90m medidos desde el punto de referencia del aeródromo (442m), no es necesario coordinar"
 */
const CONDITIONAL_HEIGHT_PATTERN =
  /por debajo de\s*(\d{1,4})\s*m[^(]*(?:\((\d{3,5})m\))?[^.]*no es necesario coordinar/iu;

/** Vuelo fotográfico / captación de datos restringido */
const PHOTO_FLIGHT_PATTERNS = [
  /restringida al vuelo fotogr[aá]fico/i,
  /restringida al vuelo de fotograf[ií]a/i,
  /restringida al vuelo para fotograf[ií]a/i,
  /restringida al vuelo de captaci[oó]n de datos/i,
  /restringida al vuelo de imagen/i,
  /restringida al vuelo de c[aá]maras/i,
];

/** Zonas meramente informativas o de espacio aéreo superior — no restringen el vuelo de drones */
const INFO_ONLY_PATTERNS = [
  /antes de volar compruebe si la zona.*entorno urbano/is,       // aviso entorno urbano (toda España)
  /_TMA$/i,                                                       // TMA por identificador (ej. LECM_TMA)
  /espacio a[eé]reo controlado\s+TMA\b/i,                        // TMA por mensaje
];

/** Patrones que indican que un NOTAM prohíbe o restringe el vuelo de drones */
const NOTAM_FORBIDDEN_PATTERNS = [
  /drone.*prohibid/i,
  /prohibid.*drone/i,
  /UAS.*prohibid/i,
  /prohibid.*UAS/i,
  /RPAS.*prohibid/i,
  /prohibid.*RPAS/i,
  /vuelo\s+(de\s+)?(drones?|uas|rpas)\s+(no\s+)?permitido/i,
  /no\s+(est[aá]\s+)?permitido.*vuelo/i,
  /TEMPO\s+RESTRICTED\s+AREA/i,   // NOTAM de área restringida temporal (qcode RTCA/RTCE)
  /TEMPORARY\s+RESTRICTED/i,
  /\bPROHIBITED\s+AREA\b/i,
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
  const isNotam = !!(a.notamId || a.notamNumber);

  if (isNotam) {
    return {
      identifier: a.notamId || null,
      qcode:      a.qcode   || null,
      from:       a.itemBstr || null,
      to:         a.itemCstr || null,
      lower:      a.LOWER_VAL != null ? `${a.LOWER_VAL}m` : null,
      upper:      a.UPPER_VAL != null ? `${a.UPPER_VAL}ft AGL` : null,
      message:    stripHtml(a.DESCRIPTION || a.itemE || '') || null,
    };
  }

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

// ─── Elevación del terreno ────────────────────────────────────────────────────

/**
 * Consulta la elevación AMSL del terreno en un punto (SRTM via open-topo-data).
 * Devuelve metros AMSL, o null si falla.
 */
async function getElevation(lat, lon) {
  try {
    const { data } = await axios.get('https://api.opentopodata.org/v1/srtm30m', {
      params: { locations: `${lat},${lon}` },
      timeout: 5000,
    });
    return data?.results?.[0]?.elevation ?? null;
  } catch {
    return null;
  }
}



/**
 * Convierte un feature ArcGIS a un objeto de zona normalizado.
 * Geometría: rings [[lon,lat]] → [[lat,lon]] (formato Leaflet).
 * Compatible con features ZG (zonas geográficas) y NOTAM.
 */
function normalizeFeature(feature, layerName) {
  const a = feature.attributes || {};

  const isNotam = !!(a.notamId || a.notamNumber);

  const name    = isNotam
    ? (a.notamId || `NOTAM-${a.OBJECTID}`)
    : (a.NOMBRE || a.nombre || a.NAME || a.name || a.identifier || layerName);

  const message = isNotam
    ? (a.DESCRIPTION || a.itemE || '')
    : (a.message || a.DESCRIPCION || a.descripcion || a.DESCRIPTION || a.description || a.OBSERVACIONES || '');

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

// ─── Consulta NOTAM ──────────────────────────────────────────────────────────

/**
 * Consulta la capa 1 del servicio NOTAM_UAS_APP_V3.
 * Devuelve { layer, features }. Nunca rechaza.
 * Usa un bbox cuadrado alrededor del punto (aprox. radiusKm × 2 en cada lado).
 */
async function queryNotamLayer({ lat, lon, radiusKm }) {
  // ~1° lat ≈ 111 km  |  ~1° lon ≈ 111 km * cos(lat)
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const envelope = {
    xmin: lon - dLon,
    ymin: lat - dLat,
    xmax: lon + dLon,
    ymax: lat + dLat,
    spatialReference: { wkid: 4326 },
  };

  try {
    const { data } = await axios.get(`${NOTAM_BASE}/1/query`, {
      params: {
        geometry:     JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        spatialRel:   'esriSpatialRelIntersects',
        outFields:    '*',
        f:            'json',
        inSR:         4326,
        outSR:        4326,
      },
    });
    const features = data.features || [];
    console.log(`[NOTAM] NOTAM_UAS_APP_V3/1: ${features.length} features`);
    return { layer: 'NOTAMs activos', features };
  } catch (err) {
    console.warn('[NOTAM] Error consultando NOTAMs:', err.message);
    return { layer: 'NOTAMs activos', features: [] };
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
 * @param {object[]} restrictiveZones
 * @param {object[]} allZones
 * @param {number|null} terrainElevation  — elevación AMSL del punto consultado (metros), o null
 */
function analyzeFlightPermission(restrictiveZones, allZones, terrainElevation = null) {
  // Sin restricciones
  if (restrictiveZones.length === 0) return FREE_FLIGHT;

  // NOTAMs activos con prohibición explícita — prioridad máxima
  // qcode en el servicio ya viene SIN la Q inicial: "RDCA" en vez de "QRDCA"
  // R* = restricted area, P* = prohibited area, D* = danger area
  const NOTAM_RESTRICTIVE_QCODES = /^[RPD]/i;

  // Parsea "DD/MM/YYYY HH:mm:ss" → timestamp ms
  const parseNotamDate = str => {
    if (!str) return 0;
    const [d, m, y, H, M, S] = str.match(/(\d+)/g);
    return new Date(`${y}-${m}-${d}T${H}:${M}:${S}`).getTime();
  };

  const now = Date.now();

  const forbiddenNotams = restrictiveZones.filter(z => {
    if (z.layer !== 'NOTAMs activos') return false;
    const qcode = z.attributes?.qcode || '';
    return NOTAM_RESTRICTIVE_QCODES.test(qcode) || matchesAny(NOTAM_FORBIDDEN_PATTERNS, zoneText(z));
  });

  if (forbiddenNotams.length > 0) {
    forbiddenNotams.sort((a, b) =>
      parseNotamDate(a.attributes?.itemBstr) - parseNotamDate(b.attributes?.itemBstr),
    );

    // Separa los que están en vigor AHORA de los que son futuros (o ya caducaron)
    const activeNow  = forbiddenNotams.filter(z => {
      const from = parseNotamDate(z.attributes?.itemBstr);
      const to   = parseNotamDate(z.attributes?.itemCstr);
      return from <= now && (to === 0 || now <= to);
    });
    const notActiveNow = forbiddenNotams.filter(z => {
      const from = parseNotamDate(z.attributes?.itemBstr);
      const to   = parseNotamDate(z.attributes?.itemCstr);
      return !(from <= now && (to === 0 || now <= to));
    });

    const notamReason = z => {
      const from = z.attributes?.itemBstr || null;
      const to   = z.attributes?.itemCstr || null;
      const range = from && to
        ? ` (desde ${from} hasta ${to})`
        : to ? ` (restricción hasta ${to})` : '';
      return { active: activeNow.includes(z), text: `NOTAM: ${z.name}${range}` };
    };

    // Solo los NOTAMs que están activos AHORA bloquean el vuelo
    if (activeNow.length > 0) {
      return {
        canFly:           false,
        maxAllowedHeight: null,
        reasons: forbiddenNotams.map(z => {
          const { active, text } = notamReason(z);
          return active ? `🚫 NOTAM en vigor — Prohibido: ${z.name}${
            z.attributes?.itemBstr && z.attributes?.itemCstr
              ? ` (desde ${z.attributes.itemBstr} hasta ${z.attributes.itemCstr})`
              : ''
          }` : `⚠️ NOTAM próximo — ${z.name}${
            z.attributes?.itemBstr && z.attributes?.itemCstr
              ? ` (desde ${z.attributes.itemBstr} hasta ${z.attributes.itemCstr})`
              : ''
          }`;
        }),
        zones: allZones,
      };
    }

    // Todos los NOTAMs son futuros o ya caducaron → se puede volar pero se avisa
    return {
      canFly:           true,
      maxAllowedHeight: 120,
      reasons: [
        'No hay restricciones activas en este momento.',
        ...notActiveNow.map(z =>
          `⚠️ NOTAM próximo — ${z.name}${
            z.attributes?.itemBstr && z.attributes?.itemCstr
              ? ` (desde ${z.attributes.itemBstr} hasta ${z.attributes.itemCstr})`
              : ''
          }`,
        ),
      ],
      zones: allZones,
    };
  }

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
  // Pero primero excluimos zonas que en realidad son condicionales (libre hasta Xm, prohibido por encima)
  const conditionalZones = restrictiveZones.filter(z => {
    const msg = stripHtml(z.message || z.warning || '');
    return CONDITIONAL_HEIGHT_PATTERN.test(msg);
  });
  const forbidden = restrictiveZones.filter(
    z => !conditionalZones.includes(z) && matchesAny(FORBIDDEN_PATTERNS, zoneText(z)),
  );
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

  // Las zonas condicionales aportan su altura libre directamente
  // Si tenemos elevación del terreno, calculamos el límite real que aplica al punto consultado
  for (const z of conditionalZones) {
    const msg = stripHtml(z.message || z.warning || '');
    const m = msg.match(CONDITIONAL_HEIGHT_PATTERN);
    if (m) {
      const limitAgl = parseInt(m[1], 10);          // ej. 90m AGL desde cota aeródromo
      const aeroRef  = m[2] ? parseInt(m[2], 10) : null;  // cota AMSL aeródromo, ej. 442m

      if (terrainElevation !== null && aeroRef !== null) {
        // Límite absoluto AMSL donde empieza la restricción
        const restrictionAmsl = aeroRef + limitAgl;
        // Margen real disponible desde el terreno donde estoy
        const maxFlyable = restrictionAmsl - terrainElevation;

        if (maxFlyable <= 0) {
          // El terreno ya supera la cota de restricción: vuelo no permitido
          return {
            canFly:           false,
            maxAllowedHeight: null,
            reasons: [
              `Prohibido: ${z.name} — el terreno (${terrainElevation}m AMSL) supera la cota de restricción (${restrictionAmsl}m AMSL = aeródromo ${aeroRef}m + ${limitAgl}m)`,
            ],
            zones: allZones,
          };
        }

        if (maxFlyable >= 120) {
          // La restricción no afecta en la práctica (podemos volar los 120m legales)
          reasons.push(`Sin restricción efectiva a esta altitud: ${z.name} (restricción a ${restrictionAmsl}m AMSL, terreno a ${terrainElevation}m)`);
        } else {
          permittedHeights.push(maxFlyable);
          reasons.push(`Permitido hasta ${maxFlyable}m sobre el terreno: ${z.name} — restricción a partir de ${restrictionAmsl}m AMSL (aeródromo ref. ${aeroRef}m + ${limitAgl}m, terreno ${terrainElevation}m)`);
        }
      } else {
        // Sin elevación del terreno: usamos el límite nominal como advertencia
        permittedHeights.push(limitAgl);
        reasons.push(`Permitido hasta ${limitAgl}m desde ref. aeródromo: ${z.name}${aeroRef ? ` (aeródromo a ${aeroRef}m AMSL, elevación terreno no disponible)` : ''}`);
      }
      allZonesAreHigh = false;
    }
  }

  for (const z of restrictiveZones) {
    if (conditionalZones.includes(z)) continue;  // ya procesadas arriba
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
    const [layerResults, notamResult, terrainElevation] = await Promise.all([
      Promise.all(ENAIRE_LAYERS.map(layer => queryEnaireLayer(layer, { lat, lon, radiusKm }))),
      queryNotamLayer({ lat: parseFloat(lat), lon: parseFloat(lon), radiusKm }),
      getElevation(parseFloat(lat), parseFloat(lon)),
    ]);

    if (terrainElevation !== null) {
      console.log(`[ELEVACIÓN] Terreno: ${terrainElevation}m AMSL`);
    } else {
      console.log('[ELEVACIÓN] No disponible (se usará lógica sin elevación)');
    }

    const allResults = [...layerResults, notamResult];
    saveEnaireLog({ lat, lon, radius: radiusKm }, allResults);

    const zones = allResults.flatMap(r =>
      r.features.map(f => normalizeFeature(f, r.layer)),
    );

    console.log(`Total zonas: ${zones.length}`);
    zones.forEach(z =>
      console.log(`  [ZONA] ${z.layer} | ${z.name} | "${stripHtml(z.message).slice(0, 80)}..."`),
    );

    const restrictiveZones = zones.filter(z => {
      const identifier = z.attributes?.identifier || '';
      return !matchesAny(INFO_ONLY_PATTERNS, stripHtml(z.message)) &&
             !matchesAny(INFO_ONLY_PATTERNS, z.name || '') &&
             !matchesAny(INFO_ONLY_PATTERNS, identifier);
    });
    console.log(
      `Zonas restrictivas: ${restrictiveZones.length} / informativas: ${zones.length - restrictiveZones.length}`,
    );

    const result = analyzeFlightPermission(restrictiveZones, zones, terrainElevation);
    console.log('Resultado final:', { canFly: result.canFly, maxAllowedHeight: result.maxAllowedHeight, reasons: result.reasons });
    return res.json(result);

  } catch (err) {
    console.error('Error en /api/zones:', err);
    res.status(500).json({ error: 'ENAIRE query failed', details: err.message });
  }
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
