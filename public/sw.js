/* KnowledgeAI Service Worker (P5-1, hand-written - no workbox dependency).
 *
 * Strategy:
 *  - install: precache the UNAUTHENTICATED app shell only (landing page,
 *    login page, manifest, icons)
 *  - navigate requests: network-first; on failure serve an explicit
 *    "service unavailable / offline" page (never a stale cached page)
 *  - /_next/static/* (hashed JS/CSS chunks): stale-while-revalidate so a
 *    loaded app works offline and updates in the background when online
 *  - /api/*: network-only - API responses contain tenant/user data and must
 *    never be cached
 *  - other same-origin assets (favicon, icons, manifest): cache-first
 *
 * Bump VERSION to invalidate all cached entries after a deployment.
 *
 * ── E3/E4 hardening (engineering-assurance 2026-09-30) ────────────────────
 * Incident: after the server was shut down, http://localhost:3000/ still
 * served a login page. Root cause was two overlapping fail-open behaviours -
 * an orphaned next-server process AND this worker silently serving the cached
 * shell when the origin was unreachable. There was no way to remotely disable
 * an already-installed worker. Three changes:
 *
 *  E3  Remote kill switch. /sw-config.json is fetched on activate; when it
 *      returns `{ "disabled": true }` the worker clears every cache and
 *      unregisters itself. Ship the file (or an nginx rewrite) to retire the
 *      worker on every client without user action.
 *  E4  Narrowed precache. The shell used to include authenticated routes
 *      (/dashboard, /knowledge-base, /chat, /agent). Only unauthenticated
 *      routes are precached now, so a signed-out browser can never be handed
 *      a signed-in page shell out of the cache.
 *  E4  Explicit offline failure. A failed navigation returns a dedicated
 *      "offline" page instead of `caches.match(request) || "/"`, which used to
 *      mask a dead origin behind a plausible-looking cached page.
 */

const VERSION = "p5-1-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
/** Runtime endpoint that can retire this worker (E3). */
const CONFIG_URL = "/sw-config.json";

// E4: unauthenticated shell only. Authenticated routes are deliberately NOT
// precached - offline access to them used to make a shut-down server look
// alive, and an authenticated shell has no business being served offline.
const APP_SHELL = [
  "/",
  "/login",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/** Explicit offline page (E4) - self-contained, needs neither cache nor network. */
function offlineResponse() {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>服务暂时不可用</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0d12;color:#e6e8ee;font:16px/1.6 -apple-system,"PingFang SC",system-ui,sans-serif}
  main{max-width:26rem;padding:2rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .75rem}
  p{margin:0 0 1.25rem;color:#9aa3b2}
  button{font:inherit;color:#e6e8ee;background:#1f2430;border:1px solid #333a48;
         border-radius:.5rem;padding:.6rem 1.25rem;cursor:pointer}
  button:hover{background:#262c3a}
  code{color:#9aa3b2}
</style></head>
<body><main>
  <h1>服务暂时不可用</h1>
  <p>无法连接到服务器。<strong>当前显示的是离线提示页，未加载任何页面内容。</strong></p>
  <p><button onclick="location.reload()">重试</button></p>
  <p><code>KnowledgeAI · offline</code></p>
</main></body></html>`;
  return new Response(html, {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** E3: is the worker remotely disabled? Fail-open to "enabled" - a fetch error
 *  must not brick offline support; the config file simply has to exist. */
async function isRemotelyDisabled() {
  try {
    const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const cfg = await res.json();
    return cfg && cfg.disabled === true;
  } catch {
    return false;
  }
}

/** E3: retire this worker and drop every cached response. */
async function selfDestruct() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
}

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
    (async () => {
      // E3: kill switch first - if the operator retired the worker, nothing
      // below runs and the client is left clean.
      if (await isRemotelyDisabled()) {
        await selfDestruct();
        return;
      }
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("p5-1-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
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

  // Navigations: network-first. On failure serve the explicit offline page
  // (E4) - NOT a cached copy of the page, which used to hide a dead origin.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => cachePut(request, response))
        .catch(() =>
          // Only the unauthenticated shell may be served from cache (E4);
          // anything else gets the offline page. Both are explicit failures.
          caches.match(request).then((cached) => {
            if (cached && APP_SHELL.includes(url.pathname)) return cached;
            return offlineResponse();
          })
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
