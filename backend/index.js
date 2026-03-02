
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ENAIRE_LAYERS } from './enaireLayers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'enaire_zones_log.json');

// --- Helper: guardar log de zonas ENAIRE (sobrescribe en cada llamada) ---
function saveEnaireLog(query, results) {
  try {
    // Solo guardar zonas que tienen features (capas con datos)
    const layersWithData = results
      .filter(r => r.features.length > 0)
      .map(r => ({
        layer: r.layer,
        featureCount: r.features.length,
        zones: r.features.map(f => {
          const a = f.attributes || {};
          const rawMsg = a.message || a.DESCRIPCION || a.description || '';
          const cleanMsg = rawMsg.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          return {
            identifier: a.identifier || a.NOMBRE || a.name || null,
            name: a.name_authority || a.provider || a.originator || null,
            type: a.type || null,
            lower: a.lower != null ? `${a.lower}${a.uom || 'm'} ${a.lowerReference || ''}`.trim() : null,
            upper: a.upper != null ? `${a.upper}${a.uom || 'm'} ${a.upperReference || ''}`.trim() : null,
            message: cleanMsg || null,
          };
        })
      }));

    const logData = [{
      timestamp: new Date().toISOString(),
      query,
      layers: layersWithData
    }];

    fs.writeFileSync(LOG_PATH, JSON.stringify(logData, null, 2), 'utf-8');
    console.log(`[LOG] Zonas ENAIRE guardadas en ${LOG_PATH}`);
  } catch (logErr) {
    console.warn('[LOG] Error guardando log:', logErr.message);
  }
}

// --- Frases de prohibición absoluta ---
const forbiddenPhrases = [
  'NO permitido el vuelo a drones excepto coordinación',
  'NO permitido el vuelo a drones',
  'NO permitido el vuelo de drones',
  'NO permitido el vuelo de UAS',
  'NO permitido el vuelo a UAS',
  'NO permitido el vuelo de RPAS',
  'NO permitido el vuelo a RPAS',
  'NO permitido el vuelo',
  'Prohibido el vuelo a drones',
  'Prohibido el vuelo de drones',
  'Prohibido el vuelo de UAS',
  'Prohibido el vuelo a UAS',
  'Prohibido el vuelo de RPAS',
  'Prohibido el vuelo a RPAS',
  'Prohibido el vuelo',
];

// --- Frases para bloquear vuelo fotográfico ---
const blockPhotoFlightPhrases = [
  'restringida al vuelo fotográfico',
  'restringida al vuelo de fotografía',
  'restringida al vuelo para fotografía',
  'restringida al vuelo de captación de datos',
  'restringida al vuelo de imagen',
  'restringida al vuelo de cámaras',
];

const app = express();
app.use(cors());

