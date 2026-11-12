// Nova sur le téléphone : la COQUILLE d'appli (agent A). Chargé dans le <head> de index.html, AVANT le script de l'interface.
// Ce qu'il fait (rien de l'interface elle-même) :
//  - le jeton du QR code (#j=…) est échangé UNE fois contre un cookie HttpOnly (POST /api/connexion), puis effacé de
//    l'adresse : l'appli installée s'ouvre sur https://<pc>:8766/ sans rien. NovaAppli.jeton le garde en mémoire
//    pour CETTE ouverture seulement (premiers appels avant que le cookie soit posé).
//  - le service worker (coquille hors ligne : « Nova se réveille… » si le PC ne répond pas),
//  - l'écran de démarrage (iPhone : image ; dans l'appli : un fondu depuis l'orbe),
//  - garder l'écran allumé (wake lock) : NovaAppli.garderEcran(true|false), repris tout seul au retour sur l'appli,
//  - l'installation : bandeau discret « Installer Nova » (Android : bouton ; iPhone : Partager > Sur l'écran d'accueil).
// API : window.NovaAppli = { jeton, ios, android, autonome, pret (Promise<bool> connecté), garderEcran(on),
//        peutInstaller, installer(), micro() -> "granted" | "prompt" | "denied" | "?",
//        2026-11-07 partout : base (adresse qui répond), chemin ("internet" | "wifi"), decouvrir(), audio(url) -> src à jouer,
//        événement "nova-chemin" }
// 2026-11-07 partout : window.fetch est remplacé pour les seuls appels /api/… de la page (voir plus bas).
(function () {
  "use strict";
  const NA = (window.NovaAppli = window.NovaAppli || {});
  const ua = navigator.userAgent;
  NA.ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  NA.android = /Android/i.test(ua);
  NA.autonome = navigator.standalone === true ||
    ["fullscreen", "standalone", "minimal-ui"].some(m => matchMedia("(display-mode: " + m + ")").matches);
  document.documentElement.classList.add(NA.autonome ? "nova-appli" : "nova-navigateur");

  const stock = {
    lire(k) { try { return localStorage.getItem(k) || ""; } catch (x) { return ""; } },
    ecrire(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (x) {} },
  };

  // ---------- 2026-11-07 partout : la connexion, à la maison comme dehors ----------
  // Au scan (#j=…, jamais envoyé dans une adresse), POST /api/connexion donne : un jeton d'APPAREIL (révocable), la boîte
  // aux lettres (sujet + clé) où le PC publie son adresse Internet du moment (chiffrée + signée), et les adresses actuelles.
  // Ensuite, CHAQUE appel /api/… de la page est envoyé par window.fetch (remplacé ci-dessous) à l'adresse qui répond :
  // le tunnel Internet du moment (https://<mots>.trycloudflare.com, vrai certificat), ou le Wi-Fi direct si « maison ».
  // Si le PC ne répond plus (Nova relancée = nouvelle adresse), on relit la boîte aux lettres, on vérifie, on bascule.
  // L'appli installée garde l'origine du jour de l'installation : le service worker (sw.js) sert la page depuis son cache
  // même si cette adresse-là n'existe plus, et la rafraîchit depuis l'adresse du moment.
  const fetchOrig = window.fetch.bind(window);
  const ORIGINE = location.origin;
  // 2026-11-12 adresse fixe (section K de COORDINATION.md) : la même page est aussi publiée sur GitHub Pages, à une adresse
  // qui ne change JAMAIS. Là-bas, rien ne vient du PC : la page appelle le tunnel du moment (trouvé dans la boîte aux
  // lettres) en cross-origin, avec le jeton d'appareil en en-tête (jamais de cookie). Le stockage (mémos, réglages, clé)
  // reste donc sur une origine stable.
  const PAGES_ORIGINE = "https://baptistedezzole-hash.github.io";
  const PAGES_URL = PAGES_ORIGINE + "/nova-telephone/";
  const PAGES = ORIGINE === PAGES_ORIGINE;
  const RACINE = PAGES ? new URL(".", (document.currentScript && document.currentScript.src) || location.href).pathname : "/";
  NA.pages = PAGES; NA.racine = RACINE; NA.adresseFixe = PAGES_URL;
  const BASE_OK = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
  const LOCAL_OK = /^https:\/\/(10|192\.168|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){2,3}(:\d+)?$/;
  const idb = {   // MÊME base que sw.js : « nova-appli », magasin « kv », clé « conf »
    ouvrir() {
      return new Promise((ok, ko) => {
        const r = indexedDB.open("nova-appli", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
      });
    },
    async lire(k) {
      try { const db = await this.ouvrir(); return await new Promise(ok => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); }
      catch (x) { return undefined; }
    },
    async ecrire(k, v) {
      try { const db = await this.ouvrir(); await new Promise(ok => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = t.onerror = () => ok(); }); }
      catch (x) {}
    },
  };
  let conf = null;            // { appareil, base, boite: { sujet, cle, serveurs }, local }
  NA.base = "";               // l'adresse qui répond en ce moment
  NA.chemin = "";             // "internet" | "wifi" | ""
  function delai(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }
  const memeOrigine = b => { try { return new URL(b).origin === ORIGINE; } catch (x) { return false; } };
  async function ping(base, ms) {
    if (!base) return false;
    // 2026-11-07 partout : jusqu'à 3 essais rapides (Nova relancée derrière le même tunnel : les 1res réponses sont souvent un 502)
    const fin = Date.now() + ms;
    for (let essai = 0; essai < 3; essai++) {
      const reste = fin - Date.now();
      if (reste < 300) break;
      try {
        const r = await fetchOrig(base + "/ping", { cache: "no-store", credentials: "omit", mode: memeOrigine(base) ? "same-origin" : "cors", signal: delai(reste) });
        if (r.status === 204) return true;
      } catch (x) { if (x && x.name === "AbortError") return false; }
      await new Promise(ok => setTimeout(ok, 500 * (essai + 1)));
    }
    return false;
  }
  // --- la boîte aux lettres : chiffrée (flux HMAC-SHA256) et signée (HMAC-SHA256), comme outils\telephone_internet.py ---
  const enc = t => new TextEncoder().encode(t);
  const deb64 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const coller = (...l) => { const n = l.reduce((a, b) => a + b.length, 0), o = new Uint8Array(n); let i = 0; for (const b of l) { o.set(b, i); i += b.length; } return o; };
  async function hmac(cle, data) {
    const k = await crypto.subtle.importKey("raw", cle, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
  }
  async function ouvrirScelle(cleB64, s) {
    if (typeof s !== "string" || !s.startsWith("nb1.") || !(crypto && crypto.subtle)) return null;
    let b; try { b = deb64(s.slice(4)); } catch (x) { return null; }
    if (b.length < 49) return null;
    const cle = deb64(cleB64), nonce = b.slice(0, 16), chiffre = b.slice(16, b.length - 32), sig = b.slice(b.length - 32);
    const km = await hmac(cle, enc("signe")), ke = await hmac(cle, enc("chiffre"));
    const attendu = await hmac(km, coller(enc("nova-boite-v1"), nonce, chiffre));
    let diff = 0; for (let i = 0; i < 32; i++) diff |= attendu[i] ^ sig[i];
    if (diff) return null;   // pas signé par le PC : ignoré
    const clair = new Uint8Array(chiffre.length);
    for (let i = 0, bloc = 0; i < chiffre.length; bloc++) {
      const f = await hmac(ke, coller(nonce, new Uint8Array([bloc >>> 24, (bloc >>> 16) & 255, (bloc >>> 8) & 255, bloc & 255])));
      for (let j = 0; j < 32 && i < chiffre.length; j++, i++) clair[i] = chiffre[i] ^ f[j];
    }
    try { return JSON.parse(new TextDecoder().decode(clair)); } catch (x) { return null; }
  }
  async function lireBoite() {
    const b = conf && conf.boite;
    if (!b || !b.sujet || !b.cle) return [];
    for (const srv of (b.serveurs || ["https://ntfy.sh"])) {
      try {
        const r = await fetchOrig(srv + "/" + b.sujet + "/json?poll=1&since=24h", { cache: "no-store", credentials: "omit", signal: delai(7000) });
        if (!r.ok) continue;
        const out = [];
        for (const l of (await r.text()).split("\n")) {
          let m; try { m = JSON.parse(l); } catch (x) { continue; }
          if (m.event !== "message") continue;
          const d = await ouvrirScelle(b.cle, m.message);
          if (d && BASE_OK.test(d.u || "")) out.push(d);
        }
        if (out.length) return out.sort((x, y) => (y.t || 0) - (x.t || 0));
      } catch (x) {}
    }
    return [];
  }
  async function sauver() {
    if (!conf) return;
    await idb.ecrire("conf", conf);
    if (conf.appareil) stock.ecrire(CLE_LS, JSON.stringify(conf));   // 2026-11-07 clé téléphone
  }
  function choisir(base) {
    NA.base = base; NA.chemin = base ? (LOCAL_OK.test(base) ? "wifi" : "internet") : "";
    if (base && conf && conf.base !== base && !LOCAL_OK.test(base)) { conf.base = base; sauver(); }
    dispatchEvent(new CustomEvent("nova-chemin", { detail: { chemin: NA.chemin } }));
  }
  let recherche = null, derniere = 0;
  NA.decouvrir = function (force) {   // « où est le PC maintenant ? » (une seule à la fois, pas plus d'une toutes les 4 s)
    if (recherche) return recherche;
    if (!conf || !conf.appareil || (!force && Date.now() - derniere < 4000)) return Promise.resolve(!!NA.base);
    recherche = (async () => {
      try {
        const msgs = await lireBoite();
        const m = msgs[0];
        const essais = [];
        if (m && m.l && LOCAL_OK.test(m.l)) essais.push([m.l, 1500]);   // le Wi-Fi direct d'abord (« maison »)
        if (m) essais.push([m.u, 6000]);
        if (conf.base) essais.push([conf.base, 4000]);
        conf.local = (m && m.l && LOCAL_OK.test(m.l)) ? m.l : (m ? "" : conf.local);
        const vus = new Set();
        for (const [b, ms] of essais) {
          if (vus.has(b)) continue; vus.add(b);
          if (await ping(b, ms)) { choisir(b); return true; }
        }
        choisir("");
        return false;
      } finally { recherche = null; derniere = Date.now(); }
    })();
    return recherche;
  };
  // 2026-11-07 clé téléphone : la clé est aussi gardée dans localStorage (si IndexedDB est vidé / indisponible)
  const CLE_LS = "nova-conf-v1";
  async function lireConf() {
    let c = await idb.lire("conf");
    if (!c || !c.appareil) { try { const t = JSON.parse(stock.lire(CLE_LS) || "null"); if (t && t.appareil) c = t; } catch (x) {} }
    return c || null;
  }
  // le manifeste (start_url de l'appli installée) porte un code d'appairage à usage unique : on le redemande une fois
  // connecté (le cookie est posé), pour qu'une installation faite plus tard reçoive la clé
  function rafraichirManifeste() {
    if (PAGES) return;   // adresse fixe : manifeste statique, sans secret
    try {
      const l = document.getElementById("manif");
      if (l && !NA.autonome) l.href = "/manifest.webmanifest?v=" + Date.now();
    } catch (x) {}
  }
  async function connexion(entetes, base, essais) {
    // plusieurs essais : un tunnel tout neuf peut répondre de travers quelques secondes (le jeton du QR ne sert qu'ici)
    // adresse fixe : vers le tunnel donné (cross-origin, sans cookie) ; sinon la même origine, comme avant
    if (PAGES && !(BASE_OK.test(base || "") || LOCAL_OK.test(base || ""))) return null;
    let r = null;
    for (let essai = 0; essai < (essais || 5); essai++) {
      try {
        r = await fetchOrig(PAGES ? base + "/api/connexion" : "/api/connexion", { method: "POST", cache: "no-store",
          mode: PAGES ? "cors" : "same-origin", credentials: PAGES ? "omit" : "same-origin",
          headers: Object.assign({ "Content-Type": "application/json" }, entetes), body: "{}", signal: delai(8000) });
        if (r.ok || r.status === 401 || r.status === 403) break;
      } catch (x) { r = null; }
      await new Promise(ok => setTimeout(ok, 800 * (essai + 1)));
    }
    if (!r || !r.ok) return null;
    const d = await r.json();
    const bases = d.bases || {};
    conf = { appareil: d.appareil || (conf && conf.appareil) || "", boite: d.boite || (conf && conf.boite) || null,
      base: PAGES ? (BASE_OK.test(bases.internet || "") ? bases.internet : (BASE_OK.test(base) ? base : ""))
        : BASE_OK.test(ORIGINE) ? ORIGINE : (bases.internet || ORIGINE),
      local: bases.local || (LOCAL_OK.test(ORIGINE) ? ORIGINE : "") };   // appli installée sur le Wi-Fi (certificat) : direct d'abord
    await sauver();
    return d;
  }
  // 2026-11-12 adresse fixe : la boîte aux lettres se déduit du seul jeton du QR (comme outils\telephone_internet.py :
  // sujet = "nova" + HMAC(jeton, "boite-sujet-v1")[:40 hex], clé = HMAC(jeton, "boite-cle-v1")) : même si le tunnel écrit
  // dans le QR est déjà mort au moment du scan, on retrouve le PC.
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function boiteDuJeton(j) {
    try {
      const k = enc(j);
      return { sujet: "nova" + hex(await hmac(k, enc("boite-sujet-v1"))).slice(0, 40), cle: b64url(await hmac(k, enc("boite-cle-v1"))),
        serveurs: ["https://ntfy.sh", "https://ntfy.envs.net"] };
    } catch (x) { return null; }
  }
  // le jeton du QR -> un jeton d'appareil, depuis l'adresse fixe : le tunnel du QR d'abord, puis ceux de la boîte
  async function echangerQR() {
    if (!PAGES) return connexion({ "X-Nova-Jeton": NA.jeton });
    const vus = new Set(), essais = [];
    if (BASE_OK.test(tunnelQR)) essais.push(tunnelQR);
    for (const b of essais) {
      vus.add(b);
      const d = await connexion({ "X-Nova-Jeton": NA.jeton }, b, 2);
      if (d) return d;
    }
    const sauve = conf;
    conf = Object.assign({}, conf || {}, { boite: await boiteDuJeton(NA.jeton) });
    const msgs = await lireBoite();
    conf = sauve;
    for (const m of msgs.slice(0, 3)) {
      if (vus.has(m.u)) continue; vus.add(m.u);
      const d = await connexion({ "X-Nova-Jeton": NA.jeton }, m.u, 2);
      if (d) return d;
    }
    return null;
  }

  // ---------- le jeton du QR -> l'appareil (et le cookie, pour le Wi-Fi) ----------
  const h = new URLSearchParams(location.hash.slice(1));
  const duQR = h.get("j") || "";
  NA.jeton = duQR || (PAGES ? "" : stock.lire("nova-jeton"));   // l'ancien stockage (avant la coquille) sert une dernière fois
  // adresse fixe : #j=<jeton>&t=<tunnel du moment> (QR), ou #a=<appareil>&b=<tunnel> (passage depuis l'ancienne appli,
  // sans nouveau scan). Rien de cela n'est jamais envoyé à GitHub (le # reste dans le téléphone) et tout est effacé tout de suite.
  const tunnelQR = PAGES ? (h.get("t") || h.get("b") || "") : "";
  const migreAppareil = PAGES ? (h.get("a") || "") : "";
  if (PAGES && (duQR || h.has("t") || h.has("a") || h.has("b"))) {
    try { history.replaceState(null, "", location.pathname + location.search); } catch (x) {}
  }
  function adresse(recherche) {
    h.delete("j");
    const reste = h.toString();
    return location.pathname + (recherche ? "?" + recherche : "") + (reste ? "#" + reste : "");
  }
  const q = new URLSearchParams(location.search);
  const lien = q.get("lien") || "";
  const appairage = q.get("appairage") || "";   // 2026-11-07 clé téléphone : start_url de l'appli installée (Android / iPhone)
  if (appairage) { q.delete("appairage"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
  if (!PAGES && (duQR || (lien && NA.autonome))) history.replaceState(null, "", adresse(NA.autonome ? "" : q.toString()));

  async function demarrerPages() {   // 2026-11-12 adresse fixe
    conf = await lireConf();
    if (conf && conf.appareil) await sauver();
    if (NA.jeton) {   // un QR scanné : il remplace l'ancienne clé (nouveau PC, révocation…)
      await echangerQR();
    } else if (migreAppareil && !(conf && conf.appareil) && /^[0-9a-f]{8}\.[A-Za-z0-9_-]{20,}$/.test(migreAppareil)) {
      conf = { appareil: migreAppareil, base: "", boite: null, local: "" };
      if (!(await connexion({ "X-Nova-Appareil": migreAppareil }, tunnelQR, 3))) conf = null;   // clé refusée : rien gardé
    }
    if (!conf || !conf.appareil) return false;
    if (conf.local && await ping(conf.local, 1500)) choisir(conf.local);
    else if (await ping(conf.base, 4000)) choisir(conf.base);
    else { derniere = 0; await NA.decouvrir(); }
    return !!NA.base;
  }

  NA.pret = (async () => {
    if (PAGES) {
      try { return (NA.connecte = await demarrerPages()); } catch (x) { return (NA.connecte = false); }
      finally { attente(); }
    }
    try {
      conf = await lireConf();
      if (conf && conf.appareil) await sauver();   // recopie dans les deux stockages
      if (NA.jeton || ((lien || appairage) && !(conf && conf.appareil))) {
        try {
          const d = await connexion(NA.jeton ? { "X-Nova-Jeton": NA.jeton } : appairage ? { "X-Nova-Appairage": appairage } : { "X-Nova-Lien": lien });
          if (d) {
            stock.ecrire("nova-jeton", null);   // plus de jeton lisible par la page
            // iPhone dans Safari : l'appli de l'écran d'accueil n'aura NI ce cookie NI ce stockage : l'adresse emporte le
            // lien (et le jeton, dans le # qui n'est jamais envoyé) ; l'appli les efface en s'ouvrant.
            if (!PAGES && NA.ios && !NA.autonome && d.lien) history.replaceState(null, "", "/?lien=" + encodeURIComponent(d.lien) + (duQR ? "#j=" + encodeURIComponent(duQR) : ""));
          } else stock.ecrire("nova-jeton", null);
        } catch (x) {}
      }
      if (!conf || !conf.appareil) {   // appli d'avant (cookie du Wi-Fi) : on en profite pour avoir un jeton d'appareil
        const r = await fetchOrig("/api/session", { credentials: "same-origin", cache: "no-store" }).catch(() => null);
        if (r && r.ok) { try { await connexion({}); } catch (x) {} }
        if (!conf || !conf.appareil) { NA.base = r && r.ok ? ORIGINE : ""; return (NA.connecte = !!(r && r.ok)); }
      }
      if (conf.local && await ping(conf.local, 1500)) choisir(conf.local);
      else if (await ping(conf.base, 4000)) choisir(conf.base);
      else { derniere = 0; await NA.decouvrir(); }
      if (conf && conf.appareil) setTimeout(rafraichirManifeste, 300);
      return (NA.connecte = !!NA.base);
    } catch (x) {
      return (NA.connecte = false);
    }
  })();

  // ---------- chaque appel /api/… part vers l'adresse du moment, avec le jeton d'appareil ----------
  let rattrapage = null;
  window.fetch = async function (entree, init) {
    let u;
    try { u = new URL(entree instanceof Request ? entree.url : String(entree), location.href); } catch (x) { return fetchOrig(entree, init); }
    if (u.origin !== ORIGINE || !u.pathname.startsWith("/api/") || u.pathname === "/api/connexion") return fetchOrig(entree, init);
    await NA.pret;
    if ((!conf || !conf.appareil) && NA.jeton && !rattrapage) {   // l'échange du QR a raté (réseau) : on réessaie une fois
      rattrapage = echangerQR().then(async d => { if (d && conf && conf.appareil) { await NA.decouvrir(true); } }).catch(() => {}).finally(() => { setTimeout(() => { rattrapage = null; }, 0); });
    }
    if (rattrapage) await rattrapage;
    if (!conf || !conf.appareil) {
      if (PAGES) return new Response('{"erreur":"pas relié"}', { status: 503, headers: { "Content-Type": "application/json" } });   // rien à demander à GitHub
      return fetchOrig(entree, init);   // ancien chemin (cookie, Wi-Fi)
    }
    if (!NA.base) await NA.decouvrir();
    const base = NA.base || conf.base;
    const meme = memeOrigine(base);
    u.searchParams.delete("j");   // le jeton d'appareil suffit : le jeton du QR ne voyage jamais dans une adresse
    const req = new Request(entree, init);
    const entetes = new Headers(req.headers);
    entetes.delete("X-Nova-Jeton");
    entetes.set("X-Nova-Appareil", conf.appareil);
    const corps = (req.method === "GET" || req.method === "HEAD") ? undefined : await req.blob();
    try {
      const r = await fetchOrig(base + u.pathname + u.search, { method: req.method, headers: entetes, body: corps, cache: "no-store",
        mode: meme ? "same-origin" : "cors", credentials: meme ? "same-origin" : "omit", signal: (init && init.signal) || undefined });
      if (r.status === 502 || (r.status >= 520 && r.status <= 530)) { NA.base = ""; NA.decouvrir(); }   // tunnel disparu (Cloudflare)
      return r;
    } catch (x) {
      if (!(x && x.name === "AbortError")) { NA.base = ""; NA.decouvrir(); }
      throw x;
    }
  };
  // L'audio des réponses : chargé avec le jeton d'appareil (une balise <audio> ne sait pas envoyer d'en-tête).
  const sons = [];
  NA.audio = async function (url) {
    await NA.pret;
    if (!conf || !conf.appareil) return url;   // ancien chemin : la page ajoute ?j=
    const r = await window.fetch(url);
    if (!r.ok) throw new Error("audio " + r.status);
    const b = URL.createObjectURL(await r.blob());
    sons.push(b);
    while (sons.length > 6) URL.revokeObjectURL(sons.shift());
    return b;
  };
  // PC injoignable : on recherche toute seule, toutes les 10 s.
  setInterval(() => {
    if (PAGES && NA.jeton && !(conf && conf.appareil)) {   // adresse fixe : le scan n'a pas encore abouti (PC injoignable)
      if (!rattrapage) rattrapage = echangerQR().then(async d => { if (d) await NA.decouvrir(true); }).catch(() => {}).finally(() => { rattrapage = null; attente(); });
      return;
    }
    if (conf && conf.appareil && !NA.base) NA.decouvrir();
  }, 10000);   // (en arrière-plan, le téléphone fige la page tout seul)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && conf && conf.appareil) ping(NA.base, 3000).then(ok => { if (!ok) { NA.base = ""; derniere = 0; NA.decouvrir(); } });
  });

  // ---------- 2026-11-07 clé téléphone : mises à jour automatiques ----------
  // Le PC dit « version X » (/api/version). Si elle change : on vide les copies de la page dans le cache du service worker
  // (il va les rechercher sur le réseau), puis on recharge au prochain moment calme (rien ne s'écoute ni ne se dit) ; en
  // attendant, un petit bandeau « Mise à jour » (toucher = recharger). Jamais de réinstallation ni de nouveau scan.
  let verSeen = stock.lire("nova-version"), bandeauMaj = null;
  async function verifierVersion() {
    if (PAGES) return verifierVersionPages();
    try {
      if (!conf || !conf.appareil) return;
      const r = await window.fetch("/api/version", { cache: "no-store" });
      if (!r.ok) return;
      const v = (await r.json()).v;
      if (!v) return;
      if (!verSeen) { verSeen = v; stock.ecrire("nova-version", v); return; }
      if (v === verSeen) return;
      // 2026-11-12 récupération sans câble : si l'appli vit sur une ANCIENNE adresse (morte), son vieux service worker ne
      // se met plus jamais à jour : vider son cache la laissait sur « Nova se réveille ». On remet donc des copies fraîches
      // prises à l'adresse qui répond, et on ne vide (comportement d'avant) que sur la même adresse.
      if ("caches" in window) {
        try {
          // 2026-11-12 (bis) : même sur la même adresse on ne VIDE plus jamais : une coupure juste après le vidage (tunnel
          // qui change au redémarrage du PC) laissait un cache sans page ni reveil.html = texte « Nova se réveille… » à vie.
          const c = await caches.open("nova-coquille-2"), base = NA.base || conf.base || location.origin, meme = base === location.origin;
          let ok = false;
          for (const p of ["/", "/appli.js", "/reveil.html"]) {
            try {
              const f = await fetch(base + p, meme ? { credentials: "same-origin", cache: "no-store" } : { mode: "cors", credentials: "omit", cache: "no-store" });
              if (f.ok) { await c.put(p, new Response(await f.blob(), { status: 200, headers: { "Content-Type": f.headers.get("Content-Type") || "text/html; charset=utf-8" } })); if (p === "/") ok = true; }
            } catch (x) {}
          }
          if (!ok) return;   // rien de frais : on garde l'ancienne coquille (elle marche) et on réessaiera
        } catch (x) {}
      }
      stock.ecrire("nova-version", v); verSeen = v;
      NA.majPrete = true;
      appliquerMaj();
    } catch (x) {}
  }
  // adresse fixe : le PC republie la page sur GitHub Pages quand elle change ; version.json dit laquelle est en ligne,
  // la page connaît la sienne (<meta name="nova-version">). Une seule tentative de rechargement par version (si GitHub
  // sert encore l'ancienne page quelques minutes, pas de boucle).
  async function verifierVersionPages() {
    try {
      const m = document.querySelector('meta[name="nova-version"]');
      const ici = m ? m.content : "";
      const r = await fetchOrig(RACINE + "version.json", { cache: "no-store", credentials: "omit" });
      if (!r.ok) return;
      const v = (await r.json()).v;
      if (!v || !ici || v === ici) return;
      let tente = {}; try { tente = JSON.parse(stock.lire("nova-maj-tentee") || "{}"); } catch (x) {}
      if (tente.v === v && Date.now() - (tente.t || 0) < 15 * 60e3) return;
      stock.ecrire("nova-maj-tentee", JSON.stringify({ v, t: Date.now() }));
      NA.majPrete = true;
      appliquerMaj();
    } catch (x) {}
  }
  function appliquerMaj() {
    if (!NA.majPrete) return;
    const calme = !window.novaCalme || window.novaCalme();
    if (calme && document.visibilityState === "visible") { location.reload(); return; }
    if (!bandeauMaj && document.body) {
      bandeauMaj = document.createElement("button");
      bandeauMaj.textContent = "Mise à jour de Nova : toucher pour recharger";
      bandeauMaj.style.cssText = "position:fixed;z-index:2147482000;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top));padding:8px 14px;border:1px solid rgba(233,214,168,.5);border-radius:999px;background:rgba(2,3,10,.92);color:#e9d6a8;font:13px system-ui,sans-serif";
      bandeauMaj.onclick = () => location.reload();
      document.body.appendChild(bandeauMaj);
    }
  }
  setInterval(() => { if (NA.majPrete) appliquerMaj(); }, 4000);
  setInterval(verifierVersion, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { verifierVersion(); appliquerMaj(); } });
  addEventListener("load", () => setTimeout(verifierVersion, 4000));

  // ---------- le service worker ----------
  if ("serviceWorker" in navigator) {
    // 2026-11-07 partout : retenté (un tunnel lent peut faire rater l'enregistrement ; sans lui, pas d'appli hors ligne)
    const enregistrer = (n) => navigator.serviceWorker.register(RACINE + "sw.js", { scope: RACINE })
      .then(() => {})
      .catch(() => { if (n < 5) setTimeout(() => enregistrer(n + 1), 4000 * (n + 1)); });
    addEventListener("load", () => enregistrer(0));
  }
  // 2026-11-07 partout : la coquille COMPLÈTE dans le cache du service worker (même nom que dans sw.js). Son installation
  // peut rater un fichier (appli.js…) : sans lui, l'appli ne s'ouvrirait plus quand l'adresse d'installation aura disparu.
  async function remplirCache() {
    try {
      if (PAGES || !("caches" in window) || !("serviceWorker" in navigator)) return;   // adresse fixe : son sw.js s'en charge
      await navigator.serviceWorker.ready;
      await NA.pret;
      if (!NA.base) return;
      const c = await caches.open("nova-coquille-2"), meme = memeOrigine(NA.base);
      for (const u of ["/", "/appli.js", "/reveil.html", "/icone-192.png", "/icone-512.png", "/icone-180.png", "/icone-masquable-192.png", "/icone-masquable-512.png"]) {
        if (await c.match(u)) continue;
        try {
          const r = await fetchOrig(NA.base + u, { cache: "no-store", mode: meme ? "same-origin" : "cors", credentials: meme ? "same-origin" : "omit" });
          if (r.ok) await c.put(u, new Response(await r.blob(), { headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream" } }));
        } catch (x) {}
      }
    } catch (x) {}
  }
  addEventListener("load", () => setTimeout(remplirCache, 2500));

  // ---------- garder l'écran allumé (mains libres) ----------
  let veut = false, verrou = null;
  async function prendre() {
    if (!veut || verrou || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    try {
      verrou = await navigator.wakeLock.request("screen");
      verrou.addEventListener("release", () => { verrou = null; if (veut) setTimeout(prendre, 400); });
    } catch (x) { verrou = null; }
  }
  NA.garderEcran = function (on) {
    veut = !!on;
    if (veut) return prendre();
    if (verrou) { const v = verrou; verrou = null; v.release().catch(() => {}); }
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") prendre(); });

  // ---------- le micro : la permission reste (origine https reconnue + appli installée) ----------
  NA.micro = async function () {
    try { return (await navigator.permissions.query({ name: "microphone" })).state; } catch (x) { return "?"; }
  };

  // ---------- l'installation ----------
  let invite = null;
  NA.peutInstaller = false;
  addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    invite = e;
    NA.peutInstaller = true;
    dispatchEvent(new Event("nova-installable"));
    bandeau();
  });
  addEventListener("appinstalled", () => { NA.peutInstaller = false; invite = null; fermerBandeau(); });
  NA.installer = async function () {
    if (!invite) return false;
    invite.prompt();
    const r = await invite.userChoice.catch(() => ({}));
    invite = null; NA.peutInstaller = false;
    return r.outcome === "accepted";
  };

  let zone = null;
  function fermerBandeau(pourToujours) {
    if (pourToujours) stock.ecrire("nova-bandeau-ferme", String(Date.now()));
    if (zone) { zone.remove(); zone = null; }
  }
  function bandeau() {
    if (NA.autonome || zone || !document.body) return;
    const ferme = +stock.lire("nova-bandeau-ferme") || 0;
    if (Date.now() - ferme < 3 * 86400e3) return;   // fermé : on n'insiste pas avant 3 jours
    if (!invite && !(NA.ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua))) return;
    zone = document.createElement("div");
    const ombre = zone.attachShadow({ mode: "open" });
    ombre.innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483000; left: 12px; right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom)); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .b { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 18px; color: #f4efff;
        background: linear-gradient(135deg, rgba(42, 19, 86, .97), rgba(20, 10, 51, .97)); border: 1px solid rgba(190, 150, 255, .35);
        box-shadow: 0 10px 40px rgba(0, 0, 0, .55), 0 0 30px rgba(150, 80, 255, .25); animation: m .5s ease-out; }
      img { width: 42px; height: 42px; border-radius: 11px; flex: none; }
      .t { flex: 1; font-size: 14px; line-height: 1.35; } .t b { display: block; font-size: 15px; }
      button { font: inherit; border: 0; cursor: pointer; }
      .i { padding: 10px 16px; border-radius: 999px; color: #fff; font-weight: 600;
        background: linear-gradient(135deg, rgba(150, 80, 255, .95), rgba(255, 90, 170, .85)); }
      .x { background: none; color: rgba(233, 220, 255, .6); font-size: 20px; padding: 4px 6px; }
      @keyframes m { from { transform: translateY(30px); opacity: 0; } }
    </style><div class="b"><img src="${RACINE}icone-192.png" alt=""><div class="t"></div><button class="x" aria-label="Fermer">×</button></div>`;
    const t = ombre.querySelector(".t");
    if (invite) {
      t.innerHTML = "<b>Installer Nova</b>En vraie appli, plein écran.";
      const bt = document.createElement("button");
      bt.className = "i"; bt.textContent = "Installer";
      bt.onclick = async () => { if (await NA.installer()) fermerBandeau(); };
      ombre.querySelector(".x").before(bt);
    } else {
      t.innerHTML = "<b>Installer Nova</b>Touche Partager (le carré avec la flèche), puis « Sur l'écran d'accueil ».";
    }
    ombre.querySelector(".x").onclick = () => fermerBandeau(true);
    document.body.appendChild(zone);
  }
  if (NA.ios) addEventListener("load", () => setTimeout(bandeau, 2500));

  // ---------- écran de démarrage ----------
  // iPhone : l'image de l'écran de démarrage (lue au moment de « Sur l'écran d'accueil »), à la taille exacte de l'écran.
  if (NA.ios) {
    const r = devicePixelRatio || 1, w = Math.round(screen.width * r), hh = Math.round(screen.height * r);
    const l = document.createElement("link");
    l.rel = "apple-touch-startup-image";
    l.href = RACINE + "demarrage-" + Math.min(w, hh) + "x" + Math.max(w, hh) + ".png";
    document.head.appendChild(l);
  }
  // Dans l'appli installée : la page arrive en fondu depuis l'orbe (pas de flash blanc ni de saut).
  if (NA.autonome) {
    const voile = document.createElement("div");
    voile.id = "nova-demarrage";
    voile.setAttribute("aria-hidden", "true");
    voile.style.cssText = "position:fixed;inset:0;z-index:2147483001;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:22px;background:radial-gradient(120% 70% at 50% 45%,#101a33 0%,#060914 50%,#02030a 100%);" +
      "transition:opacity .55s ease,visibility .55s;pointer-events:none";
    voile.innerHTML = '<div style="width:124px;height:124px;border-radius:50%;overflow:hidden;box-shadow:0 0 60px rgba(150,80,255,.55)">' +
      '<img src="' + RACINE + 'icone-masquable-192.png" alt="" style="width:100%;height:100%;transform:scale(1.6)"></div>' +
      '<div style="color:#ece2ff;font:300 22px system-ui,-apple-system,sans-serif;letter-spacing:.5em;padding-left:.5em">NOVA</div>';
    document.documentElement.appendChild(voile);
    const partir = () => { voile.style.opacity = "0"; voile.style.visibility = "hidden"; setTimeout(() => voile.remove(), 700); };
    addEventListener("load", () => setTimeout(partir, 250));
    setTimeout(partir, 4000);   // jamais bloqué dessus
  }
  // ---------- 2026-11-12 adresse fixe : l'écran d'attente (jamais de page vide) ----------
  var voileAttente = null;
  function attente() {
    if (!PAGES) return;
    const montrer = !NA.base;
    if (!montrer) { if (voileAttente) { voileAttente.remove(); voileAttente = null; } return; }
    if (voileAttente && voileAttente.ferme) return;
    const sansCle = !(conf && conf.appareil) && !NA.jeton;
    if (!voileAttente) {
      voileAttente = document.createElement("div");
      voileAttente.id = "nova-attente";
      const o = voileAttente.attachShadow({ mode: "open" });
      o.innerHTML = `<style>
        :host { all: initial; position: fixed; inset: 0; z-index: 2147482500; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(120% 70% at 50% 42%, rgba(42,19,86,.96) 0%, rgba(20,10,51,.97) 50%, rgba(7,4,26,.98) 100%);
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f4efff; text-align: center; }
        .c { max-width: 360px; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .o { width: 120px; height: 120px; border-radius: 50%; background: url(${RACINE}icone-masquable-192.png) center / 165% no-repeat, #2a1356;
          box-shadow: 0 0 50px rgba(150,80,255,.55); animation: s 3.2s ease-in-out infinite; }
        @keyframes s { 50% { transform: scale(.94); filter: brightness(.75); } }
        h1 { margin: 6px 0 0; font-weight: 300; font-size: 23px; } p { margin: 0; color: rgba(233,220,255,.72); font-size: 15px; line-height: 1.5; }
        button { font: inherit; margin-top: 6px; padding: 11px 20px; border: 0; border-radius: 999px; color: #fff;
          background: linear-gradient(135deg, rgba(150,80,255,.9), rgba(255,90,170,.8)); }
        button.x { background: none; color: rgba(233,220,255,.6); margin: 0; }
        @media (prefers-reduced-motion: reduce) { .o { animation: none; } }
      </style><div class="c"><div class="o"></div><h1></h1><p></p><button class="r">Réessayer</button><button class="x">Continuer sans le PC</button></div>`;
      o.querySelector(".r").onclick = () => { derniere = 0; (conf && conf.appareil ? NA.decouvrir(true) : echangerQR()).catch(() => null).then(() => attente()); };
      o.querySelector(".x").onclick = () => { voileAttente.ferme = true; voileAttente.style.display = "none"; };
      (document.body || document.documentElement).appendChild(voileAttente);
    }
    const o = voileAttente.shadowRoot;
    o.querySelector("h1").textContent = sansCle ? "Relie l'appli à ton PC" : "Je cherche ton PC…";
    o.querySelector("p").textContent = sansCle
      ? "Sur le PC, dis « montre-moi le QR code du téléphone », puis scanne-le avec l'appareil photo."
      : "Nouvel essai toutes les 10 secondes. Vérifie que le PC est allumé et que Nova tourne.";
    o.querySelector(".r").style.display = sansCle ? "none" : "";
  }
  if (PAGES) {
    addEventListener("nova-chemin", () => attente());
    setInterval(attente, 3000);
  }

  // ---------- 2026-11-12 adresse fixe : l'ancienne appli propose d'y passer (sans nouveau scan, sans perdre de mémo) ----------
  async function fileVide() {   // la file des mémos pas encore envoyés (index.html, IndexedDB « nova-sortie »)
    try {
      const n = await new Promise(ok => {
        const r = indexedDB.open("nova-sortie", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("q", { keyPath: "mid" });
        r.onerror = r.onblocked = () => ok(-1);
        r.onsuccess = () => { try { const c = r.result.transaction("q").objectStore("q").count(); c.onsuccess = () => ok(c.result); c.onerror = () => ok(-1); } catch (x) { ok(-1); } };
      });
      let l = []; try { l = JSON.parse(stock.lire("nova-sortie") || "[]"); } catch (x) {}
      return n === 0 && !l.length;
    } catch (x) { return false; }
  }
  async function proposerAdresseFixe() {
    try {
      if (PAGES || !conf || !conf.appareil || !BASE_OK.test(NA.base || "")) return;
      if (Date.now() - (+stock.lire("nova-fixe-ferme") || 0) < 3 * 86400e3 || !document.body) return;
      const r = await fetchOrig(PAGES_URL + "version.json", { cache: "no-store", mode: "cors", credentials: "omit", signal: delai(6000) });
      if (!r.ok) return;
      const z = document.createElement("div");
      const o = z.attachShadow({ mode: "open" });
      o.innerHTML = `<style>:host { all: initial; position: fixed; z-index: 2147483000; left: 12px; right: 12px; top: calc(12px + env(safe-area-inset-top));
        font-family: system-ui, -apple-system, sans-serif; } .b { display: flex; gap: 10px; align-items: center; padding: 12px 12px 12px 14px; border-radius: 18px;
        color: #f4efff; background: linear-gradient(135deg, rgba(42,19,86,.97), rgba(20,10,51,.97)); border: 1px solid rgba(190,150,255,.35); }
        .t { flex: 1; font-size: 14px; line-height: 1.35; } .t b { display: block; font-size: 15px; } button { font: inherit; border: 0; }
        .i { padding: 10px 14px; border-radius: 999px; color: #fff; font-weight: 600; background: linear-gradient(135deg, rgba(150,80,255,.95), rgba(255,90,170,.85)); }
        .x { background: none; color: rgba(233,220,255,.6); font-size: 20px; }</style>
        <div class="b"><div class="t"><b>Nova a une adresse fixe</b>Plus jamais d'appli perdue : ouvre-la, puis installe-la.</div><button class="i">Ouvrir</button><button class="x" aria-label="Fermer">×</button></div>`;
      o.querySelector(".x").onclick = () => { stock.ecrire("nova-fixe-ferme", String(Date.now())); z.remove(); };
      o.querySelector(".i").onclick = async () => {
        if (!(await fileVide())) { o.querySelector(".t").innerHTML = "<b>Un instant</b>Des mémos partent encore vers le PC : réessaie dans quelques secondes."; return; }
        const u = PAGES_URL + "#a=" + encodeURIComponent(conf.appareil) + "&b=" + encodeURIComponent(NA.base);
        const w = window.open(u, "_blank", "noopener");
        if (!w) location.href = u;
      };
      document.body.appendChild(z);
    } catch (x) {}
  }
  if (!PAGES) addEventListener("load", () => setTimeout(() => NA.pret.then(proposerAdresseFixe), 7000));
})();
