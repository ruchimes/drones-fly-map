/**
 * urban.js — Detección de entorno urbano para un punto dado (lat, lon).
 *
 * Usa Nominatim (OpenStreetMap) reverse geocoding con zoom=18 para obtener
 * el objeto OSM directamente bajo el cursor, no solo el municipio.
 *
 * Lógica (por orden de prioridad):
 *  1. Si el objeto bajo el cursor es un edificio, vía urbana, landuse residencial/
 *     comercial/industrial → URBANO (high)
 *  2. Si el objeto es natural (water, wood, scrub, farmland…) o place/locality → NO URBANO (high)
 *  3. Si el address tiene city/town/suburb Y place_rank >= 26 → URBANO (medium)
 *     (place_rank alto = el objeto está dentro de un área edificada)
 *  4. Si solo hay municipality/village/hamlet en el address → NO URBANO (medium)
 */

import axios from 'axios';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Objetos que indican inequívocamente suelo urbano construido (sin necesidad de verificar address)
const UNCONDITIONAL_URBAN_CLASSES = new Set([
  'building',
  'shop',
  'office',
]);

const URBAN_LANDUSE_TYPES = new Set([
  'residential', 'commercial', 'industrial', 'retail',
  'garages', 'construction', 'brownfield',
]);

// Clases que son urbanas SOLO si el address confirma que estamos en ciudad/pueblo
// (amenity, tourism, leisure pueden aparecer en campo abierto)
const CONDITIONAL_URBAN_CLASSES = new Set([
  'amenity', 'tourism', 'leisure',
]);

// Objetos naturales o rurales (sin importar si el address dice ciudad)
const UNCONDITIONAL_RURAL_CLASSES = new Set([
  'natural', 'waterway',
]);

const UNCONDITIONAL_RURAL_TYPES = new Set([
  'farmland', 'farmyard', 'forest', 'wood', 'scrub', 'grassland', 'heath',
  'meadow', 'orchard', 'vineyard', 'wetland', 'water', 'stream', 'river',
]);

// place/locality → rural (es un topónimo de lugar despoblado, no un núcleo)
const RURAL_PLACE_TYPES = new Set([
  'locality', 'hamlet', 'isolated_dwelling', 'farm',
]);

// Highways inequívocamente urbanas (calles, plazas, aceras, carriles bici…)
// Activadas con cualquier núcleo: city/town/village/suburb/neighbourhood
const URBAN_HIGHWAY_TYPES = new Set([
  'residential', 'living_street', 'pedestrian', 'footway',
  'steps', 'cycleway',
]);

// Highways ambiguas: urbanas en ciudad/town/suburb, pero pueden ser rurales en village
// 'unclassified' = carretera sin clasificar, frecuentemente periurbana o rural
// 'service' = vial de acceso, puede ser en polígono industrial o cortijo
// 'tertiary/secondary/primary' = carreteras que atraviesan pueblos pero también campo
const AMBIGUOUS_HIGHWAY_TYPES = new Set([
  'tertiary', 'secondary', 'primary', 'unclassified', 'service',
]);

// Highways que son rurales (carreteras de campo)
const RURAL_HIGHWAY_TYPES = new Set([
  'track', 'path', 'bridleway',
]);

// Campos del address que confirman entorno urbano (más específicos que city/town)
const URBAN_ADDRESS_FIELDS = ['suburb', 'quarter', 'neighbourhood', 'borough', 'city_district'];

// Campos que indican asentamiento rural sin núcleo edificado
// Nota: 'village' NO está aquí — un village es un núcleo urbano (casco de pueblo)
const RURAL_ADDRESS_FIELDS = ['hamlet', 'isolated_dwelling', 'farm'];

/**
 * Lógica pura de clasificación, separada del fetch HTTP.
 * Exportada para poder ser testada unitariamente sin red.
 *
 * @param {object} data  — Respuesta JSON de Nominatim
 * @returns {{ isUrban: boolean, confidence: string, reason: string, details: object }}
 */
