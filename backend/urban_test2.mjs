import { checkUrban } from './urban.js';

const tests = [
  { name: 'Arija pueblo (highway/secondary dentro del pueblo)', lat: 42.98,     lon: -3.95 },
  { name: 'Burgos ciudad (shop en barrio)',                      lat: 42.35,     lon: -3.67 },
  { name: 'Cartel monte Guadarrama (tourism/information)',       lat: 40.75,     lon: -3.98 },
  { name: 'San Agustín campo — el bug original',                lat: 40.721827, lon: -3.664670 },
  { name: 'Madrid edificio (building/apartments)',              lat: 40.42,     lon: -3.69 },
  { name: 'Navas del Rey — casco del pueblo',                   lat: 40.375,    lon: -4.285 },
  { name: 'Sevilla centro',                                     lat: 37.3828,   lon: -5.9732 },
  { name: 'Campo de Castilla (campo abierto)',                  lat: 41.5,      lon: -3.2 },
];

for (const t of tests) {
  await new Promise(r => setTimeout(r, 1500));
  const r = await checkUrban(t.lat, t.lon);
  const icon = r.isUrban === true ? '🏙  URBANO' : r.isUrban === false ? '🌿 RURAL ' : '❓';
  const addr = r.details?.address || {};
  console.log(icon + ' [' + r.confidence + '] ' + t.name);
  console.log('       reason: ' + r.reason);
  console.log('       class=' + r.details?.osmClass + ' type=' + r.details?.osmType + ' rank=' + r.details?.placeRank);
  console.log('       village=' + (addr.village||'-') + ' suburb=' + (addr.suburb||'-') + ' neighbourhood=' + (addr.neighbourhood||'-') + ' city=' + (addr.city||'-') + ' town=' + (addr.town||'-'));
  console.log();
}
