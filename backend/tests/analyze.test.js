/**
 * analyze.test.js — Tests unitarios del motor de análisis de vuelo de drones.
 *
 * Casos cubiertos (extraídos del historial de bugs reales):
 *   1.  Zona libre sin restricciones → FREE_FLIGHT 120m
 *   2.  Solo TMA → canFly:true + aviso ℹ️ TMA
 *   3.  TMA con altura explícita → aviso ℹ️ con metros
 *   4.  NPDRID entorno urbano → informativa, no bloquea
 *   5.  RTCA/RTCE NOTAMs futuros → ℹ️ NOTAM próximo, no bloquea
 *   6.  RTCA/RTCE NOTAM activo → ℹ️ NOTAM activo, no bloquea
 *   7.  NOTAM R/P/D activo → bloquea ⛔
 *   8.  NOTAM R/P/D solo futuro → aviso ⚠️, no bloquea
 *   9.  LEFE90: zona condicional con aeródromo <100m AMSL (17m) → calcula altura real
 *   10. LEFE90: cálculo con elevación terreno SRTM
 *   11. LEFE0: "no permitido excepto coordinación" → Requiere coordinación (canFly:false pero no forbidden)
 *   12. FORBIDDEN absoluto sin excepción → canFly:false "Prohibido"
 *   13. Zona condicional con terreno que supera la cota → canFly:false prohibido por terreno
 *   14. NOTAMs RTCA no bloquean aunque estén en restrictiveZones (test filterRestrictiveZones)
 *   15. TMA con RTCA + NPDRID → canFly:true con avisos ℹ️ (escenario Madrid)
 *   16. Zona con restricción fotográfica → canFly:false
 *   17. Zona condicional sin elevación disponible → usa limitAgl directamente
 *   18. Zona con "nivel inferior" en ft alto (>400ft) → allZonesAreHigh = free flight
 *   19. Zona con "nivel inferior" en ft bajo (≤400ft) → no es high, cae a coordinación
 *   20. analyzeFlightPermission: NOTAMs RTCA futuros siempre aparecen en reasons aunque restrictiveZones esté vacío
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { filterRestrictiveZones, analyzeFlightPermission, FREE_FLIGHT } from '../analyze.js';

// ─── Helpers para construir zonas de test ─────────────────────────────────────

const makeZone = (overrides = {}) => ({
  name:       overrides.name       ?? 'Zona Test',
  layer:      overrides.layer      ?? 'Zonas prohibidas',
  message:    overrides.message    ?? '',
  warning:    overrides.warning    ?? '',
  attributes: overrides.attributes ?? {},
  geometry:   [],
  ...overrides,
});

const makeTma = (name = 'TMA MADRID', heightMsg = '') => makeZone({
  name,
  layer:      'Zonas prohibidas',
  message:    heightMsg || `Se encuentra en una zona geográfica de UAS general por razón de la seguridad operacional del espacio aéreo controlado TMA (RMZ). Están permitidas las operaciones VLOS a una altura máxima de 60m fuera de las ZGUAS.`,
  attributes: { identifier: `${name.replace(' ', '_')}_TMA` },
});

const makeNotam = ({ name, qcode, from, to, text = '' }) => makeZone({
  name,
  layer:      'NOTAMs activos',
  message:    text,
  attributes: {
    qcode,
    itemBstr: from,
    itemCstr: to,
  },
});

// Fechas para test: pasado, presente y futuro
const NOW      = new Date('2026-03-04T12:00:00').getTime();
const PAST     = '01/01/2026 00:00:00';
const FUTURE1  = '10/03/2026 09:00:00';
const FUTURE2  = '15/03/2026 18:00:00';
const ACTIVE_FROM = '01/03/2026 00:00:00';
const ACTIVE_TO   = '31/03/2026 23:59:00';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('filterRestrictiveZones', () => {

  it('1. Zona libre sin restricciones pasa el filtro', () => {
    const zona = makeZone({ message: 'Zona de prueba sin restricciones' });
    const result = filterRestrictiveZones([zona]);
    assert.equal(result.length, 1);
  });

  it('2. NPDRID (entorno urbano) queda excluida', () => {
    const zona = makeZone({
      name:    'NPDRID',
      message: 'Antes de volar compruebe si la zona de vuelo se encuentra en entorno urbano. Definición de entorno urbano...',
    });
    assert.equal(filterRestrictiveZones([zona]).length, 0);
  });

  it('3. TMA por identificador queda excluida', () => {
    const zona = makeZone({ attributes: { identifier: 'LECM_TMA' } });
    assert.equal(filterRestrictiveZones([zona]).length, 0);
  });

  it('4. TMA por mensaje queda excluida', () => {
    const zona = makeZone({
      message: 'Se encuentra en el espacio aéreo controlado TMA MADRID. Operaciones VLOS hasta 60m.',
    });
    assert.equal(filterRestrictiveZones([zona]).length, 0);
  });

  it('5. NOTAM RTCA queda excluido', () => {
    const zona = makeNotam({ name: 'V09178/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    assert.equal(filterRestrictiveZones([zona]).length, 0);
  });

  it('6. NOTAM RTCE queda excluido', () => {
    const zona = makeNotam({ name: 'V00001/26', qcode: 'RTCE', from: FUTURE1, to: FUTURE2 });
    assert.equal(filterRestrictiveZones([zona]).length, 0);
  });

  it('7. NOTAM R (restricted) NO queda excluido', () => {
    const zona = makeNotam({ name: 'V99999/26', qcode: 'RRCA', from: ACTIVE_FROM, to: ACTIVE_TO });
    assert.equal(filterRestrictiveZones([zona]).length, 1);
  });

  it('8. Zona condicional LEFE90 no queda excluida (es restrictiva con altura)', () => {
    const zona = makeZone({
      name:    'HOSPITAL DE FORMENTERA',
      message: 'Por debajo de 90m medidos desde el punto de referencia del aeródromo (17m), no es necesario coordinar la operación. Por encima de 90m, NO permitido el vuelo a drones excepto coordinación con el Helipuerto.',
    });
    assert.equal(filterRestrictiveZones([zona]).length, 1);
  });

});

describe('analyzeFlightPermission', () => {

  // ── Casos de vuelo libre ──────────────────────────────────────────────────

  it('1. Sin zonas → FREE_FLIGHT 120m', () => {
    const result = analyzeFlightPermission([], [], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 120);
  });

  it('2. Solo TMA → canFly:true con aviso ℹ️', () => {
    const tma    = makeTma('TMA MADRID');
    const result = analyzeFlightPermission([], [tma], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 120);
    assert.ok(result.reasons.some(r => r.includes('ℹ️') && r.includes('TMA')));
  });

  it('3. TMA con "altura máxima de 60m" → aviso ℹ️ con 60m', () => {
    const tma = makeTma('TMA PALMA (RMZ)', 'Se encuentra en una zona geográfica de UAS general por razón de la seguridad operacional del espacio aéreo controlado TMA (RMZ). Están permitidas las operaciones VLOS a una altura máxima de 60m fuera de las ZGUAS generales por razón de la seguridad operacional en el entorno de los aeródromos.');
    const result = analyzeFlightPermission([], [tma], null);
    assert.equal(result.canFly, true);
    assert.ok(result.reasons.some(r => r.includes('60m')));
  });

  it('4. NPDRID no bloquea el vuelo', () => {
    const npdrid = makeZone({
      name:    'NPDRID',
      message: 'Antes de volar compruebe si la zona de vuelo se encuentra en entorno urbano. Definición de entorno urbano...',
    });
    const restrictive = filterRestrictiveZones([npdrid]);
    const result = analyzeFlightPermission(restrictive, [npdrid], null);
    assert.equal(result.canFly, true);
  });

  // ── NOTAMs RTCA ───────────────────────────────────────────────────────────

  it('5. RTCA futuro → canFly:true + ℹ️ NOTAM próximo en reasons', () => {
    const notam = makeNotam({ name: 'V09178/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2, text: 'TEMPORARY SEGREGATED AREA FOR UNMANNED ACFT' });
    const restrictive = filterRestrictiveZones([notam]);
    const result = analyzeFlightPermission(restrictive, [notam], null);
    assert.equal(result.canFly, true);
    assert.ok(result.reasons.some(r => r.includes('ℹ️') && r.includes('NOTAM próximo')));
  });

  it('6. RTCA activo → canFly:true + ℹ️ NOTAM activo', () => {
    const notam = makeNotam({ name: 'V00001/26', qcode: 'RTCA', from: ACTIVE_FROM, to: ACTIVE_TO });
    const restrictive = filterRestrictiveZones([notam]);
    const result = analyzeFlightPermission(restrictive, [notam], null);
    assert.equal(result.canFly, true);
    assert.ok(result.reasons.some(r => r.includes('ℹ️') && r.includes('NOTAM activo')));
  });

  it('20. RTCA futuros aparecen en reasons aunque restrictiveZones esté vacío (caso Madrid)', () => {
    const tma   = makeTma('TMA MADRID');
    const rtca1 = makeNotam({ name: 'V09178/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    const rtca2 = makeNotam({ name: 'V08217/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    const all   = [tma, rtca1, rtca2];
    const restrictive = filterRestrictiveZones(all);

    assert.equal(restrictive.length, 0, 'No debe haber zonas restrictivas');

    const result = analyzeFlightPermission(restrictive, all, null);
    assert.equal(result.canFly, true);
    const rtcaReasons = result.reasons.filter(r => r.includes('NOTAM'));
    assert.ok(rtcaReasons.length >= 2, 'Deben aparecer al menos 2 avisos NOTAM');
  });

  // ── NOTAMs R/P/D ──────────────────────────────────────────────────────────

  it('7. NOTAM R activo → canFly:false con 🚫 NOTAM en vigor', () => {
    const notam = makeNotam({
      name: 'V12345/26', qcode: 'RRCA',
      from: ACTIVE_FROM, to: ACTIVE_TO,
      text: 'RESTRICTED AREA ACTIVATED',
    });
    const restrictive = filterRestrictiveZones([notam]);
    const result = analyzeFlightPermission(restrictive, [notam], null);
    assert.equal(result.canFly, false);
    assert.ok(result.reasons.some(r => r.includes('🚫') || r.includes('NOTAM en vigor')));
  });

  it('8. NOTAM R solo futuro → canFly:true + ⚠️ NOTAM próximo', () => {
    const notam = makeNotam({
      name: 'V12345/26', qcode: 'RRCA',
      from: FUTURE1, to: FUTURE2,
      text: 'RESTRICTED AREA',
    });
    const restrictive = filterRestrictiveZones([notam]);
    const result = analyzeFlightPermission(restrictive, [notam], null);
    assert.equal(result.canFly, true);
    assert.ok(result.reasons.some(r => r.includes('⚠️') && r.includes('NOTAM próximo')));
  });

  // ── Alturas condicionales ────────────────────────────────────────────────

  it('9. LEFE90: regex captura aeródromo de 17m AMSL (2 dígitos)', () => {
    const zona = makeZone({
      name:    'HOSPITAL DE FORMENTERA',
      message: 'Se encuentra en la Zona geográfica de UAS General por razón de la seguridad operacional de HOSPITAL DE FORMENTERA , LEFE. Por debajo de 90m medidos desde el punto de referencia del aeródromo (17m), no es necesario coordinar la operación. Por encima de 90m, medidos desde el punto de referencia del aeródromo (17m), NO permitido el vuelo a drones excepto coordinación con el Helipuerto.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    assert.equal(restrictive.length, 1);

    // Sin elevación: devuelve limitAgl directamente
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 90);
    assert.ok(result.reasons.some(r => r.includes('90m')));
  });

  it('10. LEFE90: con terreno a 33m AMSL → máximo 74m (107-33)', () => {
    const zona = makeZone({
      name:    'HOSPITAL DE FORMENTERA',
      message: 'Por debajo de 90m medidos desde el punto de referencia del aeródromo (17m), no es necesario coordinar la operación. Por encima de 90m, medidos desde el punto de referencia del aeródromo (17m), NO permitido el vuelo a drones excepto coordinación con el Helipuerto.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], 33);  // terreno 33m AMSL
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 74);  // 17+90=107, 107-33=74
    assert.ok(result.reasons.some(r => r.includes('74m')));
  });

  it('17. Zona condicional sin elevación disponible → usa limitAgl', () => {
    const zona = makeZone({
      name:    'AERÓDROMO TEST',
      message: 'Por debajo de 50m medidos desde el punto de referencia del aeródromo (442m), no es necesario coordinar la operación.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 50);
  });

  it('13. Terreno supera la cota → canFly:false', () => {
    // aeródromo 10m + límite 30m = cota 40m. Terreno 50m → supera
    const zona = makeZone({
      name:    'AERÓDROMO MONTAÑA',
      message: 'Por debajo de 30m medidos desde el punto de referencia del aeródromo (10m), no es necesario coordinar la operación.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], 50);  // terreno 50m > 40m cota
    assert.equal(result.canFly, false);
    assert.ok(result.reasons.some(r => r.includes('terreno') || r.includes('supera')));
  });

  // ── Coordinación requerida vs Prohibición absoluta ───────────────────────

  it('11. LEFE0: "no permitido excepto coordinación" → canFly:false + Requiere coordinación', () => {
    const zona = makeZone({
      name:    'HOSPITAL DE FORMENTERA',
      message: 'Se encuentra en la Zona geográfica de UAS General por razón de seguridad operacional de HOSPITAL DE FORMENTERA , LEFE. NO permitido el vuelo a drones excepto coordinación con el Helipuerto. Contacto: Email: coordinaciones.uas@urjato.com',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, false);
    // No debe decir "Prohibido", debe decir "Requiere coordinación"
    assert.ok(!result.reasons.some(r => /^Prohibido:/.test(r)), 'No debe aparecer "Prohibido:"');
    assert.ok(result.reasons.some(r => r.includes('coordinación') || r.includes('Requiere')));
  });

  it('12. Prohibición absoluta sin excepción → canFly:false "Prohibido"', () => {
    const zona = makeZone({
      name:    'ZONA MILITAR',
      message: 'Prohibido el vuelo de drones en esta área.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, false);
    assert.ok(result.reasons.some(r => r.includes('Prohibido')));
  });

  // ── Restricción fotográfica ──────────────────────────────────────────────

  it('16. Zona con restricción fotográfica → canFly:false', () => {
    const zona = makeZone({
      name:    'ZONA FOTOGRÁFICA',
      message: 'El vuelo está restringida al vuelo fotográfico en esta área sensible.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, false);
    assert.ok(result.reasons.some(r => r.includes('fotográfica') || r.includes('Bloqueo')));
  });

  // ── Alturas por "nivel inferior" en pies ────────────────────────────────

  it('18. Zona con "Nivel inferior: 1500ft" → sin restricción efectiva (allZonesAreHigh)', () => {
    const zona = makeZone({
      name:    'ZONA ALTA',
      message: 'Zona de espacio aéreo. Nivel inferior: 1500ft sobre el terreno.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 120);
  });

  it('19. Zona con "Nivel inferior: 300ft" → restricción baja, cae a coordinación', () => {
    const zona = makeZone({
      name:    'ZONA BAJA',
      message: 'Zona de espacio aéreo. Nivel inferior: 300ft sobre el terreno.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    // No hay altura explícita → Requiere coordinación
    assert.equal(result.canFly, false);
  });

  // ── Escenario completo Madrid (caso histórico) ───────────────────────────

  it('15. Escenario Madrid: TMA + NPDRID + 4x RTCA → canFly:true con avisos', () => {
    const tma    = makeTma('TMA MADRID');
    const npdrid = makeZone({
      name:    'NPDRID',
      message: 'Antes de volar compruebe si la zona de vuelo se encuentra en entorno urbano. Definición...',
      attributes: { identifier: 'NPDRID' },
    });
    const rtca1 = makeNotam({ name: 'V09178/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    const rtca2 = makeNotam({ name: 'V07661/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    const rtca3 = makeNotam({ name: 'V08724/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });
    const rtca4 = makeNotam({ name: 'V08217/26', qcode: 'RTCA', from: FUTURE1, to: FUTURE2 });

    const allZones   = [tma, npdrid, rtca1, rtca2, rtca3, rtca4];
    const restrictive = filterRestrictiveZones(allZones);

    assert.equal(restrictive.length, 0, 'Todas las zonas deben ser informativas');

    const result = analyzeFlightPermission(restrictive, allZones, 813);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 120);
    assert.ok(result.reasons.some(r => r.includes('TMA')));
    assert.ok(result.reasons.filter(r => r.includes('NOTAM')).length >= 4, 'Deben aparecer los 4 NOTAMs');
  });

  // ── Altura por regex simple ──────────────────────────────────────────────

  it('14. Zona con "altura máxima de 50m" → canFly:true máx 50m', () => {
    const zona = makeZone({
      name:    'ZONA LIMITADA',
      message: 'Se permite el vuelo hasta una altura máxima de 50m en esta zona.',
    });
    const restrictive = filterRestrictiveZones([zona]);
    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 50);
  });

  // ── LEDO: coordinación requerida no cede ante otras zonas con altura ─────

  it('21. LEDO + zona con altura → sigue bloqueando por coordinación (escenario real Madrid)', () => {
    const ledo = makeZone({
      name:    'HOSPITAL DOCE DE OCTUBRE',
      layer:   'Zonas prohibidas',
      message: `Se encuentra en la Zona geográfica de UAS General por razón de seguridad operacional de <elem>HOSPITAL DOCE DE OCTUBRE </elem>, LEDO.<p><font color="#dc143c">NO permitido el vuelo a drones excepto coordinación con el Helipuerto.</font></p><p> <b>Contacto:</b> Email: <font color="#009fda">coordinaciones.uas@urjato.com</font>  </p>`,
      attributes: { identifier: 'LEDO0' },
    });
    const getafe = makeZone({
      name:    'MADRID/Getafe',
      message: 'Aeródromo. Se permite vuelo por debajo de 76m (646m) no es necesario coordinar salvo activación previa.',
      attributes: { identifier: 'LEMD90' },
    });
    const ctr = makeZone({
      name:    'CTR MADRID',
      message: 'Zona de control. Vuelo permitido hasta 60m.',
      attributes: { identifier: 'CTR_MADRID' },
    });

    const allZones    = [ledo, getafe, ctr];
    const restrictive = filterRestrictiveZones(allZones);

    const result = analyzeFlightPermission(restrictive, allZones, null);
    assert.equal(result.canFly, false, 'LEDO debe bloquear aunque haya zonas con altura');
    assert.ok(result.reasons.some(r => r.includes('Requiere coordinación') && r.includes('HOSPITAL DOCE DE OCTUBRE')));
    assert.ok(!result.reasons.some(r => r.startsWith('Prohibido:')), 'No debe aparecer "Prohibido:"');
  });

  // ── Zonas NO AIP ─────────────────────────────────────────────────────────

  it('22. Zona con "Datos NO AIP" → canFly:true + aviso ⚠️ NO AIP (no bloquea)', () => {
    const zona = makeZone({
      name:    null,
      message: 'Se encuentra en la Zona geográfica de UAS General por razón de seguridad operacional de Hospital de Segovia <br><b>Datos NO AIP.</b> Fuente de la información: AESA. NO permitido el vuelo a drones excepto coordinación con el Helipuerto.',
      attributes: { identifier: ' 0' },
    });
    const restrictive = filterRestrictiveZones([zona]);
    assert.equal(restrictive.length, 0, 'Zona NO AIP debe quedar fuera de restrictiveZones');

    const result = analyzeFlightPermission(restrictive, [zona], null);
    assert.equal(result.canFly, true);
    assert.ok(result.reasons.some(r => r.includes('⚠️') && r.includes('NO AIP')));
    assert.ok(result.reasons.some(r => r.includes('**Datos NO AIP.**')), 'Debe preservar <b> como **...**');
  });

  it('23. Zona NO AIP junto a zona restrictiva normal → sigue permitiendo con aviso', () => {
    const noAip = makeZone({
      name:    null,
      message: 'Hospital de Segovia <b>Datos NO AIP.</b> NO permitido el vuelo excepto coordinación.',
      attributes: { identifier: 'SEG0' },
    });
    const ctr = makeZone({
      name:    'CTR SEGOVIA',
      message: 'Zona de control. Vuelo permitido hasta 60m.',
      attributes: { identifier: 'CTR_SEG' },
    });
    const allZones    = [noAip, ctr];
    const restrictive = filterRestrictiveZones(allZones);

    // Solo CTR debe entrar en restrictivas
    assert.equal(restrictive.length, 1);
    assert.equal(restrictive[0].name, 'CTR SEGOVIA');

    const result = analyzeFlightPermission(restrictive, allZones, null);
    assert.equal(result.canFly, true);
    assert.equal(result.maxAllowedHeight, 60);
    assert.ok(result.reasons.some(r => r.includes('NO AIP')));
  });

});
