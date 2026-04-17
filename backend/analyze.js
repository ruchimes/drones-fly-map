/**
 * analyze.js — Lógica de análisis de permisos de vuelo de drones.
 */

import {
  FORBIDDEN_PATTERNS,
  CONDITIONAL_HEIGHT_PATTERN,
  PHOTO_FLIGHT_PATTERNS,
  INFO_ONLY_PATTERNS,
  TMA_PATTERNS,
  HEIGHT_EXPLICIT_PATTERN,
  NOTAM_RESTRICTIVE_QCODES,
  NOTAM_DRONE_ZONE_QCODES,
  NOTAM_FORBIDDEN_PATTERNS,
  COORDINATION_EXCEPTION_PATTERN,
  NO_AIP_PATTERN,
  stripHtml, cleanMessage, zoneText, matchesAny, parseNotamDate,
} from './patterns.js';

export const FREE_FLIGHT = {
  canFly:           true,
  maxAllowedHeight: 120,
  reasons:          ['No hay restricciones activas en la zona. Permitido hasta 120m.'],
  zones:            [],
};

// ─── Filtro de zonas restrictivas ─────────────────────────────────────────────

/**
 * Parsea el nivel inferior de una zona desde el campo `lower` o desde el texto del mensaje.
 * Devuelve metros AMSL, o null si no se puede determinar.
 * Se usa para descartar zonas que empiezan muy por encima de la altitud máxima de un dron.
 *
 * El campo `lower` del nuevo servicio ENAIRE tiene formato: "0M AGL", "500M AMSL", "1524FT AMSL".
 * Las zonas AGL siempre empiezan desde tierra → nunca se descartan → null.
 * Las zonas AMSL con valor alto (> MAX_DRONE_AMSL_M) sí se descartan.
 */
function parseLowerLimitM(zone) {
  const FT_TO_M = 0.3048;

  // 1. Usar el campo `lower` estructurado que viene de normalizeFeature
  //    Formatos posibles: "0M AGL", "500M AMSL", "1524FT AMSL", "FL150" (raramente)
  const lowerStr = (zone.lower || '').trim();
  if (lowerStr) {
    // AGL: siempre parte del suelo, nunca supera MAX_DRONE_AMSL_M → no filtrar
    if (/\bAGL\b/i.test(lowerStr)) return null;

    // AMSL en metros
    const amslM = lowerStr.match(/^(\d+(?:\.\d+)?)\s*M\s+AMSL/i);
    if (amslM) {
      const val = parseFloat(amslM[1]);
      return val > 0 ? val : null; // 0M AMSL = dato por defecto, ignorar
    }

    // AMSL en pies
    const amslFt = lowerStr.match(/^(\d+(?:\.\d+)?)\s*FT\s+AMSL/i);
    if (amslFt) return parseFloat(amslFt[1]) * FT_TO_M;
  }

  // 2. Fallback: parsear desde el texto del mensaje (servicio antiguo / datos legacy)
  const msg = stripHtml(zone.message || '');
  const ftMatch = msg.match(/nivel\s+inferior[:\s]+(\d+(?:\.\d+)?)\s*ft/i);
  if (ftMatch) return parseFloat(ftMatch[1]) * FT_TO_M;

  const mMatch = msg.match(/nivel\s+inferior[:\s]+(\d+(?:\.\d+)?)\s*m/i);
  if (mMatch) return parseFloat(mMatch[1]);

  // 3. FL: "Nivel inferior: FL245" → convertir a metros (1 FL = 100ft = 30.48m)
  const flMatch = msg.match(/nivel\s+inferior[:\s]+FL\s*(\d+)/i);
  if (flMatch) return parseFloat(flMatch[1]) * 100 * FT_TO_M;

  return null;
}

// Altitud AMSL máxima práctica de un dron en España:
// terreno más alto ~3480m (Teide) + 120m AGL = ~3600m. Usamos 3700m con margen.
const MAX_DRONE_AMSL_M = 3700;

