/**
 * history.js — Persistencia de análisis de cuadrícula en MongoDB Atlas.
 *
 * Requiere la variable de entorno MONGODB_URI para conectar.
 *
 * Colección: analyses
 * Documento: { id, timestamp, center: { lat, lon }, radius, cellM, cells: [...] }
 */

import { MongoClient } from 'mongodb';

const MAX_ENTRIES = 200;
const DB_NAME     = 'drones';
const COLLECTION  = 'analyses';

// ─── Cliente MongoDB (singleton) ─────────────────────────────────────────────

let _client = null;
let _col    = null;

async function getCollection() {
  if (_col) return _col;

  const MONGO_URI = process.env.MONGODB_URI;
  if (!MONGO_URI) {
    throw new Error('[HISTORY] MONGODB_URI no está definida. Configura la variable de entorno.');
  }

  _client = new MongoClient(MONGO_URI, {
    tls: true,
    tlsAllowInvalidCertificates: false,
    serverSelectionTimeoutMS: 10000,
    family: 4, // forzar IPv4 — evita rechazo TLS por IPv6 en Atlas M0
  });
  await _client.connect();
  _col = _client.db(DB_NAME).collection(COLLECTION);
  console.log('[HISTORY] Conectado a MongoDB Atlas');
  return _col;
}

/**
 * Conecta a MongoDB al arrancar el servidor (eager connect).
 */
export async function connectDB() {
  await getCollection();
}

// ─── mergeAllCells ────────────────────────────────────────────────────────────

/**
 * Combina las celdas de todos los análisis en un único array flat.
 * Como la grid es global y fija, basta redondear a 6 decimales para deduplicar.
 * Se conserva la celda más reciente.
 */
export function mergeAllCells(history) {
  const map = new Map();
  for (const entry of history) {
    for (const cell of entry.cells ?? []) {
      const key = `${cell.lat.toFixed(6)},${cell.lon.toFixed(6)}`;
      map.set(key, cell);
    }
  }
  return Array.from(map.values());
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Devuelve todo el historial (array de entradas, de más antiguo a más reciente).
 */
export async function getHistory() {
  const col = await getCollection();
  return col.find({}, { projection: { _id: 0 } })
    .sort({ id: 1 })
    .toArray();
}

/**
 * Añade un análisis al historial.
 * @param {{ center, radius, cellM, cells }} analysis
 * @returns {{ id, timestamp }}
 */
export async function addAnalysis(analysis) {
  const entry = {
    id:        Date.now(),
    timestamp: new Date().toISOString(),
    center:    analysis.center,
    radius:    analysis.radius,
    cellM:     analysis.cellM,
    cells:     analysis.cells,
  };

  const col = await getCollection();
  await col.insertOne({ ...entry });

  // Mantener límite MAX_ENTRIES: borrar los más antiguos si se supera
  const total = await col.countDocuments();
  if (total > MAX_ENTRIES) {
    const oldest = await col.find({}, { projection: { id: 1 } })
      .sort({ id: 1 })
      .limit(total - MAX_ENTRIES)
      .toArray();
    await col.deleteMany({ id: { $in: oldest.map(d => d.id) } });
  }

  console.log(`[HISTORY] Guardado análisis #${entry.id} (${entry.cells?.length ?? 0} celdas) en MongoDB`);
  return { id: entry.id, timestamp: entry.timestamp };
}

/**
 * Elimina todo el historial.
 */
export async function clearHistory() {
  const col = await getCollection();
  await col.deleteMany({});
  console.log('[HISTORY] Historial borrado en MongoDB');
}
