const CACHE_NAME = 'tvc-medic-v11';
const ASSETS_TO_CACHE = [
  '/medic',
  '/api/medic/roster',
  '/static/manifest_medic.json',
  '/static/imgs/medic_icon.png',
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
    caches.open(CACHE_NAME).then(async (cache) => {
      // Usar Promise.allSettled para que si alguna fuente externa falla no impida la instalación offline
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn('[SW Medic] No se pudo cachear:', url, err);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            console.log('[SW Medic] Borrando cache antigua:', k);
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Solo procesar peticiones GET (ignorar POST como sincronizaciones o APIs de backend)
  if (e.request.method !== 'GET') {
    return;
  }

  // Si es una peticion de navegacion (HTML de la aplicacion)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Si no hay red, buscar en cache ignorando parametros de query (?token=...)
          const match = await caches.match(e.request, { ignoreSearch: true });
          if (match) return match;
          return caches.match('/medic', { ignoreSearch: true });
        })
    );
    return;
  }

  // Para recursos estaticos (scripts, css, imagenes, fuentes)
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(async () => {
        // En caso de estar offline, buscar coincidencia ignorando query params (?v=X)
        const match = await caches.match(e.request, { ignoreSearch: true });
        if (match) return match;
        try {
          const url = new URL(e.request.url);
          return caches.match(url.pathname, { ignoreSearch: true });
        } catch (err) {
          return undefined;
        }
      })
  );
});