/**
 * Filtra las zonas que realmente restringen el vuelo, descartando las informativas
 * y las que empiezan por encima de la altitud máxima alcanzable por un dron.
 */
export function filterRestrictiveZones(zones) {
  return zones.filter(z => {
    const identifier = z.attributes?.identifier || '';
    const msgClean   = stripHtml(z.message);

    if (matchesAny(INFO_ONLY_PATTERNS, msgClean))     return false;
    if (matchesAny(INFO_ONLY_PATTERNS, z.name || '')) return false;
    if (matchesAny(INFO_ONLY_PATTERNS, identifier))   return false;

    // Datos NO AIP — sin base jurídica, se trata como aviso informativo
    if (NO_AIP_PATTERN.test(msgClean) || NO_AIP_PATTERN.test(z.name || '')) return false;

    // Las zonas TMA son siempre informativas — nunca restringen ni limitan altura
    const isTma = matchesAny(TMA_PATTERNS, identifier) || matchesAny(TMA_PATTERNS, msgClean);
    if (isTma) return false;

    // NOTAMs RTCA/RTCE — zonas segregadas PARA drones, no restrictivas para ellos
    if (z.layer === 'NOTAMs activos') {
      const qcode = z.attributes?.qcode || '';
      if (NOTAM_DRONE_ZONE_QCODES.test(qcode)) return false;
    }

    // Zonas que empiezan por encima de la altitud máxima alcanzable por un dron:
    // el nivel inferior está en FL o ft AMSL muy por encima de los 120m AGL.
    const lowerM = parseLowerLimitM(z);
    if (lowerM !== null && lowerM > MAX_DRONE_AMSL_M) {
      console.log(`[ANALYZE] Zona ignorada por nivel inferior demasiado alto: ${z.name || identifier} (lower ~${Math.round(lowerM)}m AMSL)`);
      return false;
    }

    return true;
  });
}

/**
 * Extrae zonas TMA de todas las zonas y las convierte en avisos informativos.
 * Se añaden a reasons como ℹ️ con la altura que mencionan si la tienen.
 */
export function extractTmaWarnings(allZones, reasons) {
  const tmaZones = allZones.filter(z => {
    if (z.layer === 'NOTAMs activos') return false;
    const identifier = z.attributes?.identifier || '';
    const msgClean   = stripHtml(z.message);
    return matchesAny(TMA_PATTERNS, identifier) || matchesAny(TMA_PATTERNS, msgClean);
  });

  tmaZones.forEach(z => {
    const msgClean   = stripHtml(z.message || '');
    const heightMatch = msgClean.match(HEIGHT_EXPLICIT_PATTERN);
    const height      = heightMatch ? heightMatch[0].match(/\d+/)?.[0] : null;
    const name        = z.name || z.attributes?.identifier || 'TMA';
    reasons.push(height
      ? `ℹ️ Zona TMA — ${name}: vuelo VLOS permitido hasta ${height}m fuera de ZGUAS`
      : `ℹ️ Zona TMA — ${name}: consulta restricciones antes de volar`,
    );
  });
}

/**
 * Extrae zonas NO AIP de todas las zonas y las convierte en avisos informativos.
 * El mensaje se limpia de HTML (conservando <b> como **negrita**).
 */
export function extractNoAipWarnings(allZones, reasons) {
  const noAipZones = allZones.filter(z => {
    if (z.layer === 'NOTAMs activos') return false;
    const msgClean = stripHtml(z.message || '');
    return NO_AIP_PATTERN.test(msgClean) || NO_AIP_PATTERN.test(z.name || '');
  });

  noAipZones.forEach(z => {
    const msg     = cleanMessage(z.message || '');
    const rawName = z.name || z.attributes?.identifier || '';
    // Intentar extraer el nombre del helipuerto/hospital del mensaje antes de "Datos NO AIP"
    const nameFromMsg = stripHtml(z.message || '').match(
      /seguridad operacional de\s+([^,.]+?)\s+datos\s+no\s+aip/i,
    );
    const name = (nameFromMsg?.[1] || rawName).trim() || 'Zona';
    reasons.push(`⚠️ NO AIP — ${name} (sin base jurídica para sancionar): ${msg}`);
  });
}

