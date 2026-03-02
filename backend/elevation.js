/**
 * elevation.js — Consulta de elevación SRTM1 (~30m) local con caché en disco.
 *
 * Fuente: Tiles HGT del mirror público S3 de Mapzen/Nextzen
 *   https://elevation-tiles-prod.s3.amazonaws.com/skadi/{NS}{lat}/{NS}{lat}{EW}{lon}.hgt.gz
 *
 * Formato HGT (SRTM1):
 *   - Cuadrícula 3601×3601 de int16 big-endian
 *   - Cubre exactamente 1°×1° con la esquina SW en (lat, lon)
 *   - Resolución ~30m (1 arcsecond)
 *   - -32768 = sin datos (agua o vacío)
 *
 * Uso:
 *   import { getElevationLocal, warmupTiles } from './elevation.js';
 *   const elev = await getElevationLocal(40.42, -3.70);  // metros AMSL o null
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

const gunzip = promisify(zlib.gunzip);

// Caché en memoria: tileKey → Buffer (datos descomprimidos)
const memCache = new Map();

// ─── Helpers de nombre de tile ────────────────────────────────────────────────

/** Devuelve las coordenadas del tile que contiene (lat, lon): esquina SW entera */
function tileCoords(lat, lon) {
  return {
    tileLat: Math.floor(lat),
    tileLon: Math.floor(lon),
  };
}

/** Construye la clave y la URL del tile */
function tileInfo(tileLat, tileLon) {
  const ns     = tileLat >= 0 ? 'N' : 'S';
  const ew     = tileLon >= 0 ? 'E' : 'W';
  const latStr = String(Math.abs(tileLat)).padStart(2, '0');
  const lonStr = String(Math.abs(tileLon)).padStart(3, '0');
  const name   = `${ns}${latStr}${ew}${lonStr}`;
  const dir    = `${ns}${latStr}`;
  return {
    key:      name,
    filename: `${name}.hgt`,
    gzFile:   path.join(CACHE_DIR, `${name}.hgt.gz`),
    hgtFile:  path.join(CACHE_DIR, `${name}.hgt`),
    url:      `${MIRROR_URL}/${dir}/${name}.hgt.gz`,
  };
}

// ─── Descarga y caché en disco ────────────────────────────────────────────────

/** Descarga el tile si no está en disco. Devuelve la ruta al .hgt descomprimido. */
async function ensureTile(tileLat, tileLon) {
  const info = tileInfo(tileLat, tileLon);

  // 1. Ya en memoria
  if (memCache.has(info.key)) return memCache.get(info.key);

  // 2. Ya en disco (.hgt)
  if (fs.existsSync(info.hgtFile)) {
    const buf = fs.readFileSync(info.hgtFile);
    memCache.set(info.key, buf);
    return buf;
  }

  // 3. Ya en disco (.hgt.gz) pero sin descomprimir
  if (fs.existsSync(info.gzFile)) {
    console.log(`[SRTM] Descomprimiendo ${info.key}…`);
    const gz  = fs.readFileSync(info.gzFile);
    const buf = await gunzip(gz);
    fs.writeFileSync(info.hgtFile, buf);
    memCache.set(info.key, buf);
    return buf;
  }

  // 4. Descargar
  console.log(`[SRTM] Descargando tile ${info.key} desde ${info.url}`);
  try {
    const resp = await axios.get(info.url, {
      responseType: 'arraybuffer',
      timeout:      30000,
    });
    const gz  = Buffer.from(resp.data);
    const buf = await gunzip(gz);
    // Guardar en disco para próximas ejecuciones
    fs.writeFileSync(info.hgtFile, buf);
    memCache.set(info.key, buf);
    console.log(`[SRTM] Tile ${info.key} guardado (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    return buf;
  } catch (err) {
    console.warn(`[SRTM] No se pudo descargar ${info.key}: ${err.message}`);
    return null;
  }
}

// ─── Lectura de elevación ─────────────────────────────────────────────────────

/**
 * Lee la elevación en metros AMSL para (lat, lon) desde el tile HGT local.
 * Devuelve null si el tile no está disponible o el punto es "no data" (-32768).
 */
async function getElevationLocal(lat, lon) {
  const { tileLat, tileLon } = tileCoords(lat, lon);
  const buf = await ensureTile(tileLat, tileLon);
  if (!buf) return null;

  // SRTM1: 3601 filas × 3601 columnas, int16 big-endian
  // Fila 0 = latitud máxima (tileLat+1), última fila = tileLat
  // Columna 0 = lonLat (tileLon), última columna = tileLon+1
  const SIZE = 3601;
  const fracLat = lat - tileLat;  // 0.0 – 1.0 dentro del tile
  const fracLon = lon - tileLon;

  // Interpolación bilineal entre los 4 vecinos más cercanos
  const col = fracLon * (SIZE - 1);
  const row = (1 - fracLat) * (SIZE - 1);  // filas invertidas (Norte arriba)

  const col0 = Math.floor(col);
  const row0 = Math.floor(row);
  const col1 = Math.min(col0 + 1, SIZE - 1);
  const row1 = Math.min(row0 + 1, SIZE - 1);

  const dc = col - col0;
  const dr = row - row0;

  const read = (r, c) => {
    const idx = (r * SIZE + c) * 2;
    const v   = buf.readInt16BE(idx);
    return v === -32768 ? null : v;  // -32768 = sin datos
  };

  const v00 = read(row0, col0);
  const v01 = read(row0, col1);
  const v10 = read(row1, col0);
  const v11 = read(row1, col1);

  // Si algún vecino es "sin datos", intentar con los disponibles
  const vals = [v00, v01, v10, v11].filter(v => v !== null);
  if (!vals.length) return null;
  if (vals.length < 4) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  // Interpolación bilineal completa
  const elev = v00 * (1 - dc) * (1 - dr)
             + v01 *      dc  * (1 - dr)
             + v10 * (1 - dc) *      dr
             + v11 *      dc  *      dr;

  return Math.round(elev);
}

/**
 * Precarga en memoria los tiles necesarios para una lista de coordenadas.
 * Llámalo al inicio del heatmap para evitar descargas durante el análisis.
 * Devuelve el número de tiles únicos cargados.
 */
async function warmupTiles(coords) {
  const needed = new Set(
    coords.map(({ lat, lon }) => {
      const { tileLat, tileLon } = tileCoords(lat, lon);
      return `${tileLat},${tileLon}`;
    }),
  );

  console.log(`[SRTM] Precargando ${needed.size} tiles para ${coords.length} puntos…`);

  await Promise.all(
    [...needed].map(key => {
      const [tileLat, tileLon] = key.split(',').map(Number);
      return ensureTile(tileLat, tileLon);
    }),
  );

  const loaded = [...needed].filter(key => {
    const [tileLat, tileLon] = key.split(',').map(Number);
    return memCache.has(tileInfo(tileLat, tileLon).key);
  }).length;

  console.log(`[SRTM] ${loaded}/${needed.size} tiles listos en memoria`);
  return loaded;
}

/**
 * Consulta batch de elevaciones para un array de {lat, lon}.
 * Primero precarga todos los tiles necesarios, luego lee cada punto.
 * Drop-in replacement de getElevationBatch() de opentopodata.
 */
async function getElevationBatchLocal(coords) {
  if (!coords.length) return [];
  await warmupTiles(coords);
  return Promise.all(coords.map(({ lat, lon }) => getElevationLocal(lat, lon)));
}

export { getElevationLocal, getElevationBatchLocal, warmupTiles };
