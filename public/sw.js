/* KnowledgeAI Service Worker (P5-1, hand-written - no workbox dependency).
 *
 * Strategy:
 *  - install: precache the app shell (top-level routes + manifest + icons)
 *  - navigate requests: network-first, falling back to the cache so pages
 *    that were loaded while online stay accessible offline
 *  - /_next/static/* (hashed JS/CSS chunks): stale-while-revalidate so a
 *    loaded app works offline and updates in the background when online
 *  - /api/*: network-only - API responses contain tenant/user data and must
 *    never be cached
 *  - other same-origin assets (favicon, icons, manifest): cache-first
 * Bump VERSION to invalidate all cached entries after a deployment. */
const VERSION = "p5-1-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const APP_SHELL = [
  "/",
  "/dashboard",
  "/knowledge-base",
  "/chat",
  "/agent",
  "/login",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("p5-1-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Cache a request in the runtime cache and return the cached response. */
async function cachePut(request, response) {
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API responses carry per-tenant/user data - never cache them.
  if (url.pathname.startsWith("/api/")) return;

  // Same-origin only; cross-origin (CDN fonts, external images) goes to network.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first with cached fallback (offline access to
  // pages that were loaded while online).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cachePut(request, response))
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Hashed Next.js build assets: stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => cachePut(request, response));
        return cached || network;
      })
    );
    return;
  }

  // Other same-origin assets (favicon, icons, manifest, images): cache-first.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => cachePut(request, response)))
  );
});
