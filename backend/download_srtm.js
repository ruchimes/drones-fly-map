/**
 * download_srtm.js — Descarga todos los tiles SRTM1 (~30m) que cubren España.
 *
 * Cobertura:
 *   España peninsular + Baleares : lat 35–44, lon -10–+5
 *   Islas Canarias               : lat 27–30, lon -19–-13
 *
 * Uso: node download_srtm.js
 *
 * Los tiles se guardan en ./srtm_cache/*.hgt (descomprimidos, ~25MB c/u).
 * Los ya descargados se saltan automáticamente.
 */

import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR  = path.join(__dirname, 'srtm_cache');
const MIRROR_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi';
const gunzip     = promisify(zlib.gunzip);

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── Definición de cobertura ──────────────────────────────────────────────────

const REGIONS = [
  { name: 'Península + Baleares', latMin: 35, latMax: 44, lonMin: -10, lonMax:  5 },
  { name: 'Canarias',             latMin: 27, latMax: 30, lonMin: -19, lonMax: -13 },
];

// Genera lista de tiles únicos para todas las regiones
function buildTileList() {
  const tiles = new Map(); // key → { tileLat, tileLon }
  for (const region of REGIONS) {
    for (let lat = region.latMin; lat <= region.latMax; lat++) {
      for (let lon = region.lonMin; lon <= region.lonMax; lon++) {
        const ns     = lat >= 0 ? 'N' : 'S';
        const ew     = lon >= 0 ? 'E' : 'W';
        const latStr = String(Math.abs(lat)).padStart(2, '0');
        const lonStr = String(Math.abs(lon)).padStart(3, '0');
        const key    = `${ns}${latStr}${ew}${lonStr}`;
        if (!tiles.has(key)) tiles.set(key, { key, tileLat: lat, tileLon: lon });
      }
    }
  }
  return [...tiles.values()];
}

// ─── Descarga de un tile ──────────────────────────────────────────────────────

async function downloadTile({ key, tileLat, tileLon }) {
  const hgtFile = path.join(CACHE_DIR, `${key}.hgt`);

  if (fs.existsSync(hgtFile)) {
    const size = (fs.statSync(hgtFile).size / 1024 / 1024).toFixed(1);
    console.log(`  ✓ ${key} ya existe (${size} MB) — saltado`);
    return 'skip';
  }

  const ns     = tileLat >= 0 ? 'N' : 'S';
  const latStr = String(Math.abs(tileLat)).padStart(2, '0');
  const dir    = `${ns}${latStr}`;
  const url    = `${MIRROR_URL}/${dir}/${key}.hgt.gz`;

  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    const gz  = Buffer.from(resp.data);
    const buf = await gunzip(gz);
    fs.writeFileSync(hgtFile, buf);
    const size = (buf.length / 1024 / 1024).toFixed(1);
    console.log(`  ↓ ${key} descargado y guardado (${size} MB)`);
    return 'ok';
  } catch (err) {
    if (err.response?.status === 404) {
      // Tile no existe en el dataset (mar, zona sin datos) — crear marcador vacío
      fs.writeFileSync(hgtFile + '.nodata', '');
      console.log(`  ~ ${key} sin datos (404) — marcado`);
      return 'nodata';
    }
    console.error(`  ✗ ${key} ERROR: ${err.message}`);
    return 'error';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const tiles = buildTileList();
console.log(`\n🗺️  Descarga de tiles SRTM1 para España`);
console.log(`   Total tiles: ${tiles.length} (${REGIONS.map(r => r.name).join(' + ')})`);
console.log(`   Destino: ${CACHE_DIR}\n`);

const stats = { ok: 0, skip: 0, nodata: 0, error: 0 };
const errors = [];

for (let i = 0; i < tiles.length; i++) {
  const tile = tiles[i];
  process.stdout.write(`[${String(i + 1).padStart(3)}/${tiles.length}] `);
  const result = await downloadTile(tile);
  stats[result]++;
  if (result === 'error') errors.push(tile.key);

  // Pequeña pausa entre descargas para no sobrecargar el servidor
  if (result === 'ok') await new Promise(r => setTimeout(r, 200));
}

console.log('\n─────────────────────────────────────────');
console.log(`✅ Completado:`);
console.log(`   Descargados : ${stats.ok}`);
console.log(`   Ya existían : ${stats.skip}`);
console.log(`   Sin datos   : ${stats.nodata} (mar/vacío)`);
console.log(`   Errores     : ${stats.error}`);
if (errors.length) console.log(`   Tiles con error: ${errors.join(', ')}`);

const totalMb = fs.readdirSync(CACHE_DIR)
  .filter(f => f.endsWith('.hgt'))
  .reduce((sum, f) => sum + fs.statSync(path.join(CACHE_DIR, f)).size, 0) / 1024 / 1024;
console.log(`   Espacio usado: ${totalMb.toFixed(0)} MB`);