// ─── Análisis de NOTAMs ───────────────────────────────────────────────────────

function analyzeNotams(restrictiveZones, allZones, now, reasons) {
  // NOTAMs que bloquean (R/P/D qcodes o texto prohibitivo), excluyendo RTCA/RTCE
  const forbiddenNotams = restrictiveZones.filter(z => {
    if (z.layer !== 'NOTAMs activos') return false;
    const qcode = z.attributes?.qcode || '';
    if (NOTAM_DRONE_ZONE_QCODES.test(qcode)) return false;
    return NOTAM_RESTRICTIVE_QCODES.test(qcode) || matchesAny(NOTAM_FORBIDDEN_PATTERNS, zoneText(z));
  });

  if (forbiddenNotams.length > 0) {
    forbiddenNotams.sort((a, b) =>
      parseNotamDate(a.attributes?.itemBstr) - parseNotamDate(b.attributes?.itemBstr),
    );

    const activeNow = forbiddenNotams.filter(z => {
      const from = parseNotamDate(z.attributes?.itemBstr);
      const to   = parseNotamDate(z.attributes?.itemCstr);
      return from <= now && (to === 0 || now <= to);
    });
    const notActiveNow = forbiddenNotams.filter(z => !activeNow.includes(z));

    if (activeNow.length > 0) {
      // Bloqueo real — devuelve resultado inmediato
      return {
        blocked: true,
        result: {
          canFly:           false,
          maxAllowedHeight: null,
          reasons: forbiddenNotams.map(z => {
            const range = z.attributes?.itemBstr && z.attributes?.itemCstr
              ? ` (desde ${z.attributes.itemBstr} hasta ${z.attributes.itemCstr})`
              : '';
            const isActive = activeNow.includes(z);
            return isActive
              ? `🚫 NOTAM en vigor — Prohibido: ${z.name}${range}`
              : `⚠️ NOTAM próximo — ${z.name}${range}`;
          }),
          zones: allZones,
        },
      };
    }

    // Solo futuros — acumular como avisos
    notActiveNow.forEach(z => {
      const range = z.attributes?.itemBstr && z.attributes?.itemCstr
        ? ` (desde ${z.attributes.itemBstr} hasta ${z.attributes.itemCstr})`
        : '';
      reasons.push(`⚠️ NOTAM próximo — ${z.name}${range}`);
    });
  }

  // NOTAMs RTCA/RTCE — zonas segregadas para drones: informativos
  const droneZoneNotams = allZones.filter(z => {
    if (z.layer !== 'NOTAMs activos') return false;
    return NOTAM_DRONE_ZONE_QCODES.test(z.attributes?.qcode || '');
  });

  if (droneZoneNotams.length > 0) {
    droneZoneNotams.sort((a, b) =>
      parseNotamDate(a.attributes?.itemBstr) - parseNotamDate(b.attributes?.itemBstr),
    );
    droneZoneNotams.forEach(z => {
      const from     = z.attributes?.itemBstr || null;
      const to       = z.attributes?.itemCstr || null;
      const range    = from && to ? ` (desde ${from} hasta ${to})` : '';
      const f        = parseNotamDate(from);
      const t        = parseNotamDate(to);
      const isActive = f <= now && (t === 0 || now <= t);
      reasons.push(isActive
        ? `ℹ️ NOTAM activo: ${z.name}${range}`
        : `ℹ️ NOTAM próximo: ${z.name}${range}`,
      );
    });
  }

  return { blocked: false };
}

// ─── Análisis de alturas ──────────────────────────────────────────────────────