// Geocoding endpoint (Nominatim OpenStreetMap)
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Address required' });
  try {
    const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1
      },
      headers: { 'User-Agent': 'drones-app/1.0' }
    });
    if (!geoRes.data.length) return res.status(404).json({ error: 'Not found' });
    const { lat, lon, display_name } = geoRes.data[0];
    res.json({ location: { lat: parseFloat(lat), lon: parseFloat(lon), name: display_name } });
  } catch (err) {
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// ENAIRE UAS Zoning endpoint (ArcGIS REST)
app.get('/api/zones', async (req, res) => {
  const { lat, lon, radius } = req.query;
  console.log('--- Nueva consulta /api/zones ---');
  console.log('Parámetros:', { lat, lon, radius });
  if (!lat || !lon) return res.status(400).json({ error: 'lat/lon required' });
  let searchRadius = 1; // km
  if (radius) {
    const r = Math.max(100, Math.min(1000, parseInt(radius, 10)));
    searchRadius = r / 1000;
  }
  try {
    // Consultar todas las capas relevantes en paralelo
    const arcgisBase = 'https://servais.enaire.es/insignia/rest/services/NSF_SRV/SRV_UAS_ZG_V1/MapServer';
    const params = {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      distance: searchRadius,
      units: 'esriSRUnit_Kilometer',
      outFields: '*',
      f: 'json',
      inSR: 4326
    };
    // Consultar todas las capas
    const requests = ENAIRE_LAYERS.map(layer =>
      axios.get(`${arcgisBase}/${layer.id}/query`, { params })
        .then(resp => {
          console.log(`[ENAIRE] Layer ${layer.name} (${layer.id}) features:`, Array.isArray(resp.data.features) ? resp.data.features.length : 'no features');
          return { layer: layer.name, features: resp.data.features || [], raw: resp.data };
        })
        .catch((e) => {
          console.warn(`[ENAIRE] Error en capa ${layer.name} (${layer.id}):`, e.message);
          return { layer: layer.name, features: [], raw: null };
        })
    );
    const results = await Promise.all(requests);
    console.log('Resultados ENAIRE:', results.map(r => ({ layer: r.layer, features: r.features.length })));

    // Guardar log con todas las zonas crudas devueltas por ENAIRE
    saveEnaireLog({ lat, lon, radius: searchRadius }, results);

    // Transformar features en zonas normalizadas
    const zones = [];
    for (const result of results) {
      for (const feature of result.features) {
        const attrs = feature.attributes || {};
        const name = attrs.NOMBRE || attrs.nombre || attrs.NAME || attrs.name || attrs.identifier || result.layer;
        const message = attrs.message || attrs.DESCRIPCION || attrs.descripcion || attrs.DESCRIPTION || attrs.description || attrs.OBSERVACIONES || '';
        const warning = attrs.warning || attrs.ADVERTENCIA || attrs.advertencia || attrs.WARNING || '';
        const prohibited = attrs.PROHIBIDO === 'SI' || attrs.prohibited === true;
        // Convertir geometría ArcGIS (rings) a formato Leaflet [[lat,lon], ...]
        let geometry = null;
        if (feature.geometry && Array.isArray(feature.geometry.rings) && feature.geometry.rings.length > 0) {
          geometry = feature.geometry.rings[0].map(([lon, lat]) => [lat, lon]);
        }
        zones.push({ name, layer: result.layer, message, warning, prohibited, attributes: attrs, geometry });
      }
    }
    console.log('Total zonas encontradas:', zones.length);
    zones.forEach(z => console.log(`  [ZONA] ${z.layer} | ${z.name} | msg: "${z.message.slice(0, 80)}..."`));

    // Filtrar zonas puramente informativas (aviso entorno urbano, aplica a toda España)
    const infoOnlyPatterns = [
      /antes de volar compruebe si la zona.*entorno urbano/is,
    ];
    const stripHtml = str => str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const restrictiveZones = zones.filter(z =>
      !infoOnlyPatterns.some(p => p.test(stripHtml(z.message || '')))
    );
    console.log(`Zonas restrictivas: ${restrictiveZones.length} / informativas: ${zones.length - restrictiveZones.length}`);

    if (restrictiveZones.length === 0) {
      return res.json({
        canFly: true,
        maxAllowedHeight: 120,
        reasons: ['No hay restricciones activas en la zona. Permitido hasta 120m.'],
        zones: []
      });
    }

    let canFly = false;
    let reasons = [];
    let permittedHeights = [];

    // Bloqueo por restricción fotográfica (case-insensitive)
    const photoFlightBlockedZones = restrictiveZones.filter(zone => {
      const msg = ((zone.message || '') + ' ' + (zone.warning || '')).replace(/<[^>]+>/g, '').toLowerCase();
      return blockPhotoFlightPhrases.some(phrase => msg.includes(phrase.toLowerCase()));
    });
    if (photoFlightBlockedZones.length > 0) {
      canFly = false;
      photoFlightBlockedZones.forEach(z => {
        reasons.push(`Bloqueo por restricción fotográfica: ${z.name}`);
      });
      console.log('Bloqueo por restricción fotográfica detectado:', reasons);
      return res.json({ canFly, maxAllowedHeight: null, reasons, zones });
    }

    // Prohibición absoluta (case-insensitive)
    const absoluteForbiddenZones = restrictiveZones.filter(zone => {
      const msg = ((zone.message || '') + ' ' + (zone.warning || '')).toLowerCase();
      return forbiddenPhrases.some(phrase => msg.includes(phrase.toLowerCase()));
    });
    if (absoluteForbiddenZones.length > 0) {
      canFly = false;
      absoluteForbiddenZones.forEach(z => {
        reasons.push(`Prohibido: ${z.name}`);
      });
      console.log('Prohibición absoluta detectada:', reasons);
      return res.json({ canFly, maxAllowedHeight: null, reasons, zones });
    }

    // Análisis de alturas permitidas en los mensajes
    let allZonesAbove400ft = true;
    let onlyHighZones = [];
    for (const z of restrictiveZones) {
      const msgRaw = z.message || z.warning || '';
      const heightMatch = msgRaw.match(/por debajo de\s*(\d{1,4})\s*m/iu)
        || msgRaw.match(/altura máxima de\s*(\d{1,4})\s*m/iu)
        || msgRaw.match(/permitidas?[^\d]*(\d{1,4})\s*m/iu)
        || msgRaw.match(/hasta\s*(\d{1,4})\s*m/iu);
      const lowerLevelMatch = msgRaw.match(/Nivel inferior:\s*(\d{3,5})ft/iu);

      if (heightMatch) {
        const h = parseInt(heightMatch[1], 10);
        permittedHeights.push(h);
        reasons.push(`Permitido hasta ${h}m: ${z.name}`);
        allZonesAbove400ft = false;
      } else if (lowerLevelMatch) {
        const ft = parseInt(lowerLevelMatch[1], 10);
        if (ft > 400) {
          onlyHighZones.push(z);
        } else {
          allZonesAbove400ft = false;
        }
      } else {
        // Zona sin altura explícita ni prohibición → no es libre
        allZonesAbove400ft = false;
      }
    }

    let maxAllowedHeight = null;
    if (permittedHeights.length > 0) {
      canFly = true;
      maxAllowedHeight = Math.min(...permittedHeights);
    } else if (onlyHighZones.length === restrictiveZones.length) {
      // Todas las zonas están por encima de 400ft → sin restricción práctica
      canFly = true;
      maxAllowedHeight = 120;
      reasons = ['No hay restricciones activas en la zona. Permitido hasta 120m.'];
      return res.json({ canFly, maxAllowedHeight, reasons, zones: [] });
    } else {
      // Hay zonas con tipo REQ_AUTHORIZATION u otras sin altura clara → requiere coordinación
      canFly = false;
      if (reasons.length === 0) {
        restrictiveZones.forEach(z => {
          reasons.push(`Requiere coordinación: ${z.name}`);
        });
      }
    }
    console.log('Resultado final:', { canFly, maxAllowedHeight, reasons });
    res.json({
      canFly,
      maxAllowedHeight,
      reasons,
      zones
    });
  } catch (err) {
    console.error('Error en /api/zones:', err);
    res.status(500).json({ error: 'ENAIRE query failed', details: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
