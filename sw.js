const CACHE = "ronen-v12";
const SHELL = ["./", "index.html", "styles.css", "app.js", "bases.js", "codes.js", "manifest.json",
  "img/hero.jpg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (fresh forecasts and app updates), cache as offline fallback.
// "no-cache" makes the browser check GitHub every time instead of reusing a copy for up to
// 10 minutes, so a new version reaches phones on the next open.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const fresh = e.request.mode === "navigate" ? fetch(e.request.url, { cache: "no-cache" }) : fetch(e.request, { cache: "no-cache" });
  e.respondWith(
    fresh.then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
