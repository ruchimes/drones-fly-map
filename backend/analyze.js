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
  stripHtml,
  zoneText,
  matchesAny,
  parseNotamDate,
} from './patterns.js';

export const FREE_FLIGHT = {
  canFly:           true,
  maxAllowedHeight: 120,
  reasons:          ['No hay restricciones activas en la zona. Permitido hasta 120m.'],
  zones:            [],
};

// ─── Filtro de zonas restrictivas ─────────────────────────────────────────────

/**
 * Filtra las zonas que realmente restringen el vuelo, descartando las informativas.
 * Las TMA solo se incluyen si tienen una altura máxima explícita en el mensaje.
 */
export function filterRestrictiveZones(zones) {
  return zones.filter(z => {
    const identifier = z.attributes?.identifier || '';
    const msgClean   = stripHtml(z.message);

    if (matchesAny(INFO_ONLY_PATTERNS, msgClean))    return false;
    if (matchesAny(INFO_ONLY_PATTERNS, z.name || '')) return false;
    if (matchesAny(INFO_ONLY_PATTERNS, identifier))   return false;

    const isTma = matchesAny(TMA_PATTERNS, identifier) || matchesAny(TMA_PATTERNS, msgClean);
    if (isTma && !HEIGHT_EXPLICIT_PATTERN.test(msgClean)) return false;

    return true;
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
  if (restrictiveZones.length === 0) return FREE_FLIGHT;

  const reasons          = [];
  const permittedHeights = [];
  const now              = Date.now();

  // ── 1. NOTAMs ──
  const notamResult = analyzeNotams(restrictiveZones, allZones, now, reasons);
  if (notamResult.blocked) return { ...notamResult.result, zones: allZones };

  // ── 2. Restricción fotográfica ──
  const photoBlocked = restrictiveZones.filter(z => matchesAny(PHOTO_FLIGHT_PATTERNS, zoneText(z)));
  if (photoBlocked.length > 0) {
    return {
      canFly:           false,
      maxAllowedHeight: null,
      reasons:          photoBlocked.map(z => `Bloqueo por restricción fotográfica: ${z.name}`),
      zones:            allZones,
    };
  }

  // ── 3. Prohibición absoluta (excluye las condicionales) ──
  const conditionalZones = restrictiveZones.filter(z =>
    CONDITIONAL_HEIGHT_PATTERN.test(stripHtml(z.message || z.warning || '')),
  );
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

  // ── 4. Análisis de alturas ──
  const heightResult = analyzeHeights(restrictiveZones, terrainElevation, reasons, permittedHeights);
  if (heightResult.blocked) return { ...heightResult.result, zones: allZones };

  if (heightResult.allZonesAreHigh) {
    return {
      ...FREE_FLIGHT,
      reasons: ['No hay restricciones activas en la zona. Permitido hasta 120m.', ...reasons],
      zones: allZones,
    };
  }

  if (permittedHeights.length > 0) {
    const sortedReasons = [
      ...reasons.filter(r => r.startsWith('Permitido')),
      ...reasons.filter(r => !r.startsWith('Permitido')),
    ];
    return { canFly: true, maxAllowedHeight: Math.min(...permittedHeights), reasons: sortedReasons, zones: allZones };
  }

  // ── 5. Requiere coordinación ──
  return {
    canFly:           false,
    maxAllowedHeight: null,
    reasons: [
      ...reasons,
      ...restrictiveZones
        .filter(z => z.layer !== 'NOTAMs activos')
        .map(z => `Requiere coordinación: ${z.name}`),
    ],
    zones: allZones,
  };
}
