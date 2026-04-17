/**
 * enaire.js — Consultas a ENAIRE (ArcGIS + NOTAM) y normalización de features.
 */

import fs   from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { ENAIRE_LAYERS } from './enaireLayers.js';
import { stripHtml } from './patterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH  = path.join(__dirname, 'debug_enaire_zones.json');

const NOTAM_BASE =
  'https://servais.enaire.es/insignias/rest/services/NOTAM/NOTAM_UAS_APP_V3/MapServer';

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * Convierte un feature ArcGIS a un objeto de zona normalizado.
 * Geometría: rings [[lon,lat]] → [[lat,lon]] (formato Leaflet).
 */
export function normalizeFeature(feature, layerName) {
  const a       = feature.attributes || {};
  const isNotam = !!(a.notamId || a.notamNumber);

  const name = isNotam
    ? (a.notamId || `NOTAM-${a.OBJECTID}`)
    : (a.NOMBRE || a.nombre || a.NAME || a.name || a.NAME_TXT || a.IDENT_TXT || a.identifier || layerName);

  const message = isNotam
    ? (a.DESCRIPTION || a.itemE || '')
    : (a.message || a.DESCRIPCION || a.descripcion || a.DESCRIPTION || a.description || a.OBSERVACIONES || a.REMARKS_TXT || a.REMARKS_TXT_S || a.REMARKS || a.remarks || '');

  const warning    = a.warning || a.ADVERTENCIA || a.advertencia || a.WARNING || '';
  const prohibited = a.PROHIBIDO === 'SI' || a.prohibited === true || a.type === 'FORBIDDEN';

  // Structured lower/upper — new service uses numeric fields (a.lower, a.lowerReference, a.uom)
  // Old service used a.LOWER_VAL (number, feet) — kept as fallback
  const unitStr = (a.uom || 'M').toUpperCase();
  const lower = a.lower   != null ? `${a.lower}${unitStr} ${(a.lowerReference || '').toUpperCase()}`.trim()
              : a.LOWER_VAL != null ? `${a.LOWER_VAL}m AGL` : '';
  const upper = a.upper   != null ? `${a.upper}${unitStr} ${(a.upperReference || '').toUpperCase()}`.trim()
              : a.UPPER_VAL != null ? `${a.UPPER_VAL}ft AGL` : '';

  let geometry = null;
  if (feature.geometry?.rings?.length > 0) {
    geometry = feature.geometry.rings[0].map(([lon, lat]) => [lat, lon]);
  }

  return { name, layer: layerName, message, warning, prohibited, lower, upper, attributes: a, geometry };
}

// ─── Log ──────────────────────────────────────────────────────────────────────

function featureToLogEntry(feature) {
  const a       = feature.attributes || {};
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

/** Sobreescribe el log con las zonas de la última consulta. */
export function saveEnaireLog(query, results) {
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

// ─── Consultas ────────────────────────────────────────────────────────────────

/** Lanza la query ArcGIS para una capa. Nunca rechaza. */
export async function queryEnaireLayer(layer, { lat, lon, radiusKm }) {
  try {
    const params = {
      geometry:     `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      spatialRel:   'esriSpatialRelIntersects',
      distance:     radiusKm,
      units:        'esriSRUnit_Kilometer',
      outFields:    '*',
      f:            'json',
      inSR:         4326,
      outSR:        4326,
    };
    if (layer.where) params.where = layer.where;
    const { data } = await axios.get(`${layer.service}/${layer.id}/query`, { params });
    const features = data.features || [];
    console.log(`[ENAIRE] ${layer.name} (${layer.service.split('/').slice(-3).join('/')}/${layer.id}): ${features.length} features`);
    return { layer: layer.name, features };
  } catch (err) {
    console.warn(`[ENAIRE] Error en capa ${layer.name}:`, err.message);
    return { layer: layer.name, features: [], fetchError: true };
  }
}

/** Consulta la capa NOTAM_UAS_APP_V3/1. Nunca rechaza. */
export async function queryNotamLayer({ lat, lon, radiusKm }) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const envelope = {
    xmin: lon - dLon, ymin: lat - dLat,
    xmax: lon + dLon, ymax: lat + dLat,
    spatialReference: { wkid: 4326 },
  };

  try {
    const { data } = await axios.get(`${NOTAM_BASE}/1/query`, {
      params: {
        geometry:     JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        spatialRel:   'esriSpatialRelIntersects',
        where:        'LOWER_VAL_AGL is null or LOWER_VAL_AGL < 120',
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
    return { layer: 'NOTAMs activos', features: [], fetchError: true };
  }
}

/**
 * Ejecuta todas las capas ENAIRE + NOTAM en paralelo.
 * Devuelve { zones, allResults }.
 */
export async function queryAllLayers({ lat, lon, radiusKm }) {
  const [layerResults, notamResult] = await Promise.all([
    Promise.all(ENAIRE_LAYERS.map(layer => queryEnaireLayer(layer, { lat, lon, radiusKm }))),
    queryNotamLayer({ lat, lon, radiusKm }),
  ]);

  const allResults = [...layerResults, notamResult];
  const zones      = allResults.flatMap(r => r.features.map(f => normalizeFeature(f, r.layer)));
  return { zones, allResults };
}
