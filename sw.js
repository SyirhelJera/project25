/* ---------- offline app-shell cache ----------
   Precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) so the
   page can open with no connection. Actual data still comes from Supabase
   over the network (see js/persistence.js for the offline data fallback) —
   this worker deliberately leaves supabase.co requests alone so load()/save()
   see real network failures instead of a stale cached API response.
------------------------------------------------- */
const SHELL_CACHE = 'p25-shell-v2';
const RUNTIME_CACHE = 'p25-runtime-v1';
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/core.js',
  './js/persistence.js',
  './js/aboutme.js',
  './js/nav.js',
  './js/goals.js',
  './js/habits.js',
  './js/countdowns.js',
  './js/insights.js',
  './js/backups.js',
  './js/mantras.js',
  './js/motivation.js',
  './js/checklists.js',
  './js/finance.js',
  './js/fitness.js',
  './js/valorant.js',
  './js/main.js',
  './favicon.ico',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !CURRENT_CACHES.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Data reads/writes must always hit the network live — never intercept these,
  // so persistence.js's own offline handling (local cache fallback) kicks in. This
  // also covers the Valorant APIs (rank/history/store data changes constantly —
  // unlike the fonts/supabase-js bundle below, it must never be served from cache).
  const LIVE_DATA_HOSTS = ['.supabase.co', 'api.henrikdev.xyz', 'valorant-api.com'];
  if (LIVE_DATA_HOSTS.some(h => url.hostname === h || url.hostname.endsWith(h))) return;

  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE, req.mode === 'navigate' ? './index.html' : null));
    return;
  }
  // Cross-origin static assets (fonts, supabase-js CDN): cache-first, since
  // they're effectively immutable and this keeps things fast + reliable offline.
  event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = (await cache.match(req)) || (fallbackUrl && await cache.match(fallbackUrl));
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
