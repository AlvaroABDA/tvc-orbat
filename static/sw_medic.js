const CACHE_NAME = 'tvc-medic-v6';
const ASSETS_TO_CACHE = [
  '/medic',
  '/static/manifest_medic.json',
  '/static/js/field_medic/episode_storage.js',
  '/static/js/field_medic/hemorrhage_game.js',
  '/static/js/field_medic/pneumothorax_game.js',
  '/static/js/field_medic/tourniquet_game.js',
  '/static/js/field_medic/suture_game.js',
  '/static/js/field_medic/stabilization_game.js',
  '/static/js/field_medic/vitals_hold_game.js',
  '/static/js/field_medic/dual_vitals_game.js',
  '/static/js/field_medic/memory_sequence_game.js',
  '/static/js/field_medic/line_correction_game.js',
  '/static/js/field_medic/qr_scanner.js',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Roboto:wght@400;500;700&family=Share+Tech+Mono&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Estrategia Network first, falling back to cache
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
