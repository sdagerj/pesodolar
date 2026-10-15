/* PesoDólar — Service Worker
   · Shell (HTML/iconos) → caché primero, revalida por detrás
   · datos.json          → siempre red, con la última copia como respaldo
   · APIs externas       → no se tocan, pasan directo

   Este handler NUNCA puede resolver a undefined: si lo hace, el navegador
   aborta la navegación y la app no abre, que es peor que no tener caché.

   Sube el número de versión en cada cambio para que los dispositivos ya
   instalados descarten la copia vieja. */
const CACHE = "pesodolar-v8";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      // uno por uno: si un archivo falla, los demás igual quedan guardados
      await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    } catch (_) {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("datos.json")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.status === 200) {
          const c = await caches.open(CACHE);
          c.put("datos-ultimo", res.clone());
        }
        return res;
      } catch (_) {
        const hit = await caches.match("datos-ultimo");
        return hit || new Response("{}", { headers: { "Content-Type": "application/json" } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      e.waitUntil((async () => {
        try {
          const res = await fetch(req);
          if (res && res.status === 200) {
            const c = await caches.open(CACHE);
            await c.put(req, res.clone());
          }
        } catch (_) {}
      })());
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (_) {
      if (req.mode === "navigate") {
        const idx = await caches.match("./index.html") || await caches.match("./");
        if (idx) return idx;
      }
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Sin conexion</title>" +
        "<body style='background:#0A0F18;color:#D8D2C6;font-family:monospace;display:flex;" +
        "align-items:center;justify-content:center;height:100vh;margin:0;text-align:center'>" +
        "<div><p style='color:#C49B3C;font-size:18px'>PesoDolar</p>" +
        "<p>Sin conexion y sin copia guardada.</p>" +
        "<p><a href='.' style='color:#C49B3C'>Reintentar</a></p></div>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  })());
});
