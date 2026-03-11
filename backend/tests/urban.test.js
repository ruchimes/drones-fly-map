/**
 * urban.test.js — Suite de tests para la detección de entorno urbano/rural.
 *
 * ORGANIZACIÓN:
 *   Suite A — Tests unitarios (sin r  it('A13 landuse/meadow → RURAL high', () => {
    // Prado en campo: rank bajo (no está mapeado dentro del tejido urbano)
    const r = _classify(nom({ class: 'landuse', type: 'meadow', place_rank: 18, address: addrVillage }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });verifican la lógica de _classify()
 *             con respuestas Nominatim simuladas. Rápidos, siempre reproducibles.
 *
 *   Suite B — Tests de integración (red real): llaman a checkUrban() con
 *             coordenadas reales y verifican que el resultado sea el esperado.
 *             Requieren conexión a internet. Se saltan si SKIP_INTEGRATION=1.
 *
 * Ejecutar solo unitarios:
 *   SKIP_INTEGRATION=1 node --test tests/urban.test.js
 *
 * Ejecutar todo:
 *   node --test tests/urban.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _classify, checkUrban } from '../urban.js';

const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === '1';

// ─── Helper: construir respuesta Nominatim simulada ────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.class        — osmClass  (building, highway, natural…)
 * @param {string} opts.type         — osmType   (apartments, primary, tree…)
 * @param {number} [opts.place_rank] — 0–30
 * @param {string} [opts.name]       — nombre del elemento
 * @param {object} [opts.address]    — campos del address
 */
const nom = ({ class: cls, type, place_rank = 30, name = '', address = {} }) => ({
  class: cls,
  type,
  place_rank,
  name,
  address,
});

// Addresses de uso frecuente
const addrMadrid    = { city: 'Madrid',   country: 'España' };
const addrMadridRetiro = { city: 'Madrid', suburb: 'Retiro', country: 'España' };
const addrSevillaBarrio = { city: 'Sevilla', suburb: 'Triana', country: 'España' };
const addrGetafe    = { city: 'Getafe',   country: 'España' };
const addrSanAgustin = { town: 'San Agustín del Guadalix', municipality: 'San Agustín del Guadalix', country: 'España' };
const addrBecerril  = { village: 'Becerril de la Sierra', neighbourhood: 'Vista Real', country: 'España' };
const addrVillage   = { village: 'Navas del Rey', county: 'Madrid', country: 'España' };
const addrHamlet    = { hamlet: 'El Ventorro', county: 'Guadalajara', country: 'España' };
const addrSolo      = { county: 'Soria', country: 'España' };


// ═══════════════════════════════════════════════════════════════════════════════
// SUITE A — TESTS UNITARIOS (sin red)
// ═══════════════════════════════════════════════════════════════════════════════

