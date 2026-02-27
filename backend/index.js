
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { ENAIRE_LAYERS } from './enaireLayers.js';

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

    // Guardar log de consulta antes de filtrar
    const fs = await import('fs');
    const logPath = './backend/enaire_zones_log.json';
    let logArr = [];
    try {
      const logRaw = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '[]';
      logArr = JSON.parse(logRaw);
    } catch (e) {
      logArr = [];
    }
    logArr.push({
      timestamp: new Date().toISOString(),
      lat,
      lon,
      radius,
      layers: results.map(r => ({ layer: r.layer, raw: r.raw }))
    });
    try {
      fs.writeFileSync(logPath, JSON.stringify(logArr, null, 2));
    } catch (e) {
      console.warn('No se pudo guardar el log de zonas ENAIRE:', e.message);
    }
    // Texto a filtrar completamente (ni zona ni restricción)
    const filterOutPhrases = [
      'zona geográfica de UAS general por razón de la seguridad operacional del espacio aéreo controlado',
      'TMA MADRID',
      'Están permitidas las operaciones VLOS a una altura máxima de 60m fuera de las ZGUAS generales por razón de la seguridad operacional en el entorno de los aeródromos'
    ];
    // Unificar zonas y filtrar las que contienen el texto a descartar o solo "Nivel inferior" alto
    const zones = results.flatMap(({ layer, features }) =>
      features.map(f => {
        try {
          return {
            name: f.attributes.name || f.attributes.identifier || f.attributes.NOMBRE || layer || 'Zona',
            prohibited: (f.attributes.type === 'PROHIBITED') || (f.attributes.RESTRICCION === 'PROHIBIDA') || (f.attributes.TIPO === 'PROHIBIDA'),
            warning: (f.attributes.type === 'CONDITIONAL' || f.attributes.type === 'REQ_AUTHORIZATION' || f.attributes.RESTRICCION === 'CONDICIONAL' || f.attributes.TIPO === 'CONDICIONAL') ? (f.attributes.message || f.attributes.MENSAJE || f.attributes.DESCRIPCION) : null,
            maxHeight: f.attributes.upper || f.attributes.RESTRICCION_UPPER || f.attributes.ALTURA_MAX,
            minHeight: f.attributes.lower || f.attributes.RESTRICCION_LOWER || f.attributes.ALTURA_MIN,
            message: f.attributes.message || f.attributes.MENSAJE || f.attributes.DESCRIPCION,
            type: f.attributes.type || f.attributes.RESTRICCION || f.attributes.TIPO,
            layer,
            geometry: f.geometry && f.geometry.rings
              ? f.geometry.rings[0].map(([lng, lat]) => [lat, lng])
              : []
          };
        } catch (err) {
          console.error('Error procesando feature:', err, f);
          return { name: 'Error', layer, message: 'Error procesando feature', geometry: [] };
        }
      })
    ).filter(z => {
      const msg = ((z.message || '') + ' ' + (z.warning || '')).replace(/<[^>]+>/g, '').toLowerCase();
      // Filtrar frases generales
      if (filterOutPhrases.every(phrase => msg.includes(phrase.toLowerCase()))) return false;
      // Filtrar zonas cuyo mensaje contiene "Nivel inferior: XXXXft" y XXXX > 400
      const nivelInfMatch = msg.match(/nivel inferior:\s*(\d{3,5})ft/);
      if (nivelInfMatch) {
        const ft = parseInt(nivelInfMatch[1], 10);
        if (ft > 400) return false;
      }
      // Filtrar zonas cuyo mensaje contiene "FLxxx" (cualquier valor FL)
      const flMatch = msg.match(/fl\d{2,3}/i);
      if (flMatch) {
        return false;
      }
      // Filtrar zonas cuyo mensaje contiene "Nivel inferior: FLxxx" (cualquier FL)
      const nivelInfFLMatch = msg.match(/nivel inferior:\s*fl(\d{2,3})/i);
      if (nivelInfFLMatch) {
        return false;
      }
      return true;
    });
    console.log('Zonas procesadas:', zones.map(z => ({ name: z.name, layer: z.layer, prohibited: z.prohibited, type: z.type })));
    // Nueva lógica: analizar restricciones y alturas máximas
    let reasons = [];
    let permittedHeights = [];
    let canFly = false;
    // Detectar si hay alguna zona absolutamente prohibida (sin altura máxima permitida en ese mensaje)
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

    // Nueva lógica: bloquear si hay restricción de vuelo fotográfico
    const blockPhotoFlightPhrases = [
      'restringida al vuelo fotográfico',
      'restringida al vuelo de fotografía',
      'restringida al vuelo para fotografía',
      'restringida al vuelo de captación de datos',
      'restringida al vuelo de imagen',
      'restringida al vuelo de cámaras',
    ];
    // Buscar zonas con restricción de vuelo fotográfico
    const photoFlightBlockedZones = zones.filter(zone => {
      const msg = ((zone.message || '') + ' ' + (zone.warning || ''))
        .replace(/<[^>]+>/g, '').toLowerCase();
      return blockPhotoFlightPhrases.some(phrase => msg.includes(phrase));
    });
    if (photoFlightBlockedZones.length > 0) {
      canFly = false;
      let maxAllowedHeight = null;
      photoFlightBlockedZones.forEach(z => {
        reasons.push('Bloqueo por restricción fotográfica: ' + z.name + ' (' + (z.layer || 'Zona') + ')');
      });
      console.log('Bloqueo por restricción fotográfica detectado:', reasons);
      return res.json({
        canFly,
        maxAllowedHeight,
        reasons,
        zones
      });
    }

      // Buscar zonas con prohibición absoluta en message o warning
      const absoluteForbiddenZones = zones.filter(zone => {
        const msg = (zone.message || '') + ' ' + (zone.warning || '');
        return forbiddenPhrases.some(phrase => msg.includes(phrase));
      });

      if (absoluteForbiddenZones.length > 0) {
        canFly = false;
        let maxAllowedHeight = null;
        absoluteForbiddenZones.forEach(z => {
          reasons.push('Prohibido: ' + z.name + ' (' + (z.layer || 'Zona') + ')');
        });
        console.log('Prohibición absoluta detectada:', reasons);
        return res.json({
          canFly,
          maxAllowedHeight,
          reasons,
          zones
        });
      }

    let allZonesAbove400ft = zones.length > 0;
    let onlyHighZones = [];
    for (const z of zones) {
      const msgRaw = z.message || z.warning || '';
      const msgRawUpper = msgRaw.toUpperCase();
      // Buscar patrones de altura máxima en el mensaje
      const heightMatch = msgRaw.match(/por debajo de\s*(\d{1,4})\s*m/iu)
        || msgRaw.match(/altura máxima de\s*(\d{1,4})\s*m/iu)
        || msgRaw.match(/permitidas?[^\d]*(\d{1,4})\s*m/iu)
        || msgRaw.match(/hasta\s*(\d{1,4})\s*m/iu);
      // Buscar patrón "Nivel inferior: XXXXft"
      const lowerLevelMatch = msgRaw.match(/Nivel inferior:\s*(\d{3,5})ft/iu);
      if (heightMatch) {
        const h = parseInt(heightMatch[1], 10);
        permittedHeights.push(h);
        reasons.push(`Permitido hasta ${h}m: ${z.name} (${z.layer})`);
        allZonesAbove400ft = false;
      } else if (lowerLevelMatch) {
        const ft = parseInt(lowerLevelMatch[1], 10);
        if (ft > 400) {
          onlyHighZones.push(z);
        } else {
          allZonesAbove400ft = false;
        }
      } else {
        // Si no hay altura, pero hay frase prohibitiva, lo anotamos como info
        const isForbidden = forbiddenPhrases.some(phrase => msgRawUpper.includes(phrase));
        if (isForbidden) {
          reasons.push(`Prohibido: ${z.name} (${z.layer})`);
          allZonesAbove400ft = false;
        } else if (z.warning) {
          reasons.push(`Restricción: ${z.name} (${z.layer})`);
          allZonesAbove400ft = false;
        }
      }
    }
    let maxAllowedHeight = null;
    if (permittedHeights.length > 0) {
      canFly = true;
      maxAllowedHeight = Math.min(...permittedHeights);
    } else if (allZonesAbove400ft && onlyHighZones.length === zones.length) {
      // Solo hay zonas de "Nivel inferior" alto, no mostrar zonas ni razones
      canFly = true;
      maxAllowedHeight = 120;
      reasons = ['No hay restricciones activas en la zona. Permitido hasta 120m.'];
      return res.json({
        canFly,
        maxAllowedHeight,
        reasons,
        zones: []
      });
    } else if (allZonesAbove400ft && onlyHighZones.length > 0 && onlyHighZones.length === zones.length) {
      // Fallback extra: si todas las zonas son solo de nivel alto, aunque la lógica anterior falle
      canFly = true;
      maxAllowedHeight = 120;
      reasons = ['No hay restricciones activas en la zona. Permitido hasta 120m.'];
      return res.json({
        canFly,
        maxAllowedHeight,
        reasons,
        zones: []
      });
    } else {
      // ¿Hay alguna zona con restricciones o bloqueos?
      const hasRealRestriction = zones.some(z => {
        const msg = (z.message || '') + ' ' + (z.warning || '');
        const isForbidden = forbiddenPhrases.some(phrase => msg.toLowerCase().includes(phrase.toLowerCase()));
        const isPhotoBlocked = blockPhotoFlightPhrases.some(phrase => msg.toLowerCase().includes(phrase));
        return isForbidden || isPhotoBlocked || z.prohibited || z.warning;
      });
      if (!hasRealRestriction) {
        canFly = true;
        maxAllowedHeight = 120;
        reasons = ['No hay restricciones activas en la zona. Permitido hasta 120m.'];
        return res.json({
          canFly,
          maxAllowedHeight,
          reasons,
          zones: []
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
