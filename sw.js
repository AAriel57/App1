// Service worker: la app y sus datos funcionan sin conexión, y las teselas del mapa que ya se han visto
// quedan guardadas (con límite) para consultarlas en la montaña sin cobertura.
// Al cambiar cualquier archivo de la lista, subir VERSION para que los móviles descarguen la nueva.
const VERSION = 'v1';
const APP = `app-${VERSION}`;
const TESELAS = 'teselas';
const FUENTES = 'fuentes';
const MAX_TESELAS = 1500; // ~25-40 MB: zonas vistas, no descarga masiva (lo prohíben los servidores de teselas)

const ARCHIVOS_APP = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'vendor/maplibre-gl-6.11.2/maplibre-gl.css',
  'vendor/maplibre-gl-6.11.2/maplibre-gl.mjs',
  'vendor/maplibre-gl-6.11.2/maplibre-gl-shared.mjs',
  'vendor/maplibre-gl-6.11.2/maplibre-gl-worker.mjs',
  'data/refugios.geojson',
  'data/rutas.geojson',
  'data/ejemplo-prueba.gpx',
];

const HOSTS_TESELAS = /(^|\.)tile\.opentopomap\.org$|(^|\.)tile-cyclosm\.openstreetmap\.fr$|^tile\.waymarkedtrails\.org$/;
const HOSTS_FUENTES = /^fonts\.(googleapis|gstatic)\.com$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(ARCHIVOS_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith('app-') && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(redPrimero(req));
  } else if (HOSTS_TESELAS.test(url.hostname)) {
    e.respondWith(cachePrimero(req, TESELAS, MAX_TESELAS));
  } else if (HOSTS_FUENTES.test(url.hostname)) {
    e.respondWith(cachePrimero(req, FUENTES, 50));
  }
});

// Archivos propios: siempre la versión más nueva si hay red; si no, la guardada
async function redPrimero(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    // Sin parámetros (?v=…) para no acumular copias del mismo archivo
    if (res.ok && !new URL(req.url).search) cache.put(req, res.clone());
    return res;
  } catch {
    const guardada = await cache.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    if (req.mode === 'navigate') return cache.match('index.html');
    throw new Error('Sin conexión y sin copia guardada');
  }
}

// Teselas y fuentes: no cambian, así que primero la copia y solo si falta se pide a la red
async function cachePrimero(req, nombre, max) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone());
    recortar(cache, max);
  }
  return res;
}

// Borra las más antiguas cuando se pasa del límite (las claves salen en orden de inserción)
async function recortar(cache, max) {
  const claves = await cache.keys();
  for (let i = 0; i < claves.length - max; i++) await cache.delete(claves[i]);
}