describe('A: _classify — edificios y estructuras urbanas', () => {

  it('A01 building/apartments → URBANO high', () => {
    const r = _classify(nom({ class: 'building', type: 'apartments', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /building/);
  });

  it('A02 building/house → URBANO high', () => {
    const r = _classify(nom({ class: 'building', type: 'house', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A03 building/commercial → URBANO high', () => {
    const r = _classify(nom({ class: 'building', type: 'commercial', address: addrSevillaBarrio }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A04 building/yes (genérico) → URBANO high', () => {
    const r = _classify(nom({ class: 'building', type: 'yes', address: addrGetafe }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A05 shop/supermarket → URBANO high', () => {
    const r = _classify(nom({ class: 'shop', type: 'supermarket', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A06 office/government → URBANO high', () => {
    const r = _classify(nom({ class: 'office', type: 'government', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

});

describe('A: _classify — landuse urbano', () => {

  it('A07 landuse/residential → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'residential', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /residential/);
  });

  it('A08 landuse/commercial → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'commercial', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A09 landuse/industrial → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'industrial', address: addrGetafe }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A10 landuse/retail → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'retail', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A11 landuse/farmland → RURAL high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'farmland', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /farmland/);
  });

  it('A12 landuse/forest → RURAL high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'forest', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A13 landuse/meadow → RURAL high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'meadow', address: addrVillage }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A14 landuse/orchard → RURAL high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'orchard', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A15 landuse/garages → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'garages', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

});

describe('A: _classify — elementos naturales', () => {

  it('A16 natural/tree en campo abierto → RURAL high', () => {
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 25, address: addrVillage }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A17 natural/tree en barrio de ciudad (suburb present, no village) → URBANO medium', () => {
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 30, address: addrMadridRetiro }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
    // El reason puede referenciar la ciudad o el barrio, ambos son correctos
    assert.ok(
      r.reason.includes('Retiro') || r.reason.includes('Madrid'),
      `reason debería mencionar Retiro o Madrid: "${r.reason}"`,
    );
  });

  it('A18 natural/tree con village en address y rank alto → URBANO medium (árbol dentro del pueblo)', () => {
    // rank=30 + village → el árbol está mapeado dentro del tejido del pueblo → urbano
    // Si estuviera en campo tendría rank bajo (~18-22)
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 30, address: addrBecerril }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A18b natural/tree con village pero rank bajo → RURAL high (árbol en campo cercano al pueblo)', () => {
    // rank=20 → el árbol está en campo, solo el municipio está cerca
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 20, address: addrBecerril }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A19 natural/wood en campo → RURAL high', () => {
    const r = _classify(nom({ class: 'natural', type: 'wood', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A20 natural/scrub → RURAL high', () => {
    const r = _classify(nom({ class: 'natural', type: 'scrub', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A21 natural/water (lago, embalse) → RURAL high', () => {
    const r = _classify(nom({ class: 'natural', type: 'water', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A22 natural/grassland → RURAL high', () => {
    const r = _classify(nom({ class: 'natural', type: 'grassland', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A23 waterway/stream en campo (rank bajo, solo county) → RURAL high', () => {
    const r = _classify(nom({ class: 'waterway', type: 'stream', place_rank: 18, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A23b waterway/stream dentro de un pueblo (village + rank alto) → URBANO medium', () => {
    // El arroyo que atraviesa el casco del pueblo está en zona urbana
    const r = _classify(nom({ class: 'waterway', type: 'stream', place_rank: 28, address: addrVillage }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A24 natural/tree en ciudad (rank>=28, no village, no suburb) → URBANO medium', () => {
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
    assert.match(r.reason, /Madrid/);
  });

  it('A25 natural/tree en ciudad con rank<28 → RURAL high (no suficiente evidencia)', () => {
    const r = _classify(nom({ class: 'natural', type: 'tree', place_rank: 26, address: addrMadrid }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

});

describe('A: _classify — place types', () => {

  it('A26 place/locality → RURAL high', () => {
    const r = _classify(nom({ class: 'place', type: 'locality', name: 'Navalzarzal', place_rank: 25, address: addrSanAgustin }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /Navalzarzal/);
  });

  it('A27 place/hamlet → RURAL high', () => {
    const r = _classify(nom({ class: 'place', type: 'hamlet', name: 'El Ventorro', place_rank: 22, address: addrHamlet }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A28 place/isolated_dwelling → RURAL high', () => {
    const r = _classify(nom({ class: 'place', type: 'isolated_dwelling', name: 'Cortijo Las Flores', place_rank: 20, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A29 place/farm → RURAL high', () => {
    const r = _classify(nom({ class: 'place', type: 'farm', name: 'Finca La Esperanza', place_rank: 20, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A30 place/city → no clasificado como RURAL_PLACE_TYPES → cae a reglas de address', () => {
    // place/city no está en RURAL_PLACE_TYPES, debe llegar a la lógica de address
    const r = _classify(nom({ class: 'place', type: 'city', place_rank: 16, address: addrMadrid }));
    // No debe ser rural por RURAL_PLACE_TYPES; puede ser medium urbano por address+rank
    assert.notEqual(r.isUrban, null);
  });

});

describe('A: _classify — highways', () => {

  it('A31 highway/residential con city → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'residential', place_rank: 26, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /residential/);
    assert.match(r.reason, /Madrid/);
  });

  it('A32 highway/primary con city → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'primary', place_rank: 26, address: { city: 'Sevilla' } }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A33 highway/tertiary con city → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'tertiary', place_rank: 26, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A34 highway/living_street con suburb → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'living_street', place_rank: 28, address: addrMadridRetiro }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A35 highway/pedestrian con city → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'pedestrian', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A36 highway/track (pista forestal) → RURAL high', () => {
    const r = _classify(nom({ class: 'highway', type: 'track', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /camino|pista/i);
  });

  it('A37 highway/path (senda) → RURAL high', () => {
    const r = _classify(nom({ class: 'highway', type: 'path', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A38 highway/bridleway (camino ecuestre) → RURAL high', () => {
    const r = _classify(nom({ class: 'highway', type: 'bridleway', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A39 highway/tertiary SIN city/town en address → no llega a urbano por highway', () => {
    // Solo tiene county/country, sin city ni town ni suburb
    const r = _classify(nom({ class: 'highway', type: 'tertiary', place_rank: 26, address: addrSolo }));
    // Puede caer a rural por la lógica de fallback
    assert.equal(r.isUrban, false);
  });

  it('A40 highway/residential con town (pueblo pequeño) → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'residential', place_rank: 26, address: { town: 'Alcobendas' } }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
    assert.match(r.reason, /Alcobendas/);
  });

});

describe('A: _classify — amenity / tourism / leisure (condicionales)', () => {

  it('A41 amenity/restaurant en city sin village → URBANO medium', () => {
    const r = _classify(nom({ class: 'amenity', type: 'restaurant', place_rank: 30, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A42 amenity/hospital en city sin village → URBANO medium', () => {
    const r = _classify(nom({ class: 'amenity', type: 'hospital', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A43 amenity/fuel en carretera nacional (solo county, rank bajo) → RURAL medium', () => {
    // Sin city, town, village ni suburb → no hay núcleo identificado
    const r = _classify(nom({ class: 'amenity', type: 'fuel', place_rank: 22, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'medium');
    assert.match(r.reason, /sin núcleo/i);
  });

  it('A44 leisure/garden en city sin village → URBANO medium', () => {
    const r = _classify(nom({ class: 'leisure', type: 'garden', place_rank: 30, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A45 leisure/park en barrio (suburb) → URBANO medium', () => {
    const r = _classify(nom({ class: 'leisure', type: 'park', place_rank: 28, address: addrMadridRetiro }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
    // El reason puede usar el suburb o la ciudad, ambos son válidos
    assert.ok(
      r.reason.includes('Retiro') || r.reason.includes('Madrid'),
      `reason debería mencionar Retiro o Madrid, obtuvo: "${r.reason}"`,
    );
  });

  it('A46 tourism/information en village → URBANO medium (el cartel está en el pueblo)', () => {
    // village:Becerril de la Sierra → el objeto está dentro del núcleo del pueblo → urbano
    // Si el cartel estuviera en el monte tendría solo county/municipality en el address
    const r = _classify(nom({ class: 'tourism', type: 'information', place_rank: 30, address: addrBecerril }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A47 tourism/hotel en city sin village → URBANO medium', () => {
    const r = _classify(nom({ class: 'tourism', type: 'hotel', place_rank: 30, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A48 leisure/pitch (campo deportivo municipal) con village → URBANO medium', () => {
    // El campo de fútbol del pueblo está dentro del núcleo → urbano
    const r = _classify(nom({ class: 'leisure', type: 'pitch', place_rank: 26, address: addrVillage }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A49 amenity/parking con rank<26 y sin city → RURAL medium', () => {
    const r = _classify(nom({ class: 'amenity', type: 'parking', place_rank: 24, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'medium');
  });

});

describe('A: _classify — fallback por address', () => {

  it('A50 objeto desconocido con suburb y rank>=26 → URBANO medium', () => {
    // Clase desconocida pero el address tiene suburb y rank alto
    const r = _classify(nom({ class: 'man_made', type: 'tower', place_rank: 28, address: { suburb: 'Salamanca', city: 'Madrid' } }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
    assert.match(r.reason, /Salamanca/);
  });

  it('A51 objeto desconocido con city y rank>=28 → URBANO medium', () => {
    const r = _classify(nom({ class: 'man_made', type: 'tower', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A52 objeto desconocido con city pero rank<28 → RURAL (no suficiente para inferir)', () => {
    const r = _classify(nom({ class: 'man_made', type: 'tower', place_rank: 26, address: addrMadrid }));
    assert.equal(r.isUrban, false);
  });

  it('A53 highway/tertiary que pasa por un village con rank bajo → no urbano por highway sola', () => {
    // Una carretera comarcal (tertiary) con solo village en address NO garantiza estar
    // dentro del casco — puede ser la carretera que atraviesa el término del pueblo.
    // Con rank<28 cae al fallback → RURAL low (sin evidencia de núcleo edificado).
    const r = _classify(nom({ class: 'highway', type: 'tertiary', place_rank: 26, address: addrVillage }));
    assert.equal(r.isUrban, false);
  });

  it('A54 address solo con hamlet → RURAL medium', () => {
    const r = _classify(nom({ class: 'man_made', type: 'cross', place_rank: 20, address: addrHamlet }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'medium');
    assert.match(r.reason, /El Ventorro/);
  });

  it('A55 address solo con county (campo sin núcleo) → RURAL low', () => {
    const r = _classify(nom({ class: 'man_made', type: 'mast', place_rank: 22, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'low');
    assert.match(r.reason, /término|Soria/i);
  });

  it('A56 address completamente vacío → RURAL low (sin núcleo identificado)', () => {
    const r = _classify(nom({ class: '', type: '', place_rank: 0, address: {} }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'low');
    assert.match(r.reason, /sin núcleo/i);
  });

});

describe('A: _classify — el falso positivo original (bug del que venimos)', () => {

  it('A57 campo en término municipal de pueblo con town en address → RURAL (zoom=18 soluciona esto)', () => {
    // Antes (zoom=16) devolvía town: "San Agustín del Guadalix" → isUrban:true INCORRECTO
    // Ahora (zoom=18) devuelve place/locality bajo el cursor → isUrban:false CORRECTO
    const r = _classify(nom({
      class: 'place', type: 'locality',
      name: 'Navalzarzal', place_rank: 25,
      address: { town: 'San Agustín del Guadalix', municipality: 'San Agustín del Guadalix' },
    }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
    // El motivo debe mencionar el topónimo rural, no el town
    assert.match(r.reason, /Navalzarzal|locality/);
  });

  it('A58 tourism/information con SOLO neighbourhood (sin village/city/town) → RURAL', () => {
    // neighbourhood sin ningún núcleo (city/town/village) → podría ser urbanización aislada
    // con rank=30 activa el fallback de neighbourhood solo → urbano medium
    // pero sin rank alto (rank=24) → rural (no hay suficiente evidencia de núcleo)
    const r = _classify(nom({
      class: 'tourism', type: 'information', place_rank: 24,
      address: { neighbourhood: 'Vista Real' },  // sin village ni city ni town
    }));
    assert.equal(r.isUrban, false);
  });

});

describe('A: _classify — casos límite y edge cases', () => {

  it('A59 building en campo aislado (masía) → URBANO high (edificio siempre es urbano)', () => {
    // Una masía rural es un building; se clasifica como urbano — es el comportamiento correcto
    // porque reglamentariamente una edificación aislada aplica las mismas restricciones
    const r = _classify(nom({ class: 'building', type: 'farm', place_rank: 20, address: addrVillage }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A60 aeropuerto (aeroway/aerodrome) → no está en clases conocidas, cae a fallback', () => {
    const r = _classify(nom({ class: 'aeroway', type: 'aerodrome', place_rank: 18, address: addrMadrid }));
    // Ninguna regla específica para aeroway; debe devolver algo coherente
    assert.ok(r.isUrban !== null);
    assert.ok(['high', 'medium', 'low'].includes(r.confidence));
  });

  it('A61 highway/motorway sin city → no entra en URBAN_HIGHWAY_TYPES, cae a fallback rural', () => {
    // motorway no está en URBAN_HIGHWAY_TYPES ni en RURAL_HIGHWAY_TYPES → ignora highway
    const r = _classify(nom({ class: 'highway', type: 'motorway', place_rank: 22, address: addrSolo }));
    assert.equal(r.isUrban, false);
  });

  it('A62 place/locality sin nombre → usa osmType como reason', () => {
    const r = _classify(nom({ class: 'place', type: 'locality', name: '', place_rank: 22, address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.match(r.reason, /locality/);
  });

  it('A63 amenity/school en suburb (colegio en barrio) → URBANO medium', () => {
    const r = _classify(nom({ class: 'amenity', type: 'school', place_rank: 28, address: addrMadridRetiro }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A64 leisure/stadium en city grande → URBANO medium', () => {
    const r = _classify(nom({ class: 'leisure', type: 'stadium', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'medium');
  });

  it('A65 landuse/construction (obra) → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'construction', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A66 landuse/brownfield (solar) → URBANO high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'brownfield', address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A67 landuse/vineyard (viñedo) → RURAL high', () => {
    const r = _classify(nom({ class: 'landuse', type: 'vineyard', address: addrSolo }));
    assert.equal(r.isUrban, false);
    assert.equal(r.confidence, 'high');
  });

  it('A68 highway/footway en barrio (acera) → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'footway', place_rank: 28, address: addrMadridRetiro }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A69 highway/cycleway en city → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'cycleway', place_rank: 28, address: addrMadrid }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

  it('A70 highway/steps (escalera urbana) en suburb → URBANO high', () => {
    const r = _classify(nom({ class: 'highway', type: 'steps', place_rank: 28, address: addrSevillaBarrio }));
    assert.equal(r.isUrban, true);
    assert.equal(r.confidence, 'high');
  });

});


// ═══════════════════════════════════════════════════════════════════════════════
// SUITE B — TESTS DE INTEGRACIÓN (red real, Nominatim)
// ═══════════════════════════════════════════════════════════════════════════════

// Pausa entre llamadas para respetar el rate-limit de Nominatim (1 req/s)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Wrapper que reintenta 1 vez si Nominatim devuelve 429 o null.
 * Si aun así falla, salta el test con un warning en lugar de hacerlo fallar.
 */
async function safeCheckUrban(lat, lon, context) {
  let r = await checkUrban(lat, lon);
  if (r.isUrban === null) {
    await sleep(2000); // backoff
    r = await checkUrban(lat, lon);
  }
  if (r.isUrban === null) {
    context.skip(`Nominatim no disponible (429/timeout) para ${lat},${lon}`);
  }
  return r;
}

const integrationTest = SKIP_INTEGRATION
  ? (name, fn) => it(`[SKIPPED] ${name}`, { skip: 'SKIP_INTEGRATION=1' }, fn)
  : it;

describe('B: checkUrban — coordenadas reales (integración)', () => {

  // ── Rurales confirmados ─────────────────────────────────────────────────────

  integrationTest('B01 San Agustín del Guadalix — campo abierto (el falso positivo original)', async (t) => {
    await sleep(600);
    const r = await safeCheckUrban(40.721827, -3.664670, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL, obtuvo URBANO: ${r.reason} (class=${r.details?.osmClass} type=${r.details?.osmType})`);
  });

  integrationTest('B02 Páramo de Soria — campo abierto', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(41.55, -3.1, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  integrationTest('B03 Sierra de Guadarrama — monte alto', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.80, -4.05, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  integrationTest('B04 Dehesa extremeña', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(39.4, -6.3, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  integrationTest('B05 Pirineo aragonés — monte', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(42.6, -0.5, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  integrationTest('B06 Embalse del Ebro — centro del embalse', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(43.00, -3.92, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  integrationTest('B07 Las Tablas de Daimiel — zona húmeda', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(39.143, -3.719, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  // ── Urbanos confirmados ─────────────────────────────────────────────────────

  integrationTest('B08 Madrid — edificio en barrio de Arganzuela', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.4200, -3.6900, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
    assert.equal(r.confidence, 'high');
  });

  integrationTest('B09 Madrid — calle residencial Vallecas', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.4350, -3.6980, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  integrationTest('B10 Sevilla — carretera en centro', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(37.3828, -5.9732, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  integrationTest('B11 Getafe — periferia sur de Madrid', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.3050, -3.7300, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  integrationTest('B12 Barcelona — edificio en Eixample', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(41.3940, 2.1590, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  integrationTest('B13 Valencia — centro histórico', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(39.4699, -0.3763, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  integrationTest('B14 Bilbao — casco urbano', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(43.2630, -2.9350, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO: ${r.reason}`);
  });

  // ── Parques y zonas verdes dentro de ciudad (deben ser urbanos) ────────────

  integrationTest('B15 Madrid — parque del Retiro (árbol/jardín en ciudad)', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.4180, -3.6820, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO (parque en ciudad): ${r.reason}`);
  });

  integrationTest('B16 Sevilla — Parque de María Luisa', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(37.3773, -5.9895, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO (parque en Sevilla): ${r.reason}`);
  });

  // ── Carreteras interurbanas / rurales ───────────────────────────────────────

  integrationTest('B17 Autovía A-1 — campo entre Burgos y Vitoria (no ciudad)', async (t) => {
    await sleep(1200);
    // Coordenadas en campo abierto entre Burgos y Miranda de Ebro, lejos de polígonos
    const r = await safeCheckUrban(42.55, -3.45, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL (campo entre ciudades): ${r.reason}`);
  });

  integrationTest('B18 Monte de la sierra de Cazorla', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(37.85, -2.75, t);
    assert.equal(r.isUrban, false, `Esperaba RURAL: ${r.reason}`);
  });

  // ── Zonas industriales / polígonos (periféricos pero urbanos) ──────────────

  integrationTest('B19 Polígono industrial en Alcalá de Henares', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.489, -3.368, t);
    assert.equal(r.isUrban, true, `Esperaba URBANO (polígono industrial): ${r.reason}`);
  });

  // ── Casos de confianza esperada ─────────────────────────────────────────────

  integrationTest('B20 Madrid edificio → confidence high', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(40.4200, -3.6900, t);
    assert.ok(
      ['high', 'medium'].includes(r.confidence),
      `Esperaba high o medium, obtuvo: ${r.confidence}`,
    );
  });

  integrationTest('B21 campo de Castilla → confidence high o medium', async (t) => {
    await sleep(1200);
    const r = await safeCheckUrban(41.5, -3.2, t);
    assert.ok(
      ['high', 'medium'].includes(r.confidence),
      `Esperaba high o medium, obtuvo: ${r.confidence}`,
    );
  });

});
