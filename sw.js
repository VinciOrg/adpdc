const CACHE_NAME = "ad-central-midia-r2-v7-push";
const LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./icons.js",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./assets/logo-igreja.jpg",
  "./assets/brand-mark.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});


self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Central de Mídia", body: event.data ? event.data.text() : "Novo arquivo recebido." };
  }

  const title = payload.title || "Central de Mídia";
  const options = {
    body: payload.body || "Novo arquivo recebido.",
    icon: payload.icon || "./assets/icon-192.png",
    badge: payload.badge || "./assets/icon-192.png",
    tag: payload.tag || "central-midia-novo-arquivo",
    renotify: true,
    data: {
      url: payload.url || "./#filesSection",
      fileId: payload.fileId || null
    }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      typeof self.registration.setAppBadge === "function"
        ? self.registration.setAppBadge().catch(() => {})
        : Promise.resolve()
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = event.notification?.data?.url || "./#filesSection";
  const targetUrl = new URL(requested, self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === new URL(targetUrl).origin) {
        try { await client.navigate(targetUrl); } catch {}
        await client.focus();
        if (typeof self.registration.clearAppBadge === "function") {
          await self.registration.clearAppBadge().catch(() => {});
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    if (typeof self.registration.clearAppBadge === "function") {
      await self.registration.clearAppBadge().catch(() => {});
    }
  })());
});
