// Cartable : branche le NOYAU (agent A : hors ligne + synchro entre appareils) dans l'interface de C (interface/js/pont.js).
// L'interface garde un état « photo » simple { objets, corbeille } ; ce pont le traduit en actions du noyau (sauver)
// et le reconstruit quand un autre appareil change quelque chose (surChangement).
//
// Dans interface/index.html, APRÈS js/pont.js et AVANT les scripts qui appellent Cartable.pont.charger() :
//   <script src="../noyau/noyau.js"></script>
//   <script src="../noyau/pont-interface.js"></script>
// Il se branche tout seul (sauf en ?essai=1, qui garde le bouchon de C).
// Node (tests) : const PI = require("./pont-interface.js"); PI.creer(c) -> { charger, sauver, surChangement, etat, vider }
(function (racine, fabrique) {
  const M = fabrique();
  if (typeof module === "object" && module.exports) module.exports = M;
  else racine.CartablePontInterface = M;
  if (typeof window !== "undefined") M.auto();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const K = 1000 / 840;                   // encre : interface = 840 de large (A4), noyau = 1000
  const VERS_NOYAU = { portees: "musique", ligne: "ligne", quadrille: "quadrille", blanc: "blanc" };
  const VERS_UI = { musique: "portees", ligne: "ligne", seyes: "ligne", quadrille: "quadrille", pointille: "quadrille", blanc: "blanc" };
  const MAX_PTS = 7400;                   // points par trait (le noyau en garde 30000 nombres = 7500 points)
  const arrondi = (x) => Math.round(x * 100) / 100;

  function creer(c, options) {
    options = options || {};
    const B = c.BUREAU || "bureau";
    const versN = new Map(), versU = new Map();          // id interface <-> id noyau
    const traitN = new Map(), traitU = new Map();        // id de trait interface <-> noyau
    const enCreation = new Map();                         // id interface -> promesse (photo en cours d'enregistrement)
    const urls = new Map();                               // sha -> url blob: (ou data: en Node)
    const auditeurs = new Set();
    let donnees = null, connus = new Set(), dernierT0 = 0, minuteur = null, aSauver = false, jeFais = false;

    const lier = (u, n) => { versN.set(u, n); versU.set(n, u); };
    const nId = (u) => versN.get(u) || (c.obtenir(u) ? u : null);
    const uId = (n) => versU.get(n) || n;
    const t0 = () => (dernierT0 = Math.max(Date.now(), dernierT0 + 1));

    // ---------------------------------------------------------------- noyau -> interface
    async function urlDe(img) {
      if (!img || !img.sha) return "";
      if (urls.has(img.sha)) return urls.get(img.sha);
      let u = null;
      try {
        if (typeof URL !== "undefined" && URL.createObjectURL && typeof Blob !== "undefined") u = await c.urlImage(img.sha);
        else { const b = await c.image(img.sha); if (b) u = "data:" + b.mime + ";base64," + Buffer.from(b.octets).toString("base64"); }
      } catch (e) { u = null; }
      if (u) urls.set(img.sha, u);
      return u || "";                                       // pas encore arrivée : on réessaie au prochain changement
    }
    function traitsUI(fid) {
      return c.traits(fid).map((t) => {
        const p = t.d.pts, q = [];
        for (let i = 0; i + 2 < p.length; i += 4) q.push(arrondi(p[i] / K), arrondi(p[i + 1] / K), p[i + 2]);
        const u = { id: traitU.get(t.id) || t.id, c: t.d.c, e: arrondi(t.d.e / K), p: q };
        if (t.d.outil === "surligneur") u.s = 1;            // surlignage : peint sous le texte par l'interface
        return u;
      });
    }
    async function versUI(o, z, ancien) {
      const x = ancien || {};
      const pos = o.pos || { x: 0, y: 0, a: 0 };
      const base = { id: uId(o.id), x: pos.x, y: pos.y, r: pos.a || 0, z };
      if (o.type === "classeur" || o.type === "cahier") {
        const pages = [];
        const anciennes = new Map((x.pages || []).map((p) => [p.id, p]));
        for (const e of c.enfants(o.id)) if (e.type === "feuille") pages.push(await versUI(e, 0, anciennes.get(uId(e.id))));
        (x.pages || []).forEach((p, i) => { if (enCreation.has(p.id) && !pages.includes(p)) pages.splice(Math.min(i, pages.length), 0, p); });
        // couv : l'image de couverture choisie (adresse blob:), "" = couverture d'origine en cuir
        return Object.assign(x, base, { type: "classeur", nom: o.titre || "", couleur: o.couleur || "#2f5d8a", pages, sorte: o.type, couv: await urlDe(o.ext_couv) });
      }
      const traits = traitsUI(o.id);
      const memeEncre = x.traits && x.traits.length === traits.length && x.traits.every((t, i) => t.id === traits[i].id);
      const v = (x.v || 0) + (memeEncre ? 0 : 1);
      const commun = { traits: memeEncre ? x.traits : traits, v: v || 1 };
      if (o.type === "feuille" && o.papier === "photo") {
        const img = o.image || {};
        const l = 840, h = Math.round(840 * (img.h || 1414) / (img.l || 1000));
        const avant = x.image;
        const ph = Object.assign(x, base, commun, { type: "photo", image: await urlDe(img), l, h, titre: o.titre || "" });
        if (avant !== undefined && avant !== ph.image) ph.v = (ph.v || 0) + 1;          // image remplacée (paroles refaites) : la page se repeint
        if (ph.propre !== o.propre) ph.v = (ph.v || 0) + 1;                            // les images gardées (classeur) se refont
        if (o.propre !== undefined) ph.propre = o.propre; else delete ph.propre;      // photo mise au propre (scan net ou redessinée) : l'image d'origine reste
        ph.voirPropre = !!o.ext_voirPropre;
        return ph;
      }
      const f = Object.assign(x, base, commun, { type: "feuille", papier: VERS_UI[o.papier] || "blanc", titre: o.titre || "" });
      if (o.propre !== undefined) f.propre = o.propre; else delete f.propre;
      f.voirPropre = !!o.ext_voirPropre;
      return f;
    }
    async function construire() {
      const anciens = new Map();
      if (donnees) for (const o of [...donnees.objets, ...donnees.corbeille]) anciens.set(o.id, o);
      const objets = [], corbeille = [];
      let z = 1;
      for (const o of c.bureau()) {
        if (o.type === "intercalaire") continue;
        objets.push(await versUI(o, z++, anciens.get(uId(o.id))));
      }
      for (const o of c.corbeille()) {
        if (o.type === "intercalaire") continue;
        if (o.place && o.place.p !== B && c.obtenir(o.place.p) && c.obtenir(o.place.p).supprime) continue;   // part avec son classeur
        corbeille.push(await versUI(o, 0, anciens.get(uId(o.id))));
      }
      // objets créés ici dont l'enregistrement n'est pas fini (photo) : on les garde
      for (const [u] of enCreation) { const a = anciens.get(u); if (a && !objets.includes(a)) objets.push(a); }
      if (!donnees) donnees = { objets, corbeille };
      else { donnees.objets = objets; donnees.corbeille = corbeille; }      // même objet : Cartable.pont.donnees() reste valable
      connus = new Set();
      const noter = (o) => { connus.add(o.id); (o.pages || []).forEach(noter); };
      objets.forEach(noter); corbeille.forEach(noter);
      return donnees;
    }

    // ---------------------------------------------------------------- interface -> noyau
    function octetsDeDataUrl(u) {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(u || "");
      if (!m) return null;
      const bin = m[2] ? (typeof atob === "function" ? atob(m[3]) : Buffer.from(m[3], "base64").toString("binary")) : decodeURIComponent(m[3]);
      const o = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
      return { octets: o, mime: m[1] };
    }
    function creerDansNoyau(u, dans) {                    // -> id noyau, ou null si asynchrone (photo)
      if (u.type === "classeur") {
        const id = c.creerClasseur({ titre: u.nom || "Classeur", couleur: u.couleur, pos: { x: u.x || 0, y: u.y || 0, a: u.r || 0 } });
        lier(u.id, id); return id;
      }
      if (u.type === "photo") {
        if (enCreation.has(u.id) || typeof u.image !== "string" || !u.image) return null;
        const lire = async () => {
          const b = octetsDeDataUrl(u.image);
          if (b) return b;
          if (!/^blob:/.test(u.image) || typeof fetch !== "function") throw new Error("image illisible");
          const r = await fetch(u.image);
          return { octets: new Uint8Array(await r.arrayBuffer()), mime: (r.headers.get("content-type") || "image/jpeg").split(";")[0] };
        };
        const sur = dans && dans !== B ? dans : undefined;
        const p = lire()
          .then((b) => c.ajouterImage(b.octets, { mime: b.mime, l: u.l || 840, h: u.h || 1188, titre: u.titre || "Photo", dans: sur,
                                                  pos: sur ? undefined : { x: u.x || 0, y: u.y || 0, a: u.r || 0 } }))
          .then((id) => { lier(u.id, id); enCreation.delete(u.id); urls.set(c.obtenir(id).image.sha, u.image); planifier(0); })
          .catch((e) => { enCreation.delete(u.id); console.error("[cartable] photo", e); });
        enCreation.set(u.id, p);
        return null;
      }
      const id = c.creerFeuille({ papier: VERS_NOYAU[u.papier] || "blanc", titre: u.titre, dans: dans && dans !== B ? dans : undefined,
                                  pos: dans && dans !== B ? undefined : { x: u.x || 0, y: u.y || 0, a: u.r || 0 } });
      lier(u.id, id); return id;
    }
    function versPts(p) {
      const n = Math.floor(p.length / 3), m = Math.min(n, MAX_PTS), pas = n / Math.max(1, m);
      const q = [];
      for (let j = 0; j < m; j++) {
        const i = Math.min(n - 1, Math.floor(j * pas)) * 3;
        q.push(arrondi(p[i] * K), arrondi(p[i + 1] * K), Number.isFinite(p[i + 2]) ? Math.max(0, Math.min(1, p[i + 2])) : 0.5, 0);
      }
      return q;
    }
    function accorderTraits(id, u) {
      const voulus = new Set();
      for (const t of u.traits || []) {
        let n = traitN.get(t.id) || (c.obtenir(t.id) && c.obtenir(t.id).type === "trait" ? t.id : null);
        if (!n || c.obtenir(n).supprime) {
          if (!Array.isArray(t.p) || t.p.length < 3) continue;
          n = c.ajouterTrait(id, { pts: versPts(t.p), c: t.c, e: arrondi((t.e || 2.4) * K), outil: t.s ? "surligneur" : "stylo", t0: t0() });
          traitN.set(t.id, n); traitU.set(n, t.id);
        }
        voulus.add(n);
      }
      for (const t of c.traits(id)) if (!voulus.has(t.id)) c.effacerTrait(t.id);
    }
    function accorderChamps(id, u) {
      const o = c.obtenir(id); if (!o) return;
      if (u.type === "classeur") {
        if ((u.nom || "") !== (o.titre || "")) c.renommer(id, u.nom || "");
        if (u.couleur && u.couleur !== o.couleur) c.modifier(id, { couleur: u.couleur });
      } else {
        if (u.type === "feuille" && VERS_NOYAU[u.papier] && VERS_UI[o.papier] !== u.papier) c.modifier(id, { papier: VERS_NOYAU[u.papier] });
        if (typeof u.titre === "string" && u.titre !== (o.titre || "")) c.renommer(id, u.titre);
        if (u.type === "feuille" || u.type === "photo") {
          if (!!u.voirPropre !== !!o.ext_voirPropre) c.modifier(id, { ext_voirPropre: !!u.voirPropre });
          if (u.propre !== undefined) {
            const p = JSON.parse(JSON.stringify(u.propre, (k, v) => (k === "calqueImg" ? undefined : v)));
            if (p && typeof p.texteBrut === "string") delete p.texteBrut;   // le texte va à part (recherche de Nova), pas dans le dessin
            if (JSON.stringify(p) !== JSON.stringify(o.propre)) {
              try { c.mettreAuPropre(id, p, u.propre && typeof u.propre.texteBrut === "string" ? u.propre.texteBrut : undefined); } catch (e) { console.error("[cartable] propre", e); }
            }
          }
        }
        accorderTraits(id, u);
      }
    }
    function accorderPos(id, u) {
      const o = c.obtenir(id), p = o.pos || {};
      if (Math.abs((p.x || 0) - (u.x || 0)) > 0.5 || Math.abs((p.y || 0) - (u.y || 0)) > 0.5 || Math.abs((p.a || 0) - (u.r || 0)) > 0.05)
        c.poser(id, { x: u.x || 0, y: u.y || 0, a: u.r || 0 });
    }
    // un objet de l'interface : créé si besoin, remis vivant, champs accordés -> id noyau (ou null)
    function accorder(u, dans) {
      let id = nId(u.id);
      if (!id || !c.obtenir(id) || !c.obtenir(id).type) id = creerDansNoyau(u, dans);
      if (!id) return null;
      if (c.obtenir(id).supprime) c.restaurer(id);
      accorderChamps(id, u);
      if (dans === B) accorderPos(id, u);
      return id;
    }
    function sauverMaintenant() {
      clearTimeout(minuteur); minuteur = null;
      if (!donnees || !aSauver) return;
      aSauver = false;
      jeFais = true;
      try { c.transaction(() => {
        const vus = new Set();
        const surBureau = [...donnees.objets].sort((a, b) => (a.z || 0) - (b.z || 0));
        const ordre = [];
        const essai = (f) => { try { return f(); } catch (e) { console.error("[cartable] sauver", e); return null; } };
        for (const u of surBureau) {
          if (enCreation.has(u.id)) vus.add(u.id);
          const id = essai(() => accorder(u, B)); if (!id) continue;
          vus.add(u.id); ordre.push(id);
          if (u.type === "classeur") {
            const pages = [];
            for (const p of u.pages || []) {
              const pid = essai(() => accorder(p, id));
              if (pid) { pages.push(pid); vus.add(p.id); }
            }
            const actuel = c.enfants(id).filter((o) => o.type === "feuille").map((o) => o.id);
            if (pages.join() !== actuel.join()) essai(() => c.reordonnerTout(id, pages));
          }
        }
        const actuelB = c.bureau().map((o) => o.id);
        if (ordre.join() !== actuelB.filter((x) => ordre.includes(x)).join() || ordre.some((x) => !actuelB.includes(x))) essai(() => c.reordonnerTout(B, ordre));
        // corbeille : jeté ici
        for (const u of donnees.corbeille) {
          const id = nId(u.id); vus.add(u.id);
          if (id && c.obtenir(id) && !c.obtenir(id).supprime) c.jeter(id);
        }
        // disparu de l'interface sans passer par la corbeille : à la corbeille quand même (rien n'est jamais effacé)
        for (const u of connus) {
          if (vus.has(u)) continue;
          const id = nId(u);
          if (id && c.obtenir(id) && !c.obtenir(id).supprime && c.obtenir(id).type !== "trait") c.jeter(id);
        }
        connus = vus;
      }); } finally { jeFais = false; }
    }
    function planifier(ms) {
      aSauver = true;
      clearTimeout(minuteur);
      minuteur = setTimeout(sauverMaintenant, ms == null ? 120 : ms);
    }

    // ---------------------------------------------------------------- ce qui vient des autres appareils
    // (autres appareils, mais aussi Nova, annuler/refaire : tout changement que ce pont n'a pas écrit lui-même)
    let reconstruction = Promise.resolve(), attente = null, idsAttente = new Set();
    c.on("change", (ev) => {
      if (!ev || ev.origine === "chargement" || jeFais || !donnees) return;
      if (aSauver) sauverMaintenant();                     // ce qui a été fait ici d'abord : rien ne se perd
      (ev.ids || []).forEach((i) => idsAttente.add(i));
      clearTimeout(attente);
      attente = setTimeout(() => {                         // regroupe les rafales (et laisse finir l'enregistrement d'une photo)
        const touches = [...idsAttente]; idsAttente = new Set();
        reconstruction = reconstruction.then(async () => {
          if (aSauver) sauverMaintenant();
          await construire();
          const ids = [...new Set(touches.map((i) => { const o = c.obtenir(i); return uId(o && o.type === "trait" ? o.place.p : i); }))];
          for (const f of auditeurs) { try { f(donnees, ids); } catch (e) { console.error("[cartable] surChangement", e); } }
        });
      }, 16);
    });

    const textes = { "a-jour": "Synchronisé", synchro: "Synchronisation…", "hors-ligne": "Hors ligne : gardé ici", arretee: "Synchro arrêtée", "sans-synchro": "Sur cet appareil" };
    return {
      async charger() { await c.pret; return construire(); },
      idNoyau(u) { return u ? nId(u) : null; },            // id interface -> id noyau (classeur / feuille ouverts, pour Nova)
      sauver(d, quoi) { if (d && d !== donnees) donnees = d; planifier(); },
      surChangement(f) { auditeurs.add(f); return () => auditeurs.delete(f); },
      etat() { const s = c.synchro(); return { enLigne: s.etat === "a-jour", etat: s.etat, texte: textes[s.etat] || s.etat, derniere: s.derniere }; },
      // couverture d'un classeur : img = { octets, mime, l, h } ou null (couverture d'origine) -> l'adresse à afficher ("" = d'origine).
      // L'image part dans les blobs du noyau : elle suit la synchro vers les autres appareils, comme une photo.
      async couverture(uid, img) {
        if (aSauver) sauverMaintenant();                    // un classeur tout neuf est d'abord enregistré
        const id = nId(uid), o = id && c.obtenir(id);
        if (!o || (o.type !== "classeur" && o.type !== "cahier")) throw new Error("classeur inconnu");
        const u = donnees && donnees.objets.find((x) => x.id === uid);
        let champ = null, url = "";
        if (img) {
          if (!img.octets || !img.octets.length) throw new Error("image manquante");
          const mime = /^image\/(jpeg|png|webp)$/.test(img.mime) ? img.mime : "image/jpeg";
          const sha = await c.ajouterBlob(img.octets, mime);
          champ = { sha, mime, l: Math.round(img.l) || 0, h: Math.round(img.h) || 0 };
          url = await urlDe(champ);
        }
        jeFais = true;                                      // l'interface l'affiche elle-même : pas de reconstruction du bureau
        try { c.modifier(id, { ext_couv: champ }); } finally { jeFais = false; }
        if (u) u.couv = url;
        return url;
      },
      // tests et outils
      vider() { sauverMaintenant(); return c.attendreEcritures(); },
      async reconstruit() { await new Promise((r) => setTimeout(r, 40)); await reconstruction; await Promise.all([...enCreation.values()]); await reconstruction; return donnees; },
      noyau: c,
    };
  }

  let branche = null;
  function auto() {
    if (typeof window === "undefined" || branche) return branche;
    const C = window.Cartable, N = window.CartableNoyau;
    if (!C || !C.pont || !N) return null;
    if (C.pont.essai) return null;                         // banc d'essai de l'interface : on garde son bouchon
    const c = N.demarrer();
    window.cartableNoyau = c;
    branche = creer(c);
    // la mise au propre (texte par cartableReco + BelleEcriture, portées par Musique) est faite dans interface/js/pont.js
    C.pont.brancher(branche);
    window.addEventListener("pagehide", () => { try { branche.vider(); } catch (e) { /* rien */ } });
    return branche;
  }

  return { creer, auto, VERS_NOYAU, VERS_UI, K };
});
