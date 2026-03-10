/**
 * sw.js — Service Worker para PWA Drones España
 *
 * Estrategia:
 *  - Shell de la app (HTML/JS/CSS/iconos) → Cache First
 *  - Llamadas a la API (/api/*) → Network Only (siempre datos frescos)
 */

const CACHE_NAME   = 'drones-esp-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Instalación: precachear el shell ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

// ── Activación: borrar cachés viejas ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

// ── Fetch: Cache First para shell, Network Only para API ──────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls → siempre red (datos en tiempo real)
  if (url.pathname.startsWith('/api/')) return;

  // Solo GET
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Cachear solo respuestas válidas de mismo origen
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});
