/* dewmap shell service worker.
 *
 * Caches the app shell and hashed Next.js chunks so the interface opens
 * offline after the first visit. Map tiles and routing APIs stay
 * network-only: they are large, time-sensitive, and often licensed for
 * online use only.
 */

/* Bump on every change that must reach an installed home-screen app: the
 * shell (index, manifest, icons) is cache-first, so a new cache name is what
 * forces the manifest colours and the shell to be re-read. */
const CACHE = "dewmap-shell-v4";
const SCOPE = self.registration.scope;

const SHELL = [
  SCOPE,
  new URL("manifest.webmanifest", SCOPE).href,
  new URL("icon.svg", SCOPE).href,
  new URL("icon-512.png", SCOPE).href,
  new URL("apple-icon.png", SCOPE).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SCOPE, copy));
          return response;
        })
        .catch(() => caches.match(SCOPE).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  if (SHELL.includes(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
