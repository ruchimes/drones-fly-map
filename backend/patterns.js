/**
 * patterns.js — Constantes regex y utilidades de texto para el análisis de zonas ENAIRE.
 */

/** Vuelo prohibido de forma absoluta */
export const FORBIDDEN_PATTERNS = [
  /no\s+(est[aá]\s+)?permitido\s+el\s+vuelo\s+(a|de)\s+(drones?|uas|rpas)/i,
  /vuelo\s+(a|de)\s+(drones?|uas|rpas)\s+(no\s+)?permitido/i,
  /prohibido\s+el\s+vuelo\s+(a|de)\s+(drones?|uas|rpas)/i,
  /prohibido\s+el\s+vuelo/i,
  /no\s+(est[aá]\s+)?permitido\s+el\s+vuelo/i,
];

/**
 * Excepción a FORBIDDEN: "no permitido... excepto coordinación" indica que SÍ
 * se puede volar con coordinación previa — es coordinación requerida, no prohibición absoluta.
 */
export const COORDINATION_EXCEPTION_PATTERN =
  /no\s+permitido[^.]*excepto\s+coordinaci[oó]n/i;

/**
 * Detecta zonas con altura libre hasta Xm y prohibición por encima.
 * Captura: [1] límite AGL desde ref. aeródromo, [2] cota AMSL del aeródromo (opcional).
 * Ej: "Por debajo de 90m medidos desde el punto de referencia del aeródromo (442m), no es necesario coordinar"
 */
export const CONDITIONAL_HEIGHT_PATTERN =
  /por debajo de\s*(\d{1,4})\s*m[^(]*(?:\((\d{1,5})m\))?[^.]*no es necesario coordinar/iu;

/** Vuelo fotográfico / captación de datos restringido */
export const PHOTO_FLIGHT_PATTERNS = [
  /restringida al vuelo fotogr[aá]fico/i,
  /restringida al vuelo de fotograf[ií]a/i,
  /restringida al vuelo para fotograf[ií]a/i,
  /restringida al vuelo de captaci[oó]n de datos/i,
  /restringida al vuelo de imagen/i,
  /restringida al vuelo de c[aá]maras/i,
];

/** Zonas meramente informativas — no restringen el vuelo de drones */
export const INFO_ONLY_PATTERNS = [
  /antes de volar compruebe si la zona.*entorno urbano/is,  // aviso entorno urbano (toda España)
  // Zonas militares de entrenamiento de alta cota (vuelos supersónicos, LER/CTA militares)
  // que requieren coordinar con TWR militar — no aplican a drones UAS en categoría abierta
  /área expresamente designada para vuelos supersónicos/i,
  /area specifically designated for supersonic flights/i,
];

/**
 * Zona con datos NO AIP: la información no proviene de publicaciones AIP oficiales,
 * por lo que no tiene base jurídica para sancionar. Se trata como aviso informativo.
 */
export const NO_AIP_PATTERN = /datos\s+no\s+aip/i;

/**
 * Zonas TMA — informativas SALVO que especifiquen una altura máxima explícita.
 * Se comprueba contra identificador y mensaje.
 */
export const TMA_PATTERNS = [
  /_TMA$/i,                                    // TMA por identificador (ej. LECM_TMA)
  /espacio a[eé]reo controlado\s+TMA\b/i,      // TMA por mensaje
];

/** Detecta si un mensaje contiene una altura máxima explícita (ej. "altura máxima de 60m") */
export const HEIGHT_EXPLICIT_PATTERN = /altura m[aá]xima de\s*\d{1,4}\s*m/i;

/** qcodes NOTAM restrictivos: R=restricted, P=prohibited, D=danger */
export const NOTAM_RESTRICTIVE_QCODES = /^[RPD]/i;

/** RTCA/RTCE = zona temporalmente segregada PARA drones (no contra drones) */
export const NOTAM_DRONE_ZONE_QCODES = /^RTC[AE]/i;

/** Patrones que indican que un NOTAM prohíbe o restringe el vuelo de drones */
export const NOTAM_FORBIDDEN_PATTERNS = [
  /drone.*prohibid/i,
  /prohibid.*drone/i,
  /UAS.*prohibid/i,
  /prohibid.*UAS/i,
  /RPAS.*prohibid/i,
  /prohibid.*RPAS/i,
  /vuelo\s+(de\s+)?(drones?|uas|rpas)\s+(no\s+)?permitido/i,
  /no\s+(est[aá]\s+)?permitido.*vuelo/i,
  /TEMPO\s+RESTRICTED\s+AREA/i,
  /TEMPORARY\s+RESTRICTED/i,
  /\bPROHIBITED\s+AREA\b/i,
];

// ─── Utilidades de texto ──────────────────────────────────────────────────────

/** Elimina etiquetas HTML y normaliza espacios en blanco */
export const stripHtml = str => str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Limpia HTML para mostrar al usuario:
 *  - <br>, <br/> → eliminados (salto implícito en lista)
 *  - <b>…</b>, <strong>…</strong> → **…** (negrita markdown)
 *  - resto de tags → eliminados
 *  - espacios múltiples → uno solo
 */
export const cleanMessage = str => str
  .replace(/<br\s*\/?>/gi, '')
  .replace(/<\/?(b|strong)[^>]*>/gi, '**')
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Texto combinado (message + warning) de una zona, sin HTML y en minúsculas */
export const zoneText = zone =>
  stripHtml(`${zone.message || ''} ${zone.warning || ''}`).toLowerCase();

/** true si alguno de los patrones coincide con el texto */
export const matchesAny = (patterns, text) => patterns.some(p => p.test(text));

/** Parsea "DD/MM/YYYY HH:mm:ss" → timestamp ms */
export const parseNotamDate = str => {
  if (!str) return 0;
  const [d, m, y, H, M, S] = str.match(/(\d+)/g);
  return new Date(`${y}-${m}-${d}T${H}:${M}:${S}`).getTime();
};
