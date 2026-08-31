/* ---------- offline app-shell cache ----------
   Precaches the static app shell (HTML/CSS/JS/icons/fonts/supabase-js) so the
   page can open with no connection. Actual data still comes from Supabase
   over the network (see js/persistence.js for the offline data fallback) —
   this worker deliberately leaves supabase.co requests alone so load()/save()
   see real network failures instead of a stale cached API response.
------------------------------------------------- */
const SHELL_CACHE = 'p25-shell-v56';
const RUNTIME_CACHE = 'p25-runtime-v1';
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  // Same list, same order, as the <script> tags in index.html — cache.addAll() rejects as a unit,
  // so a name that drifts out of sync here fails the whole install and leaves the app with no
  // shell at all. A name merely *missing* is quieter and worse: it installs fine and the app then
  // boots offline with that tab's render function undefined.
  // first, exactly as in index.html: it decides the role before anything else runs
  './js/pin.js',
  './js/core.js',
  './js/persistence.js',
  './js/protecteddays.js',
  './js/nav.js',
  './js/goals.js',
  './js/habits.js',
  './js/countdowns.js',
  './js/settings.js',
  './js/backups.js',
  './js/access.js',
  './js/mantras.js',
  './js/motivation.js',
  './js/music.js',
  './js/checklists.js',
  './js/notes.js',
  './js/scratch.js',
  './js/finance.js',
  './js/wishlist.js',
  './js/jobs.js',
  './js/fitness.js',
  './js/valorant.js',
  './js/clock.js',
  './js/calendar.js',
  './js/tft.js',
  './js/board.js',
  './js/insights.js',
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
  // The YouTube IFrame API (session music, js/music.js) is a versioned loader that pulls the real
  // widget code itself — caching it would pin a stale player, and it's useless offline anyway.
  // Loopback is scripts/valorant-local-server.mjs (Valorant Local Helper / Live Match). Its
  // GET /status heartbeat is cross-origin, so without this it fell through to cacheFirst below
  // and the connection dot could keep reporting "connected" against a server that had been
  // stopped. Nothing it serves is cacheable — it's all live machine state.
  // api.metatft.com is the TFT rank/LP sync (js/tft.js). Same reasoning as the Valorant APIs: it's
  // live rank data that changes every game, so it must never come back from cache. Note this is
  // only the API host — raw.communitydragon.org (the TFT rank crests) is deliberately NOT listed,
  // since those are immutable art and are worth caching for offline.
  // The access log's IP-geolocation lookups (js/access.js). Listed for a sharper reason than the
  // rest: the cross-origin branch below is cache-FIRST, so a cached lookup would pin the answer to
  // whatever network the app was first opened on and every later session would claim that place.
  // Instagram and TikTok are the Motivation tab's video links (js/motivation.js), and they are
  // listed for a different reason again from the rest: a cross-origin IFRAME load is a
  // `mode: 'navigate'` request, so without this it falls into the navigate branch below and gets
  // networkFirst'd against the SHELL cache — which would write a third-party embed page into the
  // app shell and, on any network blip, serve './index.html' INTO the video frame, rendering the
  // whole app inside the player. This is also why youtube.com above already had to be here.
  const LIVE_DATA_HOSTS = ['.supabase.co', 'api.henrikdev.xyz', 'valorant-api.com',
    'api.metatft.com', 'ipwho.is', 'ipapi.co', 'get.geojs.io',
    'youtube.com', 'youtube-nocookie.com', 'ytimg.com', 'ggpht.com',
    'instagram.com', 'cdninstagram.com', 'tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'ttwstatic.com',
    '127.0.0.1', 'localhost'];
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
