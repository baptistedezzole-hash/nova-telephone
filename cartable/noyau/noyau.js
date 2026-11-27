// Cartable : le NOYAU (agent A). Modèle de données + CRDT + stockage hors ligne + synchro.
// Un seul fichier, sans dépendance, qui marche partout :
//   - page (Electron, téléphone) : <script src=".../noyau/noyau.js"></script>  ->  window.CartableNoyau
//   - Node (tests, processus principal Electron) : const N = require(".../noyau/noyau.js")
// L'API publique est décrite dans cartable/API.md (c'est le contrat avec l'interface et la reconnaissance).
//
// Principe de la synchro (sans conflit, hors ligne d'abord) :
//   - chaque objet (feuille, classeur, cahier, trait…) est un dictionnaire de CHAMPS ;
//   - chaque champ est un registre « le dernier écrit gagne », daté par une horloge hybride (HLC) ;
//     à date égale, l'identifiant de l'appareil départage : tous les appareils arrivent au MÊME résultat ;
//   - une opération = { id, o: objet, c: { champ: valeur }, t: date } ; l'appliquer deux fois ou dans le
//     désordre donne le même état (idempotent, commutatif) ;
//   - l'ordre des pages = un champ « place » { p: parent, r: rang } (rang fractionnaire) : une page est
//     toujours à UN seul endroit, jamais perdue ni dupliquée, même si deux appareils hors ligne réorganisent.
//   - rien n'est jamais effacé : « jeter » = corbeille (champ supprime), restaurable.
(function (racine, fabrique) {
  const N = fabrique();
  if (typeof module === "object" && module.exports) module.exports = N;
  else racine.CartableNoyau = N;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  const VERSION = 1;
  const BUREAU = "bureau";                       // la racine implicite : le bureau lui-même
  const RE_APPAREIL = /^[a-z0-9]{3,16}$/;
  const RE_ID = /^(bureau|[a-z0-9]{3,16}-[a-z0-9]{4,24})$/;
  const RE_OPID = /^[a-z0-9]{3,16}\.[a-z0-9]{6,24}$/;
  const RE_HLC = /^[0-9a-z]{9}\.[0-9a-z]{5}\.[a-z0-9]{3,16}$/;
  const RE_SHA = /^[0-9a-f]{64}$/;
  const RE_CHAMP_EXT = /^ext_[a-zA-Z0-9]{1,30}$/;
  const MAX_OP = 256 * 1024;                     // une opération (un trait d'encre très long tient dedans)
  const MAX_IMAGE = 20 * 1024 * 1024;            // une photo
  const TYPES = ["feuille", "classeur", "cahier", "trait", "intercalaire"];
  const PAPIERS = ["musique", "ligne", "seyes", "quadrille", "pointille", "blanc", "photo"];
  const OUTILS = ["stylo", "crayon", "surligneur", "feutre"];

  // ------------------------------------------------------------------ hasard, empreintes
  const cr = (typeof globalThis !== "undefined" && globalThis.crypto) ||
             (typeof require === "function" ? require("crypto").webcrypto : null);
  const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  function hasard(n) {
    const o = new Uint8Array(n); cr.getRandomValues(o);
    let s = ""; for (const x of o) s += B36[x % 36]; return s;
  }
  async function sha256(octets) {
    const d = await cr.subtle.digest("SHA-256", octets);
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function enOctets(x) {                  // Blob | ArrayBuffer | Uint8Array | Buffer -> Uint8Array
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (x && typeof x.arrayBuffer === "function") return new Uint8Array(await x.arrayBuffer());
    throw new Error("image : octets attendus (Blob, ArrayBuffer ou Uint8Array)");
  }

  // ------------------------------------------------------------------ horloge hybride (HLC)
  // code = ms(9 car. base 36).compteur(5).appareil : se compare comme une chaîne.
  function codeHLC(ms, c, app) { return ms.toString(36).padStart(9, "0") + "." + c.toString(36).padStart(5, "0") + "." + app; }
  function lireHLC(h) {
    if (typeof h !== "string" || !RE_HLC.test(h)) return null;
    const [a, b, app] = h.split(".");
    return { ms: parseInt(a, 36), c: parseInt(b, 36), app };
  }
  function Horloge(appareil, maintenant) {
    let ms = 0, c = 0;
    const now = maintenant || (() => Date.now());
    return {
      tic() { const t = now(); if (t > ms) { ms = t; c = 0; } else c++; return codeHLC(ms, c, appareil); },
      recevoir(h) {
        const p = lireHLC(h); if (!p) return;
        if (p.ms > now() + 5 * 60 * 1000) return;   // horloge d'un autre appareil très en avance : on ne la suit pas
        if (p.ms > ms) { ms = p.ms; c = p.c; } else if (p.ms === ms && p.c > c) c = p.c;
      },
      etat: () => ({ ms, c }),
      restaurer(e) { if (e && e.ms > ms) { ms = e.ms; c = e.c || 0; } },
    };
  }

  // ------------------------------------------------------------------ rangs fractionnaires
  // milieu(a, b) : une chaîne strictement entre a et b (b = null : pas de borne haute). Jamais de « 0 » final,
  // donc il existe toujours une place entre deux rangs ; un suffixe au hasard sépare deux appareils qui
  // insèrent au même endroit en même temps.
  function milieu(a, b) {
    a = a || ""; if (b !== null && b !== undefined && b <= a) b = null;
    let i = 0, res = "";
    for (;;) {
      const da = i < a.length ? B36.indexOf(a[i]) : 0;
      const db = (b !== null && b !== undefined) ? (i < b.length ? B36.indexOf(b[i]) : 36) : 36;
      if (da === db) { res += B36[da]; i++; continue; }
      const m = Math.floor((da + db) / 2);
      if (m > da) return res + B36[m];
      res += B36[da]; i++; b = null;
    }
  }
  function rangEntre(a, b) { return milieu(a, b) + hasard(1).replace("0", "h") + hasard(1).replace("0", "k"); }

  // ------------------------------------------------------------------ validation des champs
  const estNombre = (x) => typeof x === "number" && Number.isFinite(x);
  const estTexte = (x, n) => typeof x === "string" && x.length <= n;
  function tailleJSON(v) { try { return JSON.stringify(v).length; } catch (e) { return Infinity; } }
  // renvoie la valeur nettoyée, ou undefined si invalide (le champ est alors ignoré, partout pareil)
  function validerChamp(type, nom, v) {
    if (v === null) return null;                                  // null = champ effacé
    switch (nom) {
      case "type": return TYPES.includes(v) ? v : undefined;
      case "place":
        return v && typeof v === "object" && typeof v.p === "string" && RE_ID.test(v.p) &&
               typeof v.r === "string" && /^[0-9a-z]{1,200}$/.test(v.r) ? { p: v.p, r: v.r } : undefined;
      case "pos":
        if (!v || typeof v !== "object" || !estNombre(v.x) || !estNombre(v.y)) return undefined;
        return { x: v.x, y: v.y, a: estNombre(v.a) ? v.a : 0, s: estNombre(v.s) && v.s > 0 && v.s < 20 ? v.s : 1 };
      case "titre": return estTexte(v, 200) ? v : undefined;
      case "papier": return PAPIERS.includes(v) ? v : undefined;
      case "couleur": return estTexte(v, 32) && /^[#a-zA-Z0-9(),. %-]*$/.test(v) ? v : undefined;
      case "format":
        return v && estNombre(v.l) && estNombre(v.h) && v.l > 0 && v.h > 0 && v.l < 5000 && v.h < 5000 ? { l: v.l, h: v.h } : undefined;
      case "image":
        return v && RE_SHA.test(v.sha) && estNombre(v.l) && estNombre(v.h) && estTexte(v.mime || "", 40) &&
               /^image\/[a-z0-9.+-]+$/.test(v.mime || "image/jpeg") ? { sha: v.sha, l: v.l, h: v.h, mime: v.mime || "image/jpeg" } : undefined;
      case "d":                                                    // le dessin d'un trait (immuable)
        if (type !== "trait" || !v || !Array.isArray(v.pts) || v.pts.length > 30000 || !v.pts.every(estNombre)) return undefined;
        return { pts: v.pts, c: estTexte(v.c || "", 32) ? (v.c || "#1b1b1f") : "#1b1b1f",
                 e: estNombre(v.e) && v.e > 0 && v.e < 200 ? v.e : 2, outil: OUTILS.includes(v.outil) ? v.outil : "stylo",
                 t0: estNombre(v.t0) ? v.t0 : 0 };
      case "propre": return tailleJSON(v) <= 128 * 1024 ? v : undefined;   // le rendu « au propre » (agent B), libre
      case "texte": return estTexte(v, 100000) ? v : undefined;          // texte reconnu (recherche, Nova)
      case "supprime": return v === true || v === false ? v : undefined;
      case "cree": return estNombre(v) ? v : undefined;
      case "par": return estTexte(v, 16) ? v : undefined;
      default:
        if (RE_CHAMP_EXT.test(nom)) return tailleJSON(v) <= 32 * 1024 ? v : undefined;   // champs libres (interface)
        return undefined;
    }
  }
  function validerOp(op) {
    if (!op || typeof op !== "object") return "pas un objet";
    if (typeof op.id !== "string" || !RE_OPID.test(op.id)) return "id";
    if (typeof op.o !== "string" || !RE_ID.test(op.o) || op.o === BUREAU) return "objet";
    if (!lireHLC(op.t)) return "date";
    if (!op.c || typeof op.c !== "object" || Array.isArray(op.c) || !Object.keys(op.c).length) return "champs";
    if (tailleJSON(op) > MAX_OP) return "trop gros";
    return null;
  }

  // ------------------------------------------------------------------ stockages
  // Interface commune (tout est asynchrone) :
  //   ouvrir(), toutesOps() -> [op], ajouterOps([op]), enAttente() -> [op] (pas encore reçues par le serveur),
  //   marquerEnvoyees([id]), meta(cle) / metaPoser(cle, val), blobPoser(sha, octets, mime), blob(sha) -> {octets, mime}|null,
  //   blobsListe() -> [sha]
  function stockageMemoire() {
    const ops = new Map(), attente = new Set(), meta = new Map(), blobs = new Map();
    return {
      nom: "memoire",
      async ouvrir() {},
      async toutesOps() { return [...ops.values()]; },
      async ajouterOps(l, locales) { for (const o of l) { ops.set(o.id, o); if (locales) attente.add(o.id); } },
      async enAttente() { return [...attente].map((i) => ops.get(i)).filter(Boolean); },
      async marquerEnvoyees(ids) { for (const i of ids) attente.delete(i); },
      async meta(k) { return meta.has(k) ? JSON.parse(meta.get(k)) : undefined; },
      async metaPoser(k, v) { meta.set(k, JSON.stringify(v)); },
      async blobPoser(sha, octets, mime) { blobs.set(sha, { octets, mime }); },
      async blob(sha) { return blobs.get(sha) || null; },
      async blobsListe() { return [...blobs.keys()]; },
      fermer() {},
    };
  }

  function stockageIndexedDB(nomBase) {
    const NOM = nomBase || "cartable";
    let db = null;
    const req = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const tx = (magasins, mode, fn) => new Promise((ok, ko) => {
      const t = db.transaction(magasins, mode); let res;
      t.oncomplete = () => ok(res); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
      res = fn(t);
    });
    return {
      nom: "indexeddb",
      async ouvrir() {
        if (db) return;
        const r = indexedDB.open(NOM, 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore("ops", { keyPath: "id" });
          d.createObjectStore("attente");
          d.createObjectStore("meta");
          d.createObjectStore("blobs");
        };
        db = await req(r);
        // demande au navigateur de ne pas effacer les données en cas de manque de place
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* rien */ }
      },
      async toutesOps() { let l; await tx(["ops"], "readonly", (t) => { req(t.objectStore("ops").getAll()).then((x) => { l = x; }); }); return l; },
      async ajouterOps(l, locales) {
        await tx(["ops", "attente"], "readwrite", (t) => {
          const s = t.objectStore("ops"), a = t.objectStore("attente");
          for (const o of l) { s.put(o); if (locales) a.put(1, o.id); }
        });
      },
      async enAttente() {
        let l = [];
        await tx(["ops", "attente"], "readonly", (t) => {
          req(t.objectStore("attente").getAllKeys()).then((ids) => {
            const s = t.objectStore("ops");
            for (const i of ids) req(s.get(i)).then((o) => { if (o) l.push(o); });
          });
        });
        return l;
      },
      async marquerEnvoyees(ids) { await tx(["attente"], "readwrite", (t) => { const a = t.objectStore("attente"); for (const i of ids) a.delete(i); }); },
      async meta(k) { let v; await tx(["meta"], "readonly", (t) => { req(t.objectStore("meta").get(k)).then((x) => { v = x; }); }); return v; },
      async metaPoser(k, v) { await tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put(v, k); }); },
      async blobPoser(sha, octets, mime) { await tx(["blobs"], "readwrite", (t) => { t.objectStore("blobs").put({ octets, mime }, sha); }); },
      async blob(sha) { let v = null; await tx(["blobs"], "readonly", (t) => { req(t.objectStore("blobs").get(sha)).then((x) => { v = x || null; }); }); return v; },
      async blobsListe() { let l; await tx(["blobs"], "readonly", (t) => { req(t.objectStore("blobs").getAllKeys()).then((x) => { l = x; }); }); return l; },
      fermer() { if (db) db.close(); db = null; },
    };
  }

  // ------------------------------------------------------------------ outils texte (recherche par la voix)
  function plat(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // ------------------------------------------------------------------ le Cartable (état + actions)
  function Cartable(options) {
    options = options || {};
    const stockage = options.stockage || stockageMemoire();
    const ecouteurs = { change: new Set(), synchro: new Set() };
    const objets = new Map();          // id -> objet (valeurs)       NE PAS MODIFIER depuis l'extérieur
    const dates = new Map();           // id -> { champ: hlc }
    const enfantsDe = new Map();       // parent -> Set(id)           (index, recalculé à chaque changement de place)
    const traitsDe = new Map();        // feuille -> Set(id trait)
    let appareil = null, horloge = null, ouvert = false;
    let lot = null;                    // transaction en cours : { ops, ids, annul }
    const annulables = [], refaisables = [];
    let ecritures = Promise.resolve();
    let synchro = null;

    const emettre = (nom, ...args) => { for (const f of ecouteurs[nom]) { try { f(...args); } catch (e) { console.error("[cartable]", e); } } };

    function indexer(id, avant, apres) {
      const pa = avant && avant.p, pb = apres && apres.p;
      if (pa === pb) return;
      const type = objets.get(id) && objets.get(id).type;
      const table = type === "trait" ? traitsDe : enfantsDe;
      if (pa && table.has(pa)) table.get(pa).delete(id);
      if (pb) { if (!table.has(pb)) table.set(pb, new Set()); table.get(pb).add(id); }
    }

    // applique une opération (locale ou distante) ; renvoie true si quelque chose a changé
    function appliquer(op, touches) {
      if (validerOp(op)) return false;
      let o = objets.get(op.o), d = dates.get(op.o), change = false;
      if (!o) { o = { id: op.o }; d = {}; objets.set(op.o, o); dates.set(op.o, d); }
      // le type d'abord (la validation des autres champs en dépend)
      const noms = Object.keys(op.c).sort((x, y) => (x === "type" ? -1 : y === "type" ? 1 : 0));
      for (const nom of noms) {
        const v = validerChamp(nom === "type" ? null : (o.type || op.c.type), nom, op.c[nom]);
        if (v === undefined) continue;
        if (d[nom] && d[nom] >= op.t) continue;                 // une écriture plus récente est déjà là
        if (nom === "type" && o.type && o.type !== v) continue; // le type ne change jamais
        if (nom === "d" && o.d) continue;                        // un trait ne change jamais de dessin
        const avant = o[nom];
        d[nom] = op.t;
        if (v === null) delete o[nom]; else o[nom] = v;
        if (nom === "place") indexer(op.o, avant, v);
        change = true;
      }
      if (change && touches) {
        touches.add(op.o);
        if (o.type === "trait" && o.place) touches.add(o.place.p);
      }
      return change;
    }

    function nouvelId() { return appareil + "-" + Date.now().toString(36) + hasard(6); }

    // écrit des champs (localement) : une opération, appliquée tout de suite, enregistrée et envoyée plus tard
    function ecrire(id, champs, pasAnnulable) {
      if (!ouvert) throw new Error("cartable pas encore prêt (attends cartable.pret)");
      const o = objets.get(id);
      const avant = {};
      for (const k of Object.keys(champs)) avant[k] = o && k in o ? clone(o[k]) : null;
      const op = { id: appareil + "." + Date.now().toString(36) + hasard(8), o: id, c: champs, t: horloge.tic() };
      const err = validerOp(op); if (err) throw new Error("opération refusée : " + err);
      const enCours = lot || { ops: [], ids: new Set(), annul: [] };
      appliquer(op, enCours.ids);
      enCours.ops.push(op);
      if (!pasAnnulable) enCours.annul.push({ id, avant });
      if (!lot) terminerLot(enCours);
      return op;
    }
    function clone(v) { return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; }

    function terminerLot(l, pasHistorique) {
      if (!l.ops.length) return;
      const ops = l.ops;
      ecritures = ecritures.then(() => stockage.ajouterOps(ops, true)).catch((e) => console.error("[cartable] stockage", e));
      if (l.annul.length && !pasHistorique) { annulables.push(l.annul); if (annulables.length > 200) annulables.shift(); refaisables.length = 0; }
      if (l.ids.size) emettre("change", { ids: [...l.ids], origine: "local" });
      if (synchro) synchro.reveiller();
    }

    function transaction(fn) {
      if (lot) return fn();
      lot = { ops: [], ids: new Set(), annul: [] };
      let r;
      try { r = fn(); } finally { const l = lot; lot = null; terminerLot(l); }
      return r;
    }

    function rejouer(pile, autre) {
      const etapes = pile.pop(); if (!etapes) return false;
      lot = { ops: [], ids: new Set(), annul: [] };
      const inverse = [];
      try {
        for (const { id, avant } of [...etapes].reverse()) {
          const o = objets.get(id) || {};
          const maintenant = {};
          for (const k of Object.keys(avant)) maintenant[k] = k in o ? clone(o[k]) : null;
          inverse.push({ id, avant: maintenant });
          ecrire(id, avant, true);
        }
      } finally { const l = lot; lot = null; terminerLot(l, true); }
      autre.push(inverse);
      return true;
    }

    // ---- lecture
    const vivant = (o) => o && o.type && !o.supprime;
    function trierPlace(l) {
      return l.sort((a, b) => (a.place.r < b.place.r ? -1 : a.place.r > b.place.r ? 1 : a.id < b.id ? -1 : 1));
    }
    function enfants(parent, opts) {
      const avecCorbeille = opts && opts.corbeille;
      const s = enfantsDe.get(parent || BUREAU);
      const l = s ? [...s].map((i) => objets.get(i)).filter((o) => o && o.type && o.place && (avecCorbeille || !o.supprime)) : [];
      // objets dont le parent n'existe pas (encore) ou est à la corbeille : ils restent visibles sur le bureau
      if ((parent || BUREAU) === BUREAU) {
        for (const [p, ids] of enfantsDe) {
          if (p === BUREAU) continue;
          const po = objets.get(p);
          if (po && po.type) continue;            // parent connu (même à la corbeille : ses pages partent avec lui)
          for (const i of ids) { const o = objets.get(i); if (o && o.type && (avecCorbeille || !o.supprime)) l.push(o); }
        }
      }
      return trierPlace(l);
    }
    function traits(feuille) {
      const s = traitsDe.get(feuille);
      return s ? [...s].map((i) => objets.get(i)).filter((o) => vivant(o) && o.d).sort((a, b) => (a.d.t0 - b.d.t0) || (a.id < b.id ? -1 : 1)) : [];
    }
    function rangFin(parent) {
      const l = enfants(parent, { corbeille: true });
      return rangEntre(l.length ? l[l.length - 1].place.r : "", null);
    }
    function rangA(parent, index, sauf) {
      const l = enfants(parent).filter((o) => o.id !== sauf);
      const i = Math.max(0, Math.min(index == null ? l.length : index, l.length));
      return rangEntre(i > 0 ? l[i - 1].place.r : "", i < l.length ? l[i].place.r : null);
    }
    function verifierParent(type, parent) {
      if (parent === BUREAU) return;
      const p = objets.get(parent);
      if (!vivant(p)) throw new Error("rangement : « " + parent + " » n'existe pas");
      if (type === "trait" ? p.type !== "feuille" : !["classeur", "cahier", "intercalaire"].includes(p.type) && type !== "intercalaire")
        throw new Error("rangement : impossible de mettre un(e) " + type + " dans un(e) " + p.type);
      if (["classeur", "cahier"].includes(type)) throw new Error("un classeur ou un cahier se range sur le bureau");
    }

    const api = {
      VERSION, BUREAU,
      get appareil() { return appareil; },
      pret: null,
      on(nom, f) { ecouteurs[nom].add(f); return () => ecouteurs[nom].delete(f); },
      obtenir: (id) => objets.get(id) || null,
      enfants, traits,
      bureau: () => enfants(BUREAU),
      tous(type) { return [...objets.values()].filter((o) => vivant(o) && (!type || o.type === type)); },
      corbeille() { return [...objets.values()].filter((o) => o.type && o.supprime && o.type !== "trait"); },
      chemin(id) {                                         // [bureau, classeur, …, objet]
        const l = []; let o = objets.get(id), n = 0;
        while (o && n++ < 20) { l.unshift(o.id); if (!o.place || o.place.p === BUREAU) break; o = objets.get(o.place.p); }
        return [BUREAU, ...l];
      },
      transaction,

      creerFeuille(opts) {
        opts = opts || {};
        const dans = opts.dans || BUREAU;
        verifierParent("feuille", dans);
        const id = nouvelId();
        const c = { type: "feuille", papier: opts.papier || "blanc", place: { p: dans, r: dans === BUREAU && opts.index == null ? rangFin(dans) : rangA(dans, opts.index) },
                    format: opts.format || { l: 210, h: 297 }, cree: Date.now(), par: appareil };
        if (opts.titre) c.titre = String(opts.titre).slice(0, 200);
        if (opts.pos) c.pos = opts.pos;
        if (opts.couleur) c.couleur = opts.couleur;
        if (opts.image) c.image = opts.image;
        ecrire(id, c);
        return id;
      },
      creerClasseur(opts) {
        opts = opts || {};
        const id = nouvelId();
        const c = { type: "classeur", titre: String(opts.titre || "Classeur").slice(0, 200), couleur: opts.couleur || "#2f5d8a",
                    place: { p: BUREAU, r: rangFin(BUREAU) }, cree: Date.now(), par: appareil };
        if (opts.pos) c.pos = opts.pos;
        ecrire(id, c);
        return id;
      },
      creerCahier(opts) {
        opts = opts || {};
        return transaction(() => {
          const id = nouvelId();
          const c = { type: "cahier", titre: String(opts.titre || "Cahier").slice(0, 200), couleur: opts.couleur || "#8a3b2f",
                      papier: opts.papier || "seyes", place: { p: BUREAU, r: rangFin(BUREAU) }, cree: Date.now(), par: appareil };
          if (opts.pos) c.pos = opts.pos;
          ecrire(id, c);
          const n = Math.max(0, Math.min(opts.pages == null ? 4 : opts.pages, 400));
          for (let i = 0; i < n; i++) api.creerFeuille({ dans: id, papier: c.papier });
          return id;
        });
      },
      ajouterPage(parent, opts) {
        opts = opts || {};
        const p = objets.get(parent);
        return api.creerFeuille({ ...opts, dans: parent, papier: opts.papier || (p && p.papier) || "blanc" });
      },
      creerIntercalaire(classeur, titre, index) {
        verifierParent("intercalaire", classeur);
        const id = nouvelId();
        ecrire(id, { type: "intercalaire", titre: String(titre || "").slice(0, 200), place: { p: classeur, r: rangA(classeur, index) }, cree: Date.now(), par: appareil });
        return id;
      },

      // ---- bouger
      poser(id, pos) {                                    // position sur le bureau (x, y, angle a en degrés, échelle s)
        const o = objets.get(id); if (!vivant(o)) return;
        ecrire(id, { pos: { x: pos.x, y: pos.y, a: pos.a || 0, s: pos.s || (o.pos && o.pos.s) || 1 } });
      },
      dessus(id) {                                         // passe au-dessus des autres objets du bureau
        const o = objets.get(id); if (!vivant(o) || !o.place) return;
        const l = enfants(o.place.p);
        if (l.length && l[l.length - 1].id === id) return;
        ecrire(id, { place: { p: o.place.p, r: rangFin(o.place.p) } });
      },
      ranger(id, parent, index) {                          // dans un classeur/cahier (index = position, sinon à la fin)
        const o = objets.get(id); if (!vivant(o)) throw new Error("introuvable : " + id);
        parent = parent || BUREAU;
        verifierParent(o.type, parent);
        if (parent === id || api.chemin(parent).includes(id)) throw new Error("rangement circulaire");
        const c = { place: { p: parent, r: rangA(parent, index, id) } };
        ecrire(id, c);
      },
      sortir(id, pos) {                                     // remet sur le bureau, au-dessus
        return transaction(() => { api.ranger(id, BUREAU); if (pos) api.poser(id, pos); });
      },
      reordonner(id, index) {                               // change de position dans son parent
        const o = objets.get(id); if (!vivant(o) || !o.place) return;
        api.ranger(id, o.place.p, index);
      },
      reordonnerTout(parent, ids) {                         // donne l'ordre complet (seules les pages déplacées changent)
        return transaction(() => {
          const voulu = ids.filter((i) => vivant(objets.get(i)));
          // on garde la plus longue sous-suite déjà dans l'ordre et on ne déplace que les autres : moins d'écritures,
          // et deux appareils qui réorganisent des pages différentes ne se marchent pas dessus
          const actuel = enfants(parent).map((o) => o.id);
          const pos = new Map(actuel.map((x, i) => [x, i]));
          const garde = plusLongueCroissante(voulu.map((x) => (pos.has(x) ? pos.get(x) : -1)));
          const fixes = new Set(garde.map((k) => voulu[k]));
          for (let i = 0; i < voulu.length; i++) {
            if (fixes.has(voulu[i])) continue;
            const prec = i > 0 ? objets.get(voulu[i - 1]).place.r : "";
            let suiv = null;
            for (let j = i + 1; j < voulu.length; j++) if (fixes.has(voulu[j])) { suiv = objets.get(voulu[j]).place.r; break; }
            const o = objets.get(voulu[i]);
            if (o.place.p !== parent) verifierParent(o.type, parent);
            ecrire(voulu[i], { place: { p: parent, r: rangEntre(prec, suiv) } });
          }
        });
      },
      // trie les feuilles d'un classeur : "recent" | "ancien" (date de création), "titre" (A→Z, sans titre à la fin), "origine"
      // (remet l'ordre d'avant le premier tri, gardé dans ext_ordreAvant). Rien n'est jeté. -> { change, mode, retour? }
      ordonner(parent, mode) {
        const k = objets.get(parent);
        if (!vivant(k) || !["classeur", "cahier", "intercalaire"].includes(k.type)) throw new Error("ordre : classeur introuvable");
        const feuilles = enfants(parent).filter((o) => o.type === "feuille");
        const avant = feuilles.map((o) => o.id);
        let voulu;
        if (mode === "origine") {
          const sauve = Array.isArray(k.ext_ordreAvant) ? k.ext_ordreAvant : null;
          if (!sauve) return { change: false, mode, retour: false };
          const reste = new Set(avant);
          voulu = sauve.filter((i) => reste.delete(i));
          voulu.push(...avant.filter((i) => reste.has(i)));             // ajoutées depuis : à la suite, dans l'ordre actuel
          return transaction(() => {
            if (voulu.join() !== avant.join()) api.reordonnerTout(parent, voulu);
            ecrire(parent, { ext_ordreAvant: null });
            return { change: voulu.join() !== avant.join(), mode, retour: true };
          });
        }
        const rang = new Map(avant.map((x, i) => [x, i]));
        const par = (f) => [...feuilles].sort((a, b) => f(a, b) || rang.get(a.id) - rang.get(b.id)).map((o) => o.id);
        if (mode === "recent") voulu = par((a, b) => (b.cree || 0) - (a.cree || 0));
        else if (mode === "ancien") voulu = par((a, b) => (a.cree || 0) - (b.cree || 0));
        else if (mode === "titre") {
          const t = (o) => String(o.titre || "").trim();
          voulu = par((a, b) => (!t(a) - !t(b)) || (t(a) && t(b) ? t(a).localeCompare(t(b), "fr", { numeric: true, sensitivity: "base" }) : 0));
        } else throw new Error("ordre : tri inconnu « " + mode + " »");
        return transaction(() => {
          if (!Array.isArray(k.ext_ordreAvant) && voulu.join() !== avant.join()) ecrire(parent, { ext_ordreAvant: avant.slice(0, 1200) });
          if (voulu.join() !== avant.join()) api.reordonnerTout(parent, voulu);
          return { change: voulu.join() !== avant.join(), mode };
        });
      },
      renommer(id, titre) { ecrire(id, { titre: String(titre || "").slice(0, 200) }); },
      modifier(id, champs) { return ecrire(id, champs); },   // champs libres : préfixe ext_ (voir API.md)

      // ---- encre
      ajouterTrait(feuille, d) {
        const f = objets.get(feuille);
        if (!vivant(f) || f.type !== "feuille") throw new Error("trait : feuille introuvable");
        const id = nouvelId();
        ecrire(id, { type: "trait", place: { p: feuille, r: "1" }, d: { pts: d.pts, c: d.c, e: d.e, outil: d.outil, t0: d.t0 || Date.now() } });
        return id;
      },
      effacerTrait(id) { ecrire(id, { supprime: true }); },
      mettreAuPropre(feuille, propre, texte) { const c = { propre }; if (typeof texte === "string") c.texte = texte; ecrire(feuille, c); },

      // ---- images (photos, scans)
      async ajouterImage(octets, opts) {
        opts = opts || {};
        const o = await enOctets(octets);
        if (o.length > MAX_IMAGE) throw new Error("image trop grosse (20 Mo maximum)");
        const sha = await sha256(o);
        const mime = opts.mime || "image/jpeg";
        await stockage.blobPoser(sha, o, mime);
        const blobsAEnvoyer = (await stockage.meta("blobsAEnvoyer")) || [];
        if (!blobsAEnvoyer.includes(sha)) { blobsAEnvoyer.push(sha); await stockage.metaPoser("blobsAEnvoyer", blobsAEnvoyer); }
        const l = opts.l || 1000, h = opts.h || 1414;
        return api.creerFeuille({ papier: "photo", titre: opts.titre || "Photo", dans: opts.dans, pos: opts.pos, index: opts.index,
                                  image: { sha, l, h, mime }, format: opts.format || { l: 210, h: Math.round(210 * h / l) } });
      },
      // un fichier quelconque gardé comme une image (même stockage local, même synchro) : le MusicXML d'une partition lue (agent E)
      async ajouterBlob(octets, mime) {
        const o = await enOctets(octets);
        if (!o.length || o.length > MAX_IMAGE) throw new Error("fichier vide ou trop gros (20 Mo maximum)");
        const sha = await sha256(o);
        await stockage.blobPoser(sha, o, mime || "image/vnd.cartable.partition");
        const blobsAEnvoyer = (await stockage.meta("blobsAEnvoyer")) || [];
        if (!blobsAEnvoyer.includes(sha)) { blobsAEnvoyer.push(sha); await stockage.metaPoser("blobsAEnvoyer", blobsAEnvoyer); }
        return sha;
      },
      async image(sha) {                                    // -> { octets: Uint8Array, mime } ou null (pas encore arrivée)
        const b = await stockage.blob(sha);
        if (b || !synchro) return b;
        return synchro.chercherBlob(sha);
      },
      async urlImage(sha) {                                 // pages seulement : une adresse blob: à mettre dans <img>
        const b = await api.image(sha); if (!b) return null;
        return URL.createObjectURL(new Blob([b.octets], { type: b.mime }));
      },

      // ---- corbeille (rien n'est jamais effacé pour de bon)
      jeter(id) { ecrire(id, { supprime: true }); },
      restaurer(id) {
        transaction(() => {
          const o = objets.get(id); if (!o) return;
          ecrire(id, { supprime: false });
          if (o.place && o.place.p !== BUREAU) { const p = objets.get(o.place.p); if (!vivant(p)) api.ranger(id, BUREAU); }
        });
      },

      // ---- annuler / refaire (local)
      annuler: () => rejouer(annulables, refaisables),
      refaire: () => rejouer(refaisables, annulables),
      peutAnnuler: () => annulables.length > 0,
      peutRefaire: () => refaisables.length > 0,

      // ---- Nova : retrouver par des mots
      trouver(mots, opts) {
        const t = opts && opts.type;
        const m = plat(mots).replace(/^(le|la|les|mon|ma|mes|un|une|du|de|des|l) /, "").replace(/^(classeur|cahier|feuille|page|partition|photo) (de |d |du )?/, "");
        let meilleur = null, score = 0;
        for (const o of objets.values()) {
          if (!vivant(o) || o.type === "trait" || (t && o.type !== t)) continue;
          const ti = plat(o.titre);
          if (!ti) continue;
          let s = 0;
          if (ti === m) s = 100; else if (ti.startsWith(m) || m.startsWith(ti)) s = 80; else if (ti.includes(m) || m.includes(ti)) s = 60;
          else { const a = new Set(m.split(" ")); const b = ti.split(" ").filter((x) => a.has(x)).length; s = b ? 30 + b * 10 : 0; }
          if (s > score || (s === score && meilleur && (o.cree || 0) > (meilleur.cree || 0))) { score = s; meilleur = o; }
        }
        return meilleur;
      },
      dernier(filtre) {                                    // le dernier objet créé (ex. « la photo » = dernière photo)
        let m = null;
        for (const o of objets.values()) if (vivant(o) && o.type !== "trait" && (!filtre || filtre(o)) && (!m || (o.cree || 0) > (m.cree || 0))) m = o;
        return m;
      },
      resume() {                                            // vue légère (sans encre) pour Nova
        const bref = (o) => ({ id: o.id, type: o.type, titre: o.titre || "", papier: o.papier, pages: ["classeur", "cahier"].includes(o.type) ? enfants(o.id).length : undefined });
        return {
          appareil, objets: objets.size,
          bureau: enfants(BUREAU).map(bref),
          classeurs: api.tous("classeur").map(bref), cahiers: api.tous("cahier").map(bref),
          synchro: synchro ? synchro.etat() : { etat: "sans-synchro" },
        };
      },

      // ---- synchro (le transport est donné par l'hôte : Electron, téléphone, tests)
      brancher(transport, reglages) {
        if (synchro) synchro.arreter();
        synchro = transport ? Synchro(api, interne, transport, reglages || {}) : null;
        if (synchro) synchro.demarrer();
        return synchro;
      },
      synchro: () => (synchro ? synchro.etat() : { etat: "sans-synchro" }),
      async fermer() { if (synchro) synchro.arreter(); await ecritures; stockage.fermer(); },
      // pour les tests et les outils
      async attendreEcritures() { await ecritures; },
      async aEnvoyer() { await ecritures; return (await stockage.enAttente()).length; },   // modifications pas encore reçues par le serveur
    };

    // accès réservé à la synchro
    const interne = {
      stockage,
      emettre,
      appliquerDistantes(ops) {
        const touches = new Set(), nouvelles = [];
        for (const op of ops) {
          if (validerOp(op)) continue;
          horloge.recevoir(op.t);
          nouvelles.push(op);
          appliquer(op, touches);
        }
        if (nouvelles.length) ecritures = ecritures.then(() => stockage.ajouterOps(nouvelles, false)).catch((e) => console.error("[cartable] stockage", e));
        if (touches.size) emettre("change", { ids: [...touches], origine: "distant" });
        return touches.size;
      },
      sauverHorloge() { return stockage.metaPoser("horloge", horloge.etat()); },
      get ecritures() { return ecritures; },
    };

    api.pret = (async () => {
      await stockage.ouvrir();
      appareil = options.appareil || (await stockage.meta("appareil"));
      if (!appareil || !RE_APPAREIL.test(appareil)) appareil = (options.prefixe || "a").replace(/[^a-z0-9]/g, "").slice(0, 4) + hasard(8);
      if ((await stockage.meta("appareil")) !== appareil) await stockage.metaPoser("appareil", appareil);
      horloge = Horloge(appareil, options.maintenant);
      horloge.restaurer(await stockage.meta("horloge"));
      const ops = await stockage.toutesOps();
      for (const op of ops) { horloge.recevoir(op.t); appliquer(op, null); }
      ouvert = true;
      emettre("change", { ids: [...objets.keys()], origine: "chargement" });
      return api;
    })();
    return api;
  }

  function plusLongueCroissante(a) {              // indices de la plus longue sous-suite strictement croissante (valeurs >= 0)
    const p = new Array(a.length), m = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] < 0) continue;
      let lo = 0, hi = m.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (a[m[mid]] < a[i]) lo = mid + 1; else hi = mid; }
      p[i] = lo > 0 ? m[lo - 1] : -1;
      m[lo] = i;
    }
    const r = []; let k = m.length ? m[m.length - 1] : -1;
    while (k >= 0) { r.unshift(k); k = p[k]; }
    return r;
  }

  // ------------------------------------------------------------------ synchro
  // transport = {
  //   pousser(ops) -> { acceptes: [id], seq }            (POST /api/cartable/ops)
  //   tirer(apres, attenteS) -> { ops: [op], seq }       (GET  /api/cartable/ops?apres=&attente=)
  //   blobEnvoyer(sha, octets, mime) -> true             (POST /api/cartable/blob/<sha>)
  //   blobRecevoir(sha) -> { octets, mime } | null       (GET  /api/cartable/blob/<sha>)
  // }  Toute erreur (réseau coupé…) = on réessaie plus tard ; rien n'est perdu (tout est d'abord en local).
  function Synchro(api, interne, transport, reglages) {
    const st = interne.stockage;
    let actif = false, etat = "hors-ligne", derniere = 0, erreur = "";
    let attenteEnvoi = null, enEnvoi = false, delai = 1000, curseur = 0;
    const attenteTirage = reglages.attente == null ? 20 : reglages.attente;
    const changerEtat = (e, err) => {
      if (e !== etat || (err || "") !== erreur) { etat = e; erreur = err || ""; interne.emettre("synchro", { etat, erreur, derniere }); }
    };
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));

    async function envoyer() {
      if (enEnvoi || !actif) return; enEnvoi = true;
      try {
        await interne.ecritures;
        for (;;) {
          const l = (await st.enAttente()).slice(0, 200);
          if (!l.length) break;
          const r = await transport.pousser(l);
          const ok = (r && r.acceptes) || [];
          const refuses = (r && r.refuses) || [];
          await st.marquerEnvoyees([...ok, ...refuses.map((x) => x.id)]);   // refusée = invalide, inutile d'insister
          if (!ok.length && !refuses.length) throw new Error("le serveur n'a rien pris");
        }
        await envoyerBlobs();
        derniere = Date.now();
        delai = 1000;
        if (etat !== "a-jour") changerEtat("a-jour");
      } catch (e) {
        changerEtat("hors-ligne", String(e && e.message || e));
        setTimeout(() => api_reveiller(), delai); delai = Math.min(delai * 2, 60000);
      } finally { enEnvoi = false; }
    }
    async function envoyerBlobs() {
      const l = (await st.meta("blobsAEnvoyer")) || [];
      for (const sha of [...l]) {
        const b = await st.blob(sha);
        if (b) await transport.blobEnvoyer(sha, b.octets, b.mime);
        const reste = ((await st.meta("blobsAEnvoyer")) || []).filter((x) => x !== sha);
        await st.metaPoser("blobsAEnvoyer", reste);
      }
    }
    async function tirer() {
      curseur = (await st.meta("curseur")) || 0;
      while (actif) {
        try {
          const r = await transport.tirer(curseur, etat === "a-jour" ? attenteTirage : 0);
          if (!actif) break;
          const ops = (r && r.ops) || [];
          if (ops.length) interne.appliquerDistantes(ops);
          if (r && typeof r.seq === "number" && r.seq >= curseur) { curseur = r.seq; await st.metaPoser("curseur", curseur); }
          await interne.sauverHorloge();
          derniere = Date.now();
          if (etat !== "a-jour") { changerEtat("a-jour"); api_reveiller(); }   // le réseau revient : on envoie ce qui attend
          delai = 1000;
          if (r && r.plus) continue;                      // il en reste : on enchaîne sans attendre
          if (!attenteTirage) await pause(reglages.intervalle || 3000);
        } catch (e) {
          changerEtat("hors-ligne", String(e && e.message || e));
          await pause(delai); delai = Math.min(delai * 2, 60000);
        }
      }
    }
    function api_reveiller() {
      if (!actif) return;
      clearTimeout(attenteEnvoi);
      attenteEnvoi = setTimeout(envoyer, reglages.regroupement == null ? 250 : reglages.regroupement);
    }
    const enCours = new Map();
    return {
      demarrer() { if (actif) return; actif = true; changerEtat("synchro"); envoyer(); tirer(); },
      arreter() { actif = false; clearTimeout(attenteEnvoi); changerEtat("arretee"); },
      reveiller: api_reveiller,
      etat: () => ({ etat, erreur, derniere, curseur }),
      async maintenant() { await envoyer(); },        // tests : force un envoi
      chercherBlob(sha) {
        if (enCours.has(sha)) return enCours.get(sha);
        const p = (async () => {
          try {
            const b = await transport.blobRecevoir(sha);
            if (!b) return null;
            const o = await enOctets(b.octets);
            if ((await sha256(o)) !== sha) return null;   // l'empreinte DOIT correspondre
            await st.blobPoser(sha, o, b.mime || "image/jpeg");
            return { octets: o, mime: b.mime || "image/jpeg" };
          } catch (e) { return null; } finally { enCours.delete(sha); }
        })();
        enCours.set(sha, p);
        return p;
      },
    };
  }

  // ------------------------------------------------------------------ transport HTTP (fetch)
  // base = "https://<tunnel du moment>" ; entetes() = en-têtes d'authentification (ex. { "X-Nova-Appareil": … }).
  // base peut être une fonction (l'adresse du tunnel change) ; fetch peut être fourni (tests).
  function transportHttp(o) {
    const f = o.fetch || ((...a) => fetch(...a));
    const base = () => (typeof o.base === "function" ? o.base() : o.base);
    const ent = async () => Object.assign({}, typeof o.entetes === "function" ? await o.entetes() : o.entetes);
    async function appel(chemin, init, attendu) {
      const b = await base(); if (!b) throw new Error("pas d'adresse de serveur");
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const minuteur = ctrl ? setTimeout(() => ctrl.abort(), (init && init.delai) || 30000) : null;
      try {
        const r = await f(b.replace(/\/$/, "") + "/api/cartable/" + chemin, Object.assign({}, init, { headers: Object.assign(await ent(), init && init.headers), signal: ctrl && ctrl.signal }));
        if (attendu === "blob" && r.status === 404) return null;
        if (!r.ok) throw new Error("serveur : " + r.status);
        return attendu === "blob" ? { octets: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("X-Cartable-Mime") || "image/jpeg" } : r.json();
      } finally { if (minuteur) clearTimeout(minuteur); }
    }
    return {
      pousser: (ops) => appel("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) }),
      tirer: (apres, attente) => appel("ops?apres=" + (apres | 0) + "&attente=" + (attente | 0), { method: "GET", delai: (attente + 15) * 1000 }),
      blobEnvoyer: (sha, octets, mime) => appel("blob/" + sha, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Cartable-Mime": mime || "image/jpeg" }, body: octets, delai: 120000 }),
      blobRecevoir: (sha) => appel("blob/" + sha, { method: "GET", delai: 120000 }, "blob"),
    };
  }

  // transport en mémoire : un « serveur » de test partagé par plusieurs Cartables (tests de conflits)
  function serveurMemoire() {
    const journal = [], vus = new Set(), blobs = new Map();
    let enLigne = true;
    const verif = () => { if (!enLigne) throw new Error("réseau coupé (test)"); };
    return {
      journal, blobs,
      couper() { enLigne = false; }, retablir() { enLigne = true; },
      transport() {
        return {
          async pousser(ops) { verif(); const acceptes = []; for (const o of ops) { if (!validerOp(o)) { if (!vus.has(o.id)) { vus.add(o.id); journal.push(o); } acceptes.push(o.id); } } return { acceptes, seq: journal.length }; },
          async tirer(apres) { verif(); const l = journal.slice(apres, apres + 500); return { ops: l, seq: apres + l.length, plus: apres + l.length < journal.length }; },
          async blobEnvoyer(sha, octets, mime) { verif(); blobs.set(sha, { octets, mime }); return true; },
          async blobRecevoir(sha) { verif(); return blobs.get(sha) || null; },
        };
      },
    };
  }

  // ------------------------------------------------------------------ démarrage automatique selon l'endroit
  // - Electron (preload « cartableHote ») : IndexedDB + transport IPC vers le processus principal
  // - téléphone (page github.io, même origine que l'appli Nova) : IndexedDB + fetch avec la clé d'appareil
  // - ailleurs : IndexedDB, sans synchro
  function demarrer(options) {
    options = options || {};
    const hote = typeof window !== "undefined" ? window.cartableHote : null;
    const stockage = options.stockage || (typeof indexedDB !== "undefined" ? stockageIndexedDB() : stockageMemoire());
    const c = Cartable({ stockage, prefixe: options.prefixe || (hote && hote.prefixe) || "t" });
    c.pret.then(() => {
      let t = options.transport;
      if (t === undefined && hote && hote.transport) t = hote.transport;
      if (t === undefined && options.base) t = transportHttp({ base: options.base, entetes: options.entetes });
      if (t) c.brancher(t, options.reglages);
      if (hote && hote.surCommande) hote.surCommande((cmd) => executerCommande(c, cmd));
      if (hote && hote.publierResume) {
        let minuteur = null;
        const publier = () => { clearTimeout(minuteur); minuteur = setTimeout(() => { try { hote.publierResume(c.resume()); } catch (e) { /* rien */ } }, 800); };
        c.on("change", publier); c.on("synchro", publier); publier();
      }
    });
    return c;
  }

  // ------------------------------------------------------------------ commandes de Nova (outils/cartable.py)
  // reçues par l'hôte Electron ; l'interface peut écouter « nova » pour ouvrir/montrer (c.on n'existe que pour change/synchro :
  // l'interface s'abonne avec CartableNoyau.surNova(f)).
  const auditeursNova = new Set();
  function surNova(f) { auditeursNova.add(f); return () => auditeursNova.delete(f); }
  // ce que l'interface a sous les yeux : () => { classeur: id noyau | null, feuille: id noyau | null }
  // (« rajoute une feuille » sans nom = dans le classeur ouvert ; « fais-la au propre » = la feuille ouverte)
  let contexteNova = null;
  function fixerContexteNova(f) { contexteNova = typeof f === "function" ? f : null; }
  const vuNova = () => { try { return (contexteNova && contexteNova()) || {}; } catch (e) { return {}; } };
  // la mise au propre d'une photo donnée par Nova : la transcription (éléments à dessiner, vérifiés) ou, sans elle, le scan net
  // la partition lue automatiquement : { sha (blob du MusicXML), mesures, notes, confiance 0..1, verif { etat, corrections, fautes }, titre } -> champ `propre.partition`
  function partitionInfo(sha, i) {
    i = i && typeof i === "object" ? i : {};
    const nb = (v, max) => (typeof v === "number" && isFinite(v) && v >= 0 && v <= max ? Math.round(v * 1000) / 1000 : undefined);
    const tx = (v, n) => (typeof v === "string" ? v.replace(/[\x00-\x1f]/g, " ").slice(0, n) : undefined);
    const v = i.verif && typeof i.verif === "object" ? i.verif : {};
    const r = { sha, mime: "image/vnd.cartable.partition", mesures: nb(i.mesures, 5000), notes: nb(i.notes, 100000), confiance: nb(i.confiance, 1), moteur: tx(i.moteur, 40), titre: tx(i.titre, 120), lu: Date.now(),
      verif: { etat: ["verifie", "attente", "sautee"].includes(v.etat) ? v.etat : undefined, corrections: nb(v.corrections, 5000) } };
    if (["morceau", "exercices"].includes(i.mode)) r.mode = i.mode;
    if (Array.isArray(i.sections)) r.sections = i.sections.slice(0, 200).map((x) => (x && typeof x === "object" && nb(x.a, 5000) !== undefined && nb(x.b, 5000) !== undefined
      ? { n: nb(x.n, 500), a: nb(x.a, 5000), b: nb(x.b, 5000), titre: tx(x.titre, 80) || "" } : null)).filter(Boolean);
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    for (const k of Object.keys(r.verif)) if (r.verif[k] === undefined) delete r.verif[k];
    return r;
  }
  function propreDeNova(cmd) {
    const t = cmd.transcription;
    if (t && typeof t === "object" && Array.isArray(t.elements)) {
      if (t.elements.length > 2000 || !t.elements.every((e) => e && typeof e === "object" && typeof e.t === "string")) throw new Error("transcription invalide");
      const pr = { v: 2, n: 0, elements: t.elements };
      if (t.portees && typeof t.portees === "object") pr.portees = t.portees;
      if (JSON.stringify(pr).length > 120 * 1024) throw new Error("transcription trop grosse");
      return pr;
    }
    return cmd.propre ? { v: 2, n: 0, scan: true } : null;
  }
  async function executerCommande(c, cmd) {
    await c.pret;
    const r = { ok: true };
    const trouverOuErreur = (mots, type) => { const o = c.trouver(mots, { type }); if (!o) throw new Error("je ne trouve pas « " + mots + " »"); return o; };
    // créé à la voix : posé sur une place libre près du milieu du bureau (monde de l'interface 2400 x 1500), jamais en (0,0)
    const placeLibre = () => {
      const pris = c.enfants(BUREAU).map((o) => o.pos).filter(Boolean);
      for (let i = 0; i < 200; i++) {
        const a = i * 2.4, rr = 46 * Math.sqrt(i);
        const x = Math.round(Math.min(2280, Math.max(120, 1200 + Math.cos(a) * rr * 1.5))), y = Math.round(Math.min(1350, Math.max(150, 660 + Math.sin(a) * rr)));
        if (pris.every((p) => Math.abs(p.x - x) >= 215 || Math.abs(p.y - y) >= 270)) return { x, y, a: Math.round((Math.random() - 0.5) * 8) };
      }
      return { x: 1200 + pris.length * 40 % 800, y: 660, a: 0 };
    };
    // une page rangée, désignée à la voix : « la page 3 du classeur Solfège », « la dernière page de Solfège » (pages sans titre comprises)
    const trouverPage = (mots) => {
      const m = plat(mots), NOM = "(?:(?:du|de|dans|d) )?(?:le |la |mon |ma )?(?:classeur |cahier )?(?:de |d |du )?(.+)";
      const RANGS = { premiere: 1, deuxieme: 2, seconde: 2, troisieme: 3, quatrieme: 4, cinquieme: 5, derniere: -1, "avant derniere": -2 };
      let rang = 0, nom = "";
      let x = m.match(new RegExp("^(?:la |ma |cette )?(?:page|feuille) (?:numero |n )?([0-9]{1,4}) " + NOM + "$"));
      if (x) { rang = Number(x[1]); nom = x[2]; }
      else if ((x = m.match(new RegExp("^(?:la |ma |l )?(avant derniere|premiere|deuxieme|seconde|troisieme|quatrieme|cinquieme|derniere) (?:page|feuille|photo|partition) " + NOM + "$")))) { rang = RANGS[x[1]]; nom = x[2]; }
      if (!rang || !nom) return null;
      const k = c.trouver(nom, { type: "classeur" }) || c.trouver(nom, { type: "cahier" });
      if (!k) return null;                                    // pas un classeur : c'est peut-être le titre d'une page
      const pages = c.enfants(k.id).filter((o) => o.type === "feuille");
      const o = pages[rang > 0 ? rang - 1 : pages.length + rang];
      if (!o) throw new Error(pages.length ? "« " + (k.titre || k.type) + " » n'a que " + pages.length + " page" + (pages.length > 1 ? "s" : "") : "« " + (k.titre || k.type) + " » est vide");
      return o;
    };
    const rangee = (o) => { const p = o.place && o.place.p !== BUREAU ? c.obtenir(o.place.p) : null; return p && p.type && !p.supprime ? p : null; };
    // 26/11 : une page désignée par son identifiant exact (bouton « Lire comme partition », partition-depuis)
    const parId = (q) => { if (typeof q !== "string" || !/^[a-z0-9]{4,20}-[a-z0-9]{4,40}$/.test(q)) return null; const o = c.obtenir(q); return o && o.type && !o.supprime ? o : null; };
    const enBase64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return typeof btoa === "function" ? btoa(s) : Buffer.from(u8).toString("base64"); };
    try {
      switch (cmd && cmd.action) {
        case "creer-classeur": {                              // « crée un classeur Solfège (avec 16 feuilles) » : un seul lot
          const nf = Math.max(0, Math.min(Math.floor(Number(cmd.feuilles) || 0), 200));
          r.id = c.transaction(() => {
            const id = c.creerClasseur({ titre: cmd.titre, pos: placeLibre() });
            for (let i = 0; i < nf; i++) c.creerFeuille({ dans: id, papier: cmd.papier || "blanc" });
            return id;
          });
          r.dit = "Classeur « " + cmd.titre + " » créé" + (nf ? " avec " + nf + " feuille" + (nf > 1 ? "s" : "") : "") + "."; break;
        }
        case "creer-cahier": r.id = c.creerCahier({ titre: cmd.titre, papier: cmd.papier, pos: placeLibre() }); r.dit = "Cahier « " + cmd.titre + " » créé."; break;
        case "creer-feuille": {                               // « rajoute (16) feuille(s) (dans X) » : sans X = le classeur ouvert, sinon le bureau
          const n = Math.max(1, Math.min(Math.floor(Number(cmd.n) || 1), 200));
          const vu = vuNova();
          const k = cmd.dans ? trouverOuErreur(cmd.dans)
                  : (vu.classeur && c.obtenir(vu.classeur) && !c.obtenir(vu.classeur).supprime ? c.obtenir(vu.classeur) : null);
          if (k && !["classeur", "cahier", "intercalaire"].includes(k.type)) throw new Error("« " + (k.titre || k.type) + " » n'est pas un classeur");
          const papier = cmd.papier || (k && k.papier) || "blanc";
          const ids = c.transaction(() => {
            const l = [];
            for (let i = 0; i < n; i++) l.push(c.creerFeuille({ papier, titre: n === 1 ? cmd.titre : undefined, dans: k ? k.id : undefined, pos: k ? undefined : placeLibre() }));
            return l;
          });
          r.id = ids[0]; if (n > 1) r.ids = ids; if (k) r.dans = k.id;
          const nom = k ? (k.titre || k.type) : "";
          r.dit = n === 1 ? (k ? "Feuille ajoutée dans « " + nom + " »." : "Feuille créée.")
                          : n + " feuilles " + (k ? "ajoutées dans « " + nom + " »." : "posées sur le bureau.");
          break;
        }
        case "ranger": {
          const quoi = /^(la |une |ma )?(derniere )?(photo|scan)$/.test(plat(cmd.quoi)) ? c.dernier((o) => o.papier === "photo")
                     : /^(la |cette )?(derniere )?(feuille|page|partition)$/.test(plat(cmd.quoi)) ? c.dernier((o) => o.type === "feuille" && (!o.place || o.place.p === BUREAU))
                     : trouverOuErreur(cmd.quoi);
          if (!quoi) throw new Error("rien à ranger");
          const dans = trouverOuErreur(cmd.dans);
          c.ranger(quoi.id, dans.id);
          r.id = quoi.id; r.dit = "Rangé dans « " + (dans.titre || dans.type) + " »."; break;
        }
        case "ouvrir": { const o = trouverOuErreur(cmd.quoi); r.id = o.id; r.dit = "J'ouvre « " + (o.titre || o.type) + " »."; break; }
        case "renommer": { const o = trouverOuErreur(cmd.quoi); c.renommer(o.id, cmd.titre); r.id = o.id; r.dit = "Renommé."; break; }
        case "jeter": {                                       // un objet du bureau, ou une page rangée dans un classeur (elle seule part)
          const o = trouverPage(cmd.quoi) || trouverOuErreur(cmd.quoi), k = rangee(o);
          c.jeter(o.id); r.id = o.id;
          if (k) { r.de = k.id; r.dit = "Page de « " + (k.titre || k.type) + " » mise à la corbeille."; } else r.dit = "Mis à la corbeille.";
          break;
        }
        case "sortir": {                                      // « enlève la page X du classeur » : elle se pose sur le bureau, rien n'est jeté
          const o = trouverPage(cmd.quoi) || trouverOuErreur(cmd.quoi, "feuille"), k = rangee(o);
          r.id = o.id;
          if (!k) { r.dit = "« " + (o.titre || "Cette page") + " » est déjà sur le bureau."; break; }
          c.sortir(o.id, placeLibre());
          r.de = k.id; r.dit = "Page sortie de « " + (k.titre || k.type) + " » et posée sur le bureau."; break;
        }
        case "ordre": {                                       // « trie le classeur X par date / titre », « remets l'ordre d'origine », « mets la feuille Y en 2 »
          const k = c.trouver(cmd.quoi, { type: "classeur" }) || c.trouver(cmd.quoi, { type: "cahier" });
          if (!k) throw new Error("je ne trouve pas le classeur « " + cmd.quoi + " »");
          const nom = k.titre || "le classeur";
          const tri = plat(cmd.tri || "");
          r.id = k.id;
          if (tri === "deplacer") {
            const feuilles = c.enfants(k.id).filter((o) => o.type === "feuille");
            let f = null;
            const m = plat(cmd.feuille || "").match(/^(?:la |page |feuille |la page |la feuille )*([0-9]{1,4})$/);
            if (m) f = feuilles[Number(m[1]) - 1] || null;
            if (!f) { const q = plat(cmd.feuille || ""); f = feuilles.find((o) => plat(o.titre || "") === q) || feuilles.find((o) => q && plat(o.titre || "").includes(q)) || null; }
            if (!f) throw new Error("je ne trouve pas la feuille « " + cmd.feuille + " » dans « " + nom + " »");
            const pos = Math.max(1, Math.min(Math.floor(Number(cmd.position) || 1), feuilles.length));
            const ids = feuilles.map((o) => o.id).filter((i) => i !== f.id);
            ids.splice(pos - 1, 0, f.id);
            c.reordonnerTout(k.id, ids);                        // l'ordre d'avant un tri reste gardé (« ordre d'origine » le remet)
            r.feuille = f.id;
            r.dit = "« " + (f.titre || "La feuille") + " » est maintenant en position " + pos + " dans « " + nom + " ».";
            break;
          }
          const mode = { date: "recent", recent: "recent", "plus recent": "recent", ancien: "ancien", "plus ancien": "ancien", titre: "titre", nom: "titre", alphabetique: "titre", origine: "origine" }[tri];
          if (!mode) throw new Error("tri inconnu « " + (cmd.tri || "") + " » (date, ancien, titre, origine ou deplacer)");
          const res = c.ordonner(k.id, mode);
          r.dit = mode === "origine" ? (res.retour ? "Ordre d'origine remis dans « " + nom + " »." : "« " + nom + " » est déjà dans l'ordre d'origine.")
                : !res.change ? "« " + nom + " » était déjà dans cet ordre."
                : "« " + nom + " » trié " + ({ recent: "du plus récent au plus ancien", ancien: "du plus ancien au plus récent", titre: "par titre" })[mode] + ".";
          break;
        }
        case "couverture": {                                  // image de couverture d'un classeur (l'hôte a lu et vérifié l'image) ; origine = on la retire
          const o = c.trouver(cmd.quoi, { type: "classeur" }) || c.trouver(cmd.quoi, { type: "cahier" });
          if (!o) throw new Error("je ne trouve pas le classeur « " + cmd.quoi + " »");
          const nom = o.titre || "le classeur";
          if (cmd.origine) { c.modifier(o.id, { ext_couv: null }); r.dit = "Couverture d'origine remise sur « " + nom + " »."; }
          else {
            if (!cmd.octets || !cmd.octets.length) throw new Error("image manquante");
            const sha = await c.ajouterBlob(cmd.octets, cmd.mime || "image/png");
            c.modifier(o.id, { ext_couv: { sha, mime: cmd.mime || "image/png", l: cmd.l || 0, h: cmd.h || 0 } });
            r.dit = "Nouvelle couverture posée sur « " + nom + " ».";
          }
          r.id = o.id; break;
        }
        case "resume": r.resume = c.resume(); break;
        case "envoyer-telephone": case "exporter":   // l'interface rend la page courante en image (voir API.md)
          if (!auditeursNova.size) { r.ok = false; r.erreur = "rien à envoyer : l'interface n'est pas ouverte"; }
          else r.dit = "J'envoie la page.";
          break;
        case "importer": {                                    // une photo ou un scan venu de Nova : l'hôte a lu et vérifié l'image (cmd.octets)
          if (!cmd.octets || !cmd.octets.length) throw new Error("image manquante");
          let dans;
          if (cmd.dans) {
            // rangement : seulement un nom qui contient l'autre (« cours composition » = « Composition »), jamais un classeur qui partage juste un mot
            const proche = (o) => { if (!o) return null; const a = plat(o.titre), b = plat(cmd.dans); return a && b && (a.includes(b) || b.includes(a)) ? o : null; };
            const k = proche(c.trouver(cmd.dans, { type: "classeur" })) || proche(c.trouver(cmd.dans, { type: "cahier" }));
            dans = k ? k.id : c.creerClasseur({ titre: cmd.dans, pos: placeLibre() });
            if (!k) r.classeurCree = true;
          }
          // « remplace » : la même page refaite (paroles dans un autre style, autre tonalité). L'image change sur la feuille d'origine :
          // elle garde sa place, ses annotations et son surlignage. Feuille introuvable : import normal.
          if (cmd.remplace) {
            const vieux = c.trouver(cmd.remplace, { type: "feuille" });
            if (vieux && vieux.papier === "photo" && plat(vieux.titre) === plat(cmd.remplace)) {
              const mime = cmd.mime || "image/jpeg", l = cmd.l || 1000, h = cmd.h || 1414;
              const sha = await c.ajouterBlob(cmd.octets, mime);
              c.modifier(vieux.id, { image: { sha, l, h, mime }, format: { l: 210, h: Math.round(210 * h / l) }, titre: cmd.titre || vieux.titre });
              r.id = vieux.id; r.remplacee = true;
              r.dit = "« " + (cmd.titre || vieux.titre) + " » refaite, annotations gardées.";
              break;
            }
          }
          r.id = await c.ajouterImage(cmd.octets, { mime: cmd.mime, l: cmd.l, h: cmd.h, titre: cmd.titre || "Photo", dans, pos: dans ? undefined : placeLibre() });
          if (cmd.partitionOctets && cmd.partitionOctets.length) {              // partition lue par la chaîne automatique : MusicXML gardé comme blob
            const sha = await c.ajouterBlob(cmd.partitionOctets, "image/vnd.cartable.partition");
            c.mettreAuPropre(r.id, { v: 2, n: 0, scan: true, partition: partitionInfo(sha, Object.assign({ titre: cmd.titre }, cmd.partitionInfo)) }, typeof cmd.texte === "string" ? cmd.texte : undefined);
            c.modifier(r.id, { ext_voirPropre: true });
            r.dit = "Partition « " + (cmd.titre || "Partition") + " » lue" + (cmd.dans ? ", rangée dans « " + cmd.dans + " »" : "") + ", lisible et écoutable dans le Cartable.";
            break;
          }
          const pr = propreDeNova(cmd);
          if (pr) { c.mettreAuPropre(r.id, pr, typeof cmd.texte === "string" ? cmd.texte : undefined); c.modifier(r.id, { ext_voirPropre: true }); }
          r.dit = "« " + (cmd.titre || "Photo") + " » ajoutée" + (cmd.dans ? " dans « " + cmd.dans + " »" + (r.classeurCree ? " (classeur créé)" : "") : "") + (pr ? ", mise au propre, original gardé." : ".");
          break;
        }
        case "versions": {                                    // 27/11 une chanson à plusieurs vues : paroles · piano + chant · chant · piano · écouter
          // la feuille de paroles garde sa place, ses annotations et son surlignage ; les versions s'ajoutent (ou se mettent à jour) dessus
          const nom = String(cmd.quoi || cmd.titre || "").trim();
          if (!nom) throw new Error("quelle chanson ?");
          let o = parId(cmd.quoi) || c.trouver(nom, { type: "feuille" });
          if (o && (o.supprime || o.papier !== "photo" || plat(o.titre) !== plat(nom))) o = null;
          if (!o) {
            if (!cmd.octets || !cmd.octets.length) throw new Error("feuille « " + nom + " » introuvable (il faut l'image des paroles)");
            const nomK = cmd.dans || "Chant";
            const k = c.trouver(nomK, { type: "classeur" });
            const dans = k && plat(k.titre) === plat(nomK) ? k.id : c.creerClasseur({ titre: nomK, pos: placeLibre() });
            r.id = await c.ajouterImage(cmd.octets, { mime: cmd.mime, l: cmd.l, h: cmd.h, titre: cmd.titre || nom, dans });
            o = c.obtenir(r.id); r.creee = true;
          } else if (cmd.octets && cmd.octets.length) {      // paroles refaites : l'image change sur place, traits gardés
            const mime = cmd.mime || "image/png", l = cmd.l || 1000, h = cmd.h || 1414;
            const sha = await c.ajouterBlob(cmd.octets, mime);
            if (!(o.image && o.image.sha === sha)) c.modifier(o.id, { image: { sha, l, h, mime }, format: { l: 210, h: Math.round(210 * h / l) } });
          }
          r.id = o.id;
          const av = o.ext_versions && typeof o.ext_versions === "object" ? o.ext_versions : {};
          const vs = { v: 1, partitions: Object.assign({}, av.partitions || {}), ecoute: av.ecoute || null, maj: Date.now() };
          const vo = cmd.versionsOctets || {};
          for (const k of ["pianochant", "chant", "piano"]) {
            if (vo[k] && vo[k].length) vs.partitions[k] = { sha: await c.ajouterBlob(vo[k], "image/vnd.cartable.partition") };
          }
          if (cmd.ecouteOctets && cmd.ecouteOctets.length) {
            const d = +cmd.duree;
            vs.ecoute = { sha: await c.ajouterBlob(cmd.ecouteOctets, "image/vnd.cartable.audio"), type: /^audio\/[a-z0-9.+-]{1,20}$/.test(cmd.ecouteType || "") ? cmd.ecouteType : "audio/mpeg",
                          duree: isFinite(d) && d > 0 && d < 36000 ? Math.round(d * 10) / 10 : 0 };
          }
          if (!vs.ecoute) delete vs.ecoute;
          c.modifier(o.id, Object.assign({ ext_versions: vs }, cmd.titre && cmd.titre !== o.titre ? { titre: cmd.titre } : {}));
          const n = Object.keys(vs.partitions).length + (vs.ecoute ? 1 : 0);
          r.versions = Object.keys(vs.partitions).concat(vs.ecoute ? ["ecoute"] : []);
          // l'ancienne page « Titre (piano + chant) » (partition seule, d'avant les versions) : à la corbeille, jamais effacée.
          // Titre EXACT, même classeur, et seulement une partition lue : rien d'autre ne peut partir par erreur.
          if (typeof cmd.ancienne === "string" && cmd.ancienne.trim()) {
            const a = c.trouver(cmd.ancienne.trim(), { type: "feuille" }), ka = a && rangee(a), ko = rangee(o);
            if (a && a.id !== o.id && !a.supprime && plat(a.titre) === plat(cmd.ancienne) && a.propre && a.propre.partition && ka && ko && ka.id === ko.id) {
              c.jeter(a.id); r.jetee = a.titre;
            }
          }
          r.dit = "« " + (cmd.titre || o.titre || nom) + " » " + (r.creee ? "ajoutée dans « " + (cmd.dans || "Chant") + " »" : "mise à jour") + " : paroles + " + n + " version" + (n > 1 ? "s" : "") + " à choisir en haut de la feuille." + (r.jetee ? " L'ancienne page « " + r.jetee + " » est dans la corbeille du cartable." : "");
          break;
        }
        case "partition-jouer": {                             // « joue la section 3 de … » : l'interface ouvre la page et joue (surNova)
          const o = trouverOuErreur(cmd.quoi, "feuille"); r.id = o.id;
          if (!o.propre || !o.propre.partition) throw new Error("cette feuille n'est pas une partition lue");
          if (!auditeursNova.size) throw new Error("ouvre le cartable pour jouer la partition");
          r.dit = "Je joue" + (cmd.section ? " la section « " + String(cmd.section).slice(0, 40) + " »" : " la partition") + ".";
          break;
        }
        case "annonce": {                                     // 26/11 : une phrase à afficher dans le Cartable (fin d'un travail lancé d'un bouton)
          r.dit = String(cmd.texte || "").slice(0, 300);
          break;
        }
        case "feuille-info": {                                // 26/11 « Lire comme partition » : ce qu'il faut savoir d'une page (id exact ou mots) ; avecImage = la photo en base64
          const o = parId(cmd.quoi) || trouverPage(cmd.quoi) || trouverOuErreur(cmd.quoi, "feuille");
          if (o.type !== "feuille") throw new Error("« " + (o.titre || o.type) + " » n'est pas une page");
          const k = rangee(o);
          Object.assign(r, { id: o.id, titre: o.titre || "", papier: o.papier || "", partition: !!(o.propre && o.propre.partition), classeur: k ? (k.titre || "") : "",
            image: o.image && o.image.sha ? { sha: o.image.sha, mime: o.image.mime || "", l: o.image.l || 0, h: o.image.h || 0 } : null });
          if (cmd.avecImage && r.image) {
            const b = await c.image(r.image.sha);
            if (b && b.octets && b.octets.length <= 20 * 1024 * 1024) r.imageB64 = enBase64(b.octets);
          }
          break;
        }
        case "partition-maj": {                               // la vérification a corrigé le MusicXML : on remplace le blob (l'original et la photo ne bougent pas)
          const o = parId(cmd.quoi) || trouverPage(cmd.quoi) || trouverOuErreur(cmd.quoi, "feuille"); r.id = o.id;
          if (!cmd.partitionOctets || !cmd.partitionOctets.length) throw new Error("MusicXML manquant");
          // 26/11 « convertir » : une photo de partition rangée comme page simple devient une page Partition SUR PLACE
          // (même page, même classeur, annotations et transcription gardées ; la photo reste l'original d'un bouton)
          if (cmd.convertir && !(o.propre && o.propre.partition)) {
            if (o.papier !== "photo") throw new Error("seule une photo peut être lue comme partition");
            const sha = await c.ajouterBlob(cmd.partitionOctets, "image/vnd.cartable.partition");
            c.mettreAuPropre(o.id, Object.assign({}, o.propre || {}, { v: 2, n: (o.propre && o.propre.n) || 0, scan: true, partition: partitionInfo(sha, Object.assign({ titre: cmd.titre || o.titre }, cmd.partitionInfo)) }));
            c.modifier(o.id, { ext_voirPropre: true });
            r.converti = true;
            r.dit = "« " + (o.titre || "La page") + " » est devenue une partition jouable, à la même place.";
            break;
          }
          if (!o.propre || !o.propre.partition) throw new Error("cette feuille n'est pas une partition lue");
          const sha = await c.ajouterBlob(cmd.partitionOctets, "image/vnd.cartable.partition");
          const ancien = o.propre.partition;
          c.mettreAuPropre(o.id, Object.assign({}, o.propre, { partition: partitionInfo(sha, Object.assign({}, ancien, { titre: ancien.titre }, cmd.partitionInfo)) }));
          r.dit = "Partition « " + (o.titre || "") + " » mise à jour.";
          break;
        }
        case "propre": {                                      // « mets au propre … » / « remets l'original de … » (l'original n'est jamais effacé)
          const vu = vuNova(), fo = vu.feuille && c.obtenir(vu.feuille);   // « fais-la au propre » : la feuille ouverte
          const celleOuverte = !cmd.quoi || /^(la|celle ci|celle la|ca|cette (feuille|page|photo)|la (feuille|page|photo)( ouverte)?)$/.test(plat(cmd.quoi));
          if (celleOuverte && !(fo && fo.type === "feuille" && !fo.supprime)) throw new Error("ouvre d'abord la feuille à mettre au propre");
          const o = celleOuverte ? fo : trouverOuErreur(cmd.quoi, "feuille"); r.id = o.id;
          if (cmd.original) { c.modifier(o.id, { ext_voirPropre: false }); r.dit = "Je remets l'original de « " + (o.titre || "la feuille") + " »."; break; }
          const pr = propreDeNova(Object.assign({ propre: o.papier === "photo" && !(o.propre && o.propre.v === 2) }, cmd));
          if (pr) c.mettreAuPropre(o.id, pr, typeof cmd.texte === "string" ? cmd.texte : undefined);
          if (o.papier === "photo" || o.propre || pr) { c.modifier(o.id, { ext_voirPropre: true }); r.dit = "« " + (o.titre || "La feuille") + " » est au propre, l'original est gardé."; }
          else if (!auditeursNova.size) throw new Error("ouvre le cartable pour mettre cette feuille au propre");
          else { r.aReconnaitre = true; r.dit = "Je mets « " + (o.titre || "la feuille") + " » au propre."; }   // écriture au stylet : l'interface la reconnaît
          break;
        }
        default: throw new Error("commande inconnue : " + (cmd && cmd.action));
      }
    } catch (e) { r.ok = false; r.erreur = String(e && e.message || e); }
    for (const f of auditeursNova) { try { await f(cmd, r, c); } catch (e) { console.error("[cartable] nova", e); } }
    return r;
  }

  return {
    VERSION, BUREAU, TYPES, PAPIERS, OUTILS,
    Cartable, demarrer, executerCommande, surNova, fixerContexteNova,
    stockageMemoire, stockageIndexedDB,
    transportHttp, serveurMemoire,
    // outils (exposés pour les tests et le serveur)
    milieu, rangEntre, validerOp, validerChamp, codeHLC, lireHLC, sha256, plat,
  };
});