export function _classify(data) {
    const address    = data.address    || {};
    const osmClass   = data.class      || '';
    const osmType    = data.type       || '';
    const placeRank  = data.place_rank || 0;

    // ── 1. Objeto inequívocamente urbano (edificio, tienda, oficina) ───────
    if (UNCONDITIONAL_URBAN_CLASSES.has(osmClass)) {
      return urban('high', `${osmClass} (${osmType})`, { address, osmClass, osmType, placeRank });
    }

    if (osmClass === 'landuse' && URBAN_LANDUSE_TYPES.has(osmType)) {
      return urban('high', `suelo ${osmType}`, { address, osmClass, osmType, placeRank });
    }

    // ── 2. Objeto inequívocamente rural (natural, agua, cultivos…) ─────────
    // Excepción SOLO para natural/waterway (árboles, arroyos puntuales), NO para landuse:
    // un árbol o fuente dentro del tejido urbano (rank>=28 + núcleo en address)
    // es un elemento puntual en zona urbana. Un prado sigue siendo suelo rural.
    if (UNCONDITIONAL_RURAL_CLASSES.has(osmClass) || UNCONDITIONAL_RURAL_TYPES.has(osmType)) {
      if (osmClass !== 'landuse' && placeRank >= 28) {
        const nucleoField = ['city', 'town', 'village', ...URBAN_ADDRESS_FIELDS].find(f => address[f]);
        if (nucleoField) {
          return urban('medium', `${address[nucleoField]} (${osmClass}/${osmType} en núcleo)`, { address, osmClass, osmType, placeRank });
        }
      }
      return rural('high', `${osmClass}/${osmType}`, { address, osmClass, osmType, placeRank });
    }

    // ── 3. place/locality → siempre rural (topónimo sin edificación) ───────
    if (osmClass === 'place' && RURAL_PLACE_TYPES.has(osmType)) {
      return rural('high', `${data.name || osmType} (${osmType})`, { address, osmClass, osmType, placeRank });
    }

    // ── 4. Landuse no urbano → rural ───────────────────────────────────────
    if (osmClass === 'landuse' && !URBAN_LANDUSE_TYPES.has(osmType)) {
      return rural('high', `suelo ${osmType}`, { address, osmClass, osmType, placeRank });
    }

    // ── 5. Highway rural (pista, camino) ────────────────────────────────────
    if (osmClass === 'highway' && RURAL_HIGHWAY_TYPES.has(osmType)) {
      return rural('high', `camino/pista (${osmType})`, { address, osmClass, osmType, placeRank });
    }

    // ── 6. Highway urbana: requiere address con city/town/village ─────────
    // Calles inequívocamente urbanas (residential, pedestrian…): válidas con cualquier núcleo.
    if (osmClass === 'highway' && URBAN_HIGHWAY_TYPES.has(osmType)) {
      const nucleoField = ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood'].find(f => address[f]);
      if (nucleoField) {
        return urban('high', `${osmType} en ${address[nucleoField]}`, { address, osmClass, osmType, placeRank });
      }
    }

    // ── 6b. Highway ambigua (unclassified, service, tertiary…): solo con núcleo fuerte ──
    // Estas vías atraviesan tanto cascos urbanos como campo abierto.
    // Solo se considera urbano si hay city/town/suburb (no basta con village solo).
    if (osmClass === 'highway' && AMBIGUOUS_HIGHWAY_TYPES.has(osmType)) {
      const nucleoFuerte = ['city', 'town', 'suburb', 'quarter', 'borough'].find(f => address[f]);
      if (nucleoFuerte) {
        return urban('high', `${osmType} en ${address[nucleoFuerte]}`, { address, osmClass, osmType, placeRank });
      }
      // village solo → puede ser carretera que pasa por el término, no por el casco
      // cae al fallback por address+rank
    }

    // ── 7. Amenity/tourism/leisure: urbano solo si address lo confirma ─────
    // Pueden estar en ciudad, pueblo, urbanización O en campo abierto.
    // Núcleos que confirman entorno urbano: city, town, village (pueblo),
    // suburb/quarter (barrio de ciudad).
    // Excepción: neighbourhood SIN city/town/village puede ser una urbanización
    // de sierra indexada como neighbourhood → solo urbano si rank >= 28.
    if (CONDITIONAL_URBAN_CLASSES.has(osmClass)) {
      const nucleoField = ['city', 'town', 'village', 'suburb', 'quarter', 'borough'].find(f => address[f]);
      if (nucleoField && placeRank >= 26) {
        return urban('medium', `${address[nucleoField]} (${osmClass}/${osmType})`, { address, osmClass, osmType, placeRank });
      }
      // neighbourhood sin city/town/village: urbanización aislada, solo si rank muy alto
      if (address.neighbourhood && !address.city && !address.town && !address.village && placeRank >= 28) {
        return urban('medium', `${address.neighbourhood} (urbanización, ${osmType})`, { address, osmClass, osmType, placeRank });
      }
      return rural('medium', `${osmType} sin núcleo identificado`, { address, osmClass, osmType, placeRank });
    }

    // ── 8. Inferir solo por address + place_rank ───────────────────────────
    const suburbField = URBAN_ADDRESS_FIELDS.find(f => address[f]);
    if (suburbField && placeRank >= 26) {
      return urban('medium', `${address[suburbField]} (${suburbField})`, { address, osmClass, osmType, placeRank });
    }

    // city/town/village con rank alto → dentro del tejido urbano del núcleo
    const cityField2 = ['city', 'town', 'village'].find(f => address[f]);
    if (cityField2 && placeRank >= 28) {
      return urban('medium', `${address[cityField2]} (rank ${placeRank})`, { address, osmClass, osmType, placeRank });
    }

    // ── 9. Solo municipio/hamlet/campo sin evidencia directa → rural ───────
    const ruralField = ['hamlet', 'isolated_dwelling', 'farm'].find(f => address[f]);
    if (ruralField) {
      return rural('medium', `${address[ruralField]} (${ruralField})`, { address, osmClass, osmType, placeRank });
    }

    const municipality = address.municipality || address.county || address.state_district || '';
    return rural('low', municipality ? `término de ${municipality}` : 'sin núcleo identificado', { address, osmClass, osmType, placeRank });
}

export async function checkUrban(lat, lon) {
  try {
    const { data } = await axios.get(NOMINATIM_URL, {
      params: { lat, lon, format: 'json', zoom: 18, addressdetails: 1 },
      headers: { 'User-Agent': 'drones-app/1.0' },
      timeout: 8000,
    });
    return _classify(data);
  } catch (err) {
    console.warn(`[URBAN] Error consultando Nominatim: ${err.message}`);
    return { isUrban: null, confidence: 'unknown', reason: 'No se pudo determinar el entorno (error de red)', details: { error: err.message } };
  }
}

const urban = (confidence, reason, details) => ({ isUrban: true,  confidence, reason, details });
const rural = (confidence, reason, details) => ({ isUrban: false, confidence, reason, details });
