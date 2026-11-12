// Nova sur le téléphone, version « adresse fixe » (GitHub Pages) : service worker de la coquille.
// 2026-11-12 : la page vit à une adresse qui ne change jamais ; elle seule est gardée en cache.
//  - réseau d'abord (3 s), sinon le cache, sinon une copie de secours : l'appli s'ouvre toujours, même hors ligne ;
//  - ne touche JAMAIS une autre adresse (le PC, la boîte aux lettres, les images) : appli.js s'en occupe.
// Publié par outils/telephone_pages.py sous le nom « sw.js » (portée = le dossier de l'appli).
const VERSION = "nova-pages-1";
const REVISION = "2026-11-12-micro-webview2";   // changer cette ligne = les téléphones reprennent la coquille (le cache garde son nom)
const RACINE = new URL("./", self.location.href).pathname;
const COQUILLE = ["", "index.html", "appli.js", "reveil.html", "video.js", "bureau.js", "manifest.webmanifest",
  "icone-180.png", "icone-192.png", "icone-512.png", "icone-masquable-192.png", "icone-masquable-512.png"].map(f => RACINE + f);

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(COQUILLE.map(u => fetch(u, { cache: "no-cache" })
      .then(r => { if (r.ok) { c.put(u, r.clone()); return c.put("~secours" + u, r); } }).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function avecDelai(p, ms) {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error("délai")), ms);
    p.then(r => { clearTimeout(t); ok(r); }, x => { clearTimeout(t); ko(x); });
  });
}

async function servir(e, cle) {
  const c = await caches.open(VERSION);
  const frais = fetch(e.request.mode === "navigate" ? cle : e.request, { cache: "no-cache" }).then(r => {
    if (r.ok && r.type === "basic") { c.put(cle, r.clone()); c.put("~secours" + cle, r.clone()); }
    return r;
  });
  try {
    const r = await avecDelai(frais, 3000);
    if (r.ok) return r;
    throw new Error("http " + r.status);
  } catch (x) {
    e.waitUntil(frais.catch(() => null));
    const v = (await c.match(cle)) || (await c.match("~secours" + cle));
    if (v) return v;
    try { return await frais; } catch (y) {}
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="refresh" content="10"><body style="margin:0;padding:40px 22px;background:#07041a;color:#f4efff;font:19px/1.45 system-ui,sans-serif">' +
      '<h1 style="font-weight:300;letter-spacing:.2em">NOVA</h1><p>Pas de réseau pour l\'instant, nouvel essai dans 10 secondes.</p></body>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || !u.pathname.startsWith(RACINE)) return;   // le PC, la boîte, le reste : jamais touchés
  if (u.pathname === RACINE + "sw.js" || u.pathname === RACINE + "version.json") return;
  if (r.mode === "navigate") {
    const p = u.pathname === RACINE || u.pathname === RACINE + "index.html" ? RACINE : u.pathname;
    if (p === RACINE || p === RACINE + "reveil.html") e.respondWith(servir(e, p));
    return;
  }
  if (COQUILLE.includes(u.pathname) || /\/demarrage-\d+x\d+\.png$/.test(u.pathname)) e.respondWith(servir(e, u.pathname));
});