function analyzeHeights(restrictiveZones, terrainElevation, reasons, permittedHeights) {
  let allZonesAreHigh = true;

  // Zonas condicionales (libre hasta Xm desde ref. aeródromo)
  const conditionalZones = restrictiveZones.filter(z =>
    CONDITIONAL_HEIGHT_PATTERN.test(stripHtml(z.message || z.warning || '')),
  );

  for (const z of conditionalZones) {
    const msg = stripHtml(z.message || z.warning || '');
    const m   = msg.match(CONDITIONAL_HEIGHT_PATTERN);
    if (!m) continue;

    const limitAgl = parseInt(m[1], 10);
    const aeroRef  = m[2] ? parseInt(m[2], 10) : null;

    if (terrainElevation !== null && aeroRef !== null) {
      const restrictionAmsl = aeroRef + limitAgl;
      const maxFlyable      = restrictionAmsl - terrainElevation;

      if (maxFlyable <= 0) {
        return {
          blocked: true,
          result: {
            canFly:           false,
            maxAllowedHeight: null,
            reasons: [`Prohibido: ${z.name} — el terreno (${terrainElevation}m AMSL) supera la cota de restricción (${restrictionAmsl}m AMSL = aeródromo ${aeroRef}m + ${limitAgl}m)`],
            zones: [],
          },
        };
      }

      if (maxFlyable >= 120) {
        reasons.push(`Sin restricción efectiva a esta altitud: ${z.name} (restricción a ${restrictionAmsl}m AMSL, terreno a ${terrainElevation}m)`);
      } else {
        permittedHeights.push(maxFlyable);
        reasons.push(`Permitido hasta ${maxFlyable}m sobre el terreno: ${z.name} — restricción a partir de ${restrictionAmsl}m AMSL (aeródromo ref. ${aeroRef}m + ${limitAgl}m, terreno ${terrainElevation}m)`);
      }
    } else {
      permittedHeights.push(limitAgl);
      reasons.push(`Permitido hasta ${limitAgl}m desde ref. aeródromo: ${z.name}${aeroRef ? ` (aeródromo a ${aeroRef}m AMSL, elevación terreno no disponible)` : ''}`);
    }
    allZonesAreHigh = false;
  }

  // Zonas no condicionales: buscar altura en el mensaje
  for (const z of restrictiveZones) {
    if (conditionalZones.includes(z)) continue;

    const msg      = z.message || z.warning || '';
    const msgClean = stripHtml(msg).toLowerCase();

    const isPermitRequired =
      /por debajo de\s*\d{1,4}\s*m[^.]*(?:se requiere|requiere|es necesario|necesita|autoriza|permiso)/i.test(msgClean);

    const heightMatch = isPermitRequired ? null : (
      msg.match(/por debajo de\s*(\d{1,4})\s*m/iu)      ||
      msg.match(/altura m[aá]xima de\s*(\d{1,4})\s*m/iu) ||
      msg.match(/permitidas?\s*[^\d]*(\d{1,4})\s*m/iu)   ||
      msg.match(/hasta\s*(\d{1,4})\s*m/iu)
    );

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

  return { blocked: false, allZonesAreHigh };
}

// ─── analyzeFlightPermission ──────────────────────────────────────────────────

/**
 * Analiza zonas restrictivas y devuelve el resultado de vuelo.
 * @param {object[]} restrictiveZones — zonas ya filtradas (sin informativas)
 * @param {object[]} allZones         — todas las zonas (para avisos RTCA)
 * @param {number|null} terrainElevation
 */
export function analyzeFlightPermission(restrictiveZones, allZones, terrainElevation = null) {
  const reasons          = [];
  const permittedHeights = [];
  const now              = Date.now();

  // ── Avisos TMA (informativos, siempre se procesan) ──
  extractTmaWarnings(allZones, reasons);

  // ── Avisos NO AIP (sin base jurídica, siempre informativos) ──
  extractNoAipWarnings(allZones, reasons);

  // ── 1. NOTAMs (siempre se procesan: también añade avisos RTCA/RTCE informativos) ──
  const notamResult = analyzeNotams(restrictiveZones, allZones, now, reasons);
  if (notamResult.blocked) return { ...notamResult.result, zones: allZones };

  // Los NOTAMs ya fueron procesados (bloqueantes activos → bloquearon; futuros → aviso ⚠️;
  // RTCA/RTCE → aviso ℹ️). Los excluimos de las zonas a analizar para evitar falsos bloqueos.
  const nonNotamZones = restrictiveZones.filter(z => z.layer !== 'NOTAMs activos');

  // Sin zonas restrictivas → vuelo libre, pero con posibles avisos TMA y NOTAM
  if (nonNotamZones.length === 0) {
    return {
      ...FREE_FLIGHT,
      reasons: ['No hay restricciones activas en la zona. Permitido hasta 120m.', ...reasons],
      zones: allZones,
    };
  }

  // ── 2. Restricción fotográfica ──
  const photoBlocked = nonNotamZones.filter(z => matchesAny(PHOTO_FLIGHT_PATTERNS, zoneText(z)));
  if (photoBlocked.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons:          photoBlocked.map(z => `Bloqueo por restricción fotográfica: ${z.name}`),
      zones:            allZones,
    };
  }

  // ── 3. Prohibición absoluta (excluye las condicionales y las de "coordinación requerida") ──
  const conditionalZones = nonNotamZones.filter(z =>
    CONDITIONAL_HEIGHT_PATTERN.test(stripHtml(z.message || z.warning || '')),
  );

  // Zonas de coordinación requerida: "no permitido excepto coordinación" → bloquean el vuelo
  // pero con mensaje diferente a "Prohibido" y no son prohibición absoluta
  const coordinationZones = nonNotamZones.filter(z => {
    if (conditionalZones.includes(z)) return false;
    return COORDINATION_EXCEPTION_PATTERN.test(zoneText(z));
  });
  if (coordinationZones.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons: [
        ...reasons,
        ...coordinationZones.map(z => `Requiere coordinación: ${z.name}`),
      ],
      zones: allZones,
    };
  }

  const forbidden = nonNotamZones.filter(z => {
    if (conditionalZones.includes(z)) return false;
    return matchesAny(FORBIDDEN_PATTERNS, zoneText(z));
  });
  if (forbidden.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons:          forbidden.map(z => `Prohibido: ${z.name}`),
      zones:            allZones,
    };
  }

  // ── 4. Análisis de alturas ──
  const heightResult = analyzeHeights(nonNotamZones, terrainElevation, reasons, permittedHeights);
  if (heightResult.blocked) return { ...heightResult.result, zones: allZones };

  if (heightResult.allZonesAreHigh) {
    return {
      ...FREE_FLIGHT,
      reasons: [
        'No hay restricciones activas en la zona. Permitido hasta 120m.',
        ...reasons.filter(r => r.startsWith('⚠️')),
        ...reasons.filter(r => r.startsWith('ℹ️')),
        ...reasons.filter(r => !r.startsWith('⚠️') && !r.startsWith('ℹ️')),
      ],
      zones: allZones,
    };
  }

  if (permittedHeights.length > 0) {
    const sortedReasons = [
      ...reasons.filter(r => r.startsWith('Permitido')),
      ...reasons.filter(r => r.startsWith('⚠️')),
      ...reasons.filter(r => r.startsWith('ℹ️')),
      ...reasons.filter(r => !r.startsWith('Permitido') && !r.startsWith('⚠️') && !r.startsWith('ℹ️')),
    ];
    return { canFly: true, maxAllowedHeight: Math.min(...permittedHeights), reasons: sortedReasons, zones: allZones };
  }

  // ── 5. Requiere coordinación ──
  return {
    canFly:           false,
    maxAllowedHeight: null,
    reasons: [
      ...reasons,
      ...nonNotamZones.map(z => `Requiere coordinación: ${z.name}`),
    ],
    zones: allZones,
  };
}
