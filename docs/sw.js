const CACHE_NAME = 'dow-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-192-maskable.png',
    '/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // API calls always go to network
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503 })));
        return;
    }

    // Static assets: cache-first
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)$/)) {
        event.respondWith(
            caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return res;
            }))
        );
        return;
    }

    // Pages: network-first with cache fallback
    event.respondWith(
        fetch(event.request).then((res) => {
            if (res.status === 200) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return res;
        }).catch(() => {
            return caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return caches.match('/');
            });
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
