// Cartable, interface : le pont vers le noyau (agent A) et la reconnaissance / le scanner (agent B).
// Tant que rien n'est branché, un BOUCHON garde tout dans ce navigateur et fabrique des contenus d'essai.
// Brancher le vrai : Cartable.pont.brancher({ charger, sauver, reconnaitre, scanner, surChangement, etat }).
"use strict";
(function (C) {
  const U = C.U, T = C.T;
  const P = C.pont = {};
  const CLE = "cartable-bouchon-v1";
  const ESSAI = /[?&]essai=1/.test(location.search);
  P.essai = ESSAI;
  P.bouchon = true;
  let donnees = { objets: [], corbeille: [] };
  let minuterie = 0, vrai = {};

  P.brancher = function (fonctions) { vrai = fonctions || {}; P.bouchon = !vrai.charger; };
  P.donnees = () => donnees;

  // l'état complet : { objets: [...], corbeille: [...] }
  //   feuille  : { id, type:"feuille", papier:"portees|ligne|quadrille|blanc", x, y, r, z, traits:[], v, propre, voirPropre }
  //   photo    : { id, type:"photo", image:<url>, l, h, x, y, r, z, traits:[], v }          (l, h en unités de page, 840 = largeur A4)
  //   classeur : { id, type:"classeur", nom, couleur, x, y, r, z, pages:[feuilles ou photos] }
  P.charger = async function (etroit) {
    if (vrai.charger) { donnees = await vrai.charger(); if (!donnees.corbeille) donnees.corbeille = []; return donnees; }
    if (!ESSAI) {
      try { const s = localStorage.getItem(CLE); if (s) { const d = JSON.parse(s); if (d && Array.isArray(d.objets)) { donnees = d; if (!d.corbeille) d.corbeille = []; return donnees; } } } catch (e) { /* on repart d'un bureau neuf */ }
    }
    donnees = demo(etroit);
    return donnees;
  };
  // quoi : l'objet modifié (ou rien = tout)
  P.sauver = function (quoi) {
    if (vrai.sauver) { try { vrai.sauver(donnees, quoi); } catch (e) { console.error(e); } return; }
    if (ESSAI) return;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      try { localStorage.setItem(CLE, JSON.stringify(donnees, (k, v) => (k === "calqueImg" ? undefined : v))); } catch (e) { /* stockage plein : le vrai noyau s'en chargera */ }
    }, 500);
  };
  P.etat = () => (vrai.etat ? vrai.etat() : { enLigne: false, texte: "Sur cet appareil" });
  P.surChangement = (f) => { if (vrai.surChangement) vrai.surChangement(f); };

  // ---- mettre au propre ----
  // rend { traits } | { lignes:[{x,y,h,texte}] } | { calque:<url d'image transparente à la taille de la page> }, plus n = nombre de traits couverts
  //   musique : { musique:{ portees, symboles }, garder:[indices des traits non reconnus, dessinés tels quels] }
  //   texte   : { belle:[{texte,x,yBase,taille,police,largeurMax}], texteBrut }  (reconnaissance de B)
  P.reconnaitre = async function (page) {
    const tous = page.traits || [], n = tous.length;
    // le surlignage n'est pas de l'écriture : on reconnaît l'encre seule, et il reste dessiné tel quel
    const ind = []; tous.forEach((t, i) => { if (!t.s) ind.push(i); });
    if (ind.length !== n) page = Object.assign({}, page, { traits: ind.map((i) => tous[i]) });
    let r = null;
    if (vrai.reconnaitre) r = await vrai.reconnaitre(page);
    if (!r) {
      const t0 = performance.now();
      try { r = page.papier === "portees" ? auPropreMusique(page) : await auPropreTexte(page); } catch (e) { console.error("[cartable] au propre", e); r = null; }
      if (!r) r = { traits: page.traits.map(lisser), bouchon: true };
      const reste = 420 - (performance.now() - t0); if (reste > 0) await U.attendre(reste);   // le petit temps de « magie » reste le même
    }
    r.n = n;
    if (ind.length !== n && Array.isArray(r.garder)) r.garder = r.garder.map((i) => ind[i]).filter((i) => i !== undefined);   // indices de la vraie page
    if (r.calque && !r.calqueImg) { const e = T.image(r.calque); await e.promesse; r.calqueImg = e.img; }
    return r;
  };
  const plat = (t) => { const q = []; for (let i = 0; i + 1 < t.p.length; i += 3) q.push(t.p[i], t.p[i + 1]); return q; };
  function couleurDominante(traits) {
    const m = new Map(); let best = "#1b1b26", nb = 0;
    for (const t of traits) { const v = (m.get(t.c) || 0) + t.p.length; m.set(t.c, v); if (v > nb) { nb = v; best = t.c; } }
    return best;
  }
  // les portées de la page (même géométrie que T.dessinerPapier)
  P.portees = function (page) {
    const hp = page.h || T.PAGE_H, n = Math.floor((hp - 104 - 40) / 104), r = [];
    for (let s = 0; s < n; s++) r.push({ haut: 104 + 104 * s, interligne: 11, gauche: 58 });
    return r;
  };
  function auPropreMusique(page) {
    const M = window.Musique; if (!M || !M.reconnaitre) return null;
    const portees = P.portees(page); if (!portees.length) return null;
    const res = M.reconnaitre(page.traits.map(plat), portees);
    const symboles = [], garder = new Set();
    for (const z of res.symboles || []) {
      if (z.type === "inconnu" || z.score < 0.3) { for (const i of z.traits || []) garder.add(i); continue; }
      const c = Object.assign({}, z); delete c.alternatives; delete c.traits;
      symboles.push(c);
    }
    if (!symboles.length) return null;
    return { v: 1, musique: { portees, symboles }, garder: [...garder].sort((a, b) => a - b), couleur: couleurDominante(page.traits) };
  }
  async function auPropreTexte(page) {
    const R = window.cartableReco, BE = window.BelleEcriture;
    if (!R || !R.texte || !BE) return null;
    const r = await R.texte(page.traits.map(plat), { lang: "fr" });
    if (!r || !r.ok || !(r.lignes || []).length) return null;
    const lp = page.papier === "ligne" ? { y0: 132, pas: 34 } : undefined;
    const belle = BE.mettreEnPage(r.lignes, { police: "caveat", lignesPapier: lp });
    if (!belle.length) return null;
    return { v: 1, belle, texteBrut: String(r.texte || "").slice(0, 20000), couleur: couleurDominante(page.traits) };
  }
  // les polices de la belle écriture et de la musique : chargées une fois, puis on redessine ce qui est au propre
  P.polices = (async () => {
    const base = "../reconnaissance/polices/", t = [];
    if (window.BelleEcriture) t.push(window.BelleEcriture.chargerPolices(base).catch((e) => console.warn("[cartable] polices", e)));
    if (window.Musique) t.push(window.Musique.chargerPolice(base + "Bravura.woff2").catch((e) => console.warn("[cartable] Bravura", e)));
    await Promise.all(t);
    return true;
  })();
  // bouchon : le même trait, adouci et régulier (la vraie belle écriture vient de la reconnaissance)
  function lisser(t) {
    const p = t.p, n = p.length / 3, q = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, c = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { x += p[3 * j]; y += p[3 * j + 1]; c++; }
      q.push(x / c, y / c, 0.5);
    }
    return { id: t.id, c: t.c, e: t.e, p: q };
  }

  // ---- prendre une photo ----
  // rend { image:<url>, l, h } ; le bouchon rend une photo d'essai (jamais la vraie caméra ici)
  P.scanner = async function () {
    if (vrai.scanner) return vrai.scanner();
    if (ESSAI) { await U.attendre(260); return P.photoEssai(Math.floor(Math.random() * 3)); }
    let source = null;
    try { source = await camera(); } catch (e) { console.warn("[cartable] caméra", e); source = undefined; }
    if (source === null) return null;                           // il a annulé
    if (!source) source = await choisirFichier();               // pas de caméra : une image du disque
    if (!source) return null;
    return P.traiterPhoto(source);
  };

  // la photo (image, toile ou vidéo figée) -> feuille scannée { image:<data url>, l:840, h }
  //   détection automatique ; sous 0,5 de confiance (ou options.cadrer), il place les 4 coins à la main
  P.traiterPhoto = async function (source, options) {
    options = options || {};
    const S = window.Scanner;
    if (!S) { const c = U.toile(source.naturalWidth || source.width, source.naturalHeight || source.height); c.getContext("2d").drawImage(source, 0, 0); return { image: c.toDataURL("image/jpeg", 0.9), l: 840, h: Math.round(840 * c.height / c.width) }; }
    const img = S.depuisImage(source, 2400);
    let det = { coins: null, confiance: 0 };
    try { det = S.detecter(img); } catch (e) { console.warn("[cartable] détection", e); }
    let coins = det.coins;
    if (options.cadrer || !coins || det.confiance < 0.5) {
      coins = await P.cadrage(source, coins, img.width, img.height, options);
      if (!coins) return null;
    }
    const attente = C.dire ? C.dire("Je redresse la photo…") : null;
    await U.attendre(30);                                       // laisse le message s'afficher avant le calcul
    let res;
    try { res = S.scanner(img, { coins, mode: "couleur", largeurMax: 1800 }); }
    finally { if (attente && attente.fermer) attente.fermer(); }
    const f = S.versFeuille(res, "image/jpeg", 0.9);
    return { image: f.dataUrl, l: 840, h: Math.round(840 * f.ratio), confiance: det.confiance };
  };

  // ---- la caméra : plein écran, un déclencheur ; rend une toile, null (annulé) ou undefined (pas de caméra) ----
  function camera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(undefined);
    return new Promise(async (ok) => {
      let flux;
      try { flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false }); }
      catch (e) { return ok(undefined); }
      const el = document.createElement("div");
      el.id = "camera";
      el.innerHTML = '<video playsinline muted></video><div class="guide"></div><div class="flash"></div>' +
        '<div class="bas"><button class="annuler" title="Annuler (Échap)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '<button class="declencheur" title="Prendre la photo (Espace)"><i></i></button>' +
        '<button class="fichier" title="Choisir une image"><svg viewBox="0 0 24 24"><path d="M4 6h6l2 2h8v11H4zM12 11v5M9.5 13.5L12 11l2.5 2.5"/></svg></button></div>';
      document.body.appendChild(el);
      const v = el.querySelector("video");
      v.srcObject = flux; v.play().catch(() => {});
      requestAnimationFrame(() => el.classList.add("la"));
      let fini = false;
      const finir = (r) => {
        if (fini) return; fini = true;
        removeEventListener("keydown", touche, true);
        for (const t of flux.getTracks()) t.stop();
        el.classList.remove("la"); setTimeout(() => el.remove(), 260);
        ok(r);
      };
      const declencher = () => {
        if (!v.videoWidth) return;
        const c = U.toile(v.videoWidth, v.videoHeight); c.getContext("2d").drawImage(v, 0, 0);
        el.classList.add("clic"); setTimeout(() => finir(c), 180);
      };
      const touche = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finir(null); }
        else if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); declencher(); }
      };
      addEventListener("keydown", touche, true);
      el.querySelector(".declencheur").onclick = declencher;
      el.querySelector(".annuler").onclick = () => finir(null);
      el.querySelector(".fichier").onclick = async () => { const s = await choisirFichier(); if (s) finir(s); };
    });
  }
  function choisirFichier(galerie) {                       // galerie : une image déjà rangée (pas l'appareil photo du téléphone)
    return new Promise((ok) => {
      const i = document.createElement("input");
      i.type = "file"; i.accept = "image/*"; if (!galerie) i.setAttribute("capture", "environment");
      i.onchange = () => {
        const f = i.files && i.files[0];
        if (!f || !/^image\//.test(f.type) || f.size > 40 * 1024 * 1024) return ok(null);
        const u = URL.createObjectURL(f), img = new Image();
        img.onload = () => { ok(img); setTimeout(() => URL.revokeObjectURL(u), 1000); };
        img.onerror = () => { URL.revokeObjectURL(u); ok(null); };
        img.src = u;
      };
      addEventListener("focus", () => setTimeout(() => { if (!i.files || !i.files.length) ok(null); }, 600), { once: true });
      i.click();
    });
  }

  // ---- la couverture d'un classeur (25/11) ----
  // Les propositions sont rangées sur le PC (Documents\Nova\Cartable\couvertures\<classeur>) : l'appli les donne en vignettes.
  // La page ne voit jamais de chemin : un nom de la liste, ou une image choisie ici (réduite avant d'être gardée).
  function reduireImage(src, haut) {
    const sl = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!sl || !sh) return Promise.resolve(null);
    const k = Math.min(1, haut / sh), l = Math.max(1, Math.round(sl * k)), h = Math.max(1, Math.round(sh * k));
    const c = U.toile(l, h); c.getContext("2d").drawImage(src, 0, 0, l, h);
    return new Promise((ok) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok({ octets: new Uint8Array(a), mime: "image/jpeg", l, h, url: P.bouchon ? c.toDataURL("image/jpeg", 0.85) : "" })) : ok(null)), "image/jpeg", 0.9));
  }
  P.choisirImage = () => choisirFichier(true);
  P.couverturesEssai = null;                               // banc d'essai : [{ nom, url }]
  // -> [{ nom, url, jetable }] : les propositions pour ce classeur (liste vide hors de l'appli du PC)
  P.couvertures = async function (nom) {
    if (ESSAI) return P.couverturesEssai || [];
    const h = window.cartableHote;
    if (!h || !h.couverturesListe) return [];
    try { return ((await h.couverturesListe(nom)) || []).map((x) => ({ nom: x.nom, jetable: true, url: URL.createObjectURL(new Blob([x.octets], { type: x.mime || "image/jpeg" })) })); }
    catch (e) { console.error(e); return []; }
  };
  // choix : null (couverture d'origine), { nom } (une proposition) ou { image } (une image choisie ici) -> l'adresse affichée
  P.couverture = async function (classeur, choix) {
    const h = window.cartableHote;
    let img = null;
    if (choix && choix.image) img = await reduireImage(choix.image, 1400);
    else if (choix && choix.nom && h && h.couvertureLire && !ESSAI) img = await h.couvertureLire(classeur.nom, choix.nom);
    else if (choix && choix.url && P.bouchon) img = { url: choix.url };
    if (choix && !img) throw new Error("image illisible");
    if (vrai.couverture) classeur.couv = await vrai.couverture(classeur.id, img);
    else { classeur.couv = img ? img.url : ""; P.sauver(classeur); }
    return classeur.couv;
  };

  // ---- le cadrage à la main : 4 coins à tirer sur la photo ; rend les coins (en pixels de l'image) ou null ----
  P.cadrage = function (source, coins, iw, ih, options) {
    options = options || {};
    iw = iw || source.naturalWidth || source.videoWidth || source.width;
    ih = ih || source.naturalHeight || source.videoHeight || source.height;
    const sw = source.naturalWidth || source.videoWidth || source.width, ks = iw / sw;   // l'image analysée peut être réduite
    const m = 0.08;
    const tout = [{ x: 0, y: 0 }, { x: iw, y: 0 }, { x: iw, y: ih }, { x: 0, y: ih }];
    let pts = (coins && coins.length === 4 ? coins : [{ x: iw * m, y: ih * m }, { x: iw * (1 - m), y: ih * m }, { x: iw * (1 - m), y: ih * (1 - m) }, { x: iw * m, y: ih * (1 - m) }]).map((p) => ({ x: p.x, y: p.y }));
    return new Promise((ok) => {
      const el = document.createElement("div");
      el.id = "cadrage";
      el.innerHTML = '<div class="voile"></div><div class="titre">Tire les quatre coins sur les bords de la feuille</div>' +
        '<div class="zone"><canvas></canvas><svg class="cadre" viewBox="0 0 10 10" preserveAspectRatio="none"><path class="ombre" fill-rule="evenodd"/><polygon class="bord"/></svg>' +
        '<i class="coin"></i><i class="coin"></i><i class="coin"></i><i class="coin"></i><div class="loupe"><canvas></canvas></div></div>' +
        '<div class="bas"><button class="annuler">Annuler</button><button class="tout">Toute la photo</button><button class="ok">Valider</button></div>';
      document.body.appendChild(el);
      const zone = el.querySelector(".zone"), toile = zone.querySelector("canvas"), svg = zone.querySelector("svg");
      const ombre = svg.querySelector(".ombre"), bord = svg.querySelector(".bord"), poignees = [...zone.querySelectorAll(".coin")];
      const loupe = zone.querySelector(".loupe"), cl = loupe.querySelector("canvas");
      let e = 1, ox = 0, oy = 0;
      function mise() {
        const W = innerWidth, H = innerHeight, etroit = W < 640;
        const ml = etroit ? 14 : 40, mh = etroit ? 64 : 72, mb = etroit ? 96 : 92;
        e = Math.min((W - 2 * ml) / iw, (H - mh - mb) / ih);
        const l = iw * e, h = ih * e; ox = (W - l) / 2; oy = mh + (H - mh - mb - h) / 2;
        Object.assign(zone.style, { left: ox + "px", top: oy + "px", width: l + "px", height: h + "px" });
        const d = Math.min(2, devicePixelRatio || 1);
        toile.width = Math.round(l * d); toile.height = Math.round(h * d);
        toile.getContext("2d").drawImage(source, 0, 0, toile.width, toile.height);
        svg.setAttribute("viewBox", `0 0 ${iw} ${ih}`);
        dessiner();
      }
      function dessiner() {
        const p = pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`);
        bord.setAttribute("points", p.join(" "));
        ombre.setAttribute("d", `M0 0H${iw}V${ih}H0Z M${p.join(" L")}Z`);
        poignees.forEach((g, i) => { g.style.transform = `translate3d(${(pts[i].x * e).toFixed(1)}px,${(pts[i].y * e).toFixed(1)}px,0)`; });
      }
      function voirLoupe(i) {
        const q = pts[i], R = 46, z = 2.2 * e / ks;   // un rond agrandi au-dessus du doigt, pour placer le coin juste
        cl.width = cl.height = 2 * R * Math.min(2, devicePixelRatio || 1);
        const g = cl.getContext("2d"), s = cl.width / (2 * R);
        g.setTransform(s, 0, 0, s, 0, 0); g.clearRect(0, 0, 2 * R, 2 * R);
        g.drawImage(source, R - (q.x / ks) * z, R - (q.y / ks) * z, sw * z, (source.naturalHeight || source.videoHeight || source.height) * z);
        g.strokeStyle = "#f0b65a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(R - 9, R); g.lineTo(R + 9, R); g.moveTo(R, R - 9); g.lineTo(R, R + 9); g.stroke();
        const lx = q.x * e, ly = q.y * e;
        loupe.style.transform = `translate3d(${lx.toFixed(1)}px,${(ly - R - 70 < -oy + 4 ? ly + 70 : ly - 70).toFixed(1)}px,0)`;
        loupe.classList.add("la");
      }
      poignees.forEach((g, i) => {
        g.onpointerdown = (ev) => {
          ev.preventDefault(); g.setPointerCapture(ev.pointerId); g.classList.add("prise");
          const r0 = zone.getBoundingClientRect(), dx = ev.clientX - (r0.left + pts[i].x * e), dy = ev.clientY - (r0.top + pts[i].y * e);
          const bouge = (m2) => {
            const r = zone.getBoundingClientRect();
            pts[i] = { x: U.borne((m2.clientX - dx - r.left) / e, 0, iw), y: U.borne((m2.clientY - dy - r.top) / e, 0, ih) };
            dessiner(); voirLoupe(i);
          };
          const lache = () => { g.classList.remove("prise"); loupe.classList.remove("la"); g.removeEventListener("pointermove", bouge); g.removeEventListener("pointerup", lache); g.removeEventListener("pointercancel", lache); };
          g.addEventListener("pointermove", bouge); g.addEventListener("pointerup", lache); g.addEventListener("pointercancel", lache);
          voirLoupe(i);
        };
      });
      let fini = false;
      const finir = (r) => {
        if (fini) return; fini = true;
        removeEventListener("resize", mise); removeEventListener("keydown", touche, true);
        el.classList.remove("la"); setTimeout(() => el.remove(), 240);
        ok(r);
      };
      const touche = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finir(null); }
        else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); finir(pts); }
      };
      el.querySelector(".annuler").onclick = () => finir(null);
      el.querySelector(".tout").onclick = () => { pts = tout.map((p) => ({ x: p.x, y: p.y })); el.classList.add("saute"); dessiner(); setTimeout(() => el.classList.remove("saute"), 260); };
      el.querySelector(".ok").onclick = () => finir(pts);
      addEventListener("resize", mise); addEventListener("keydown", touche, true);
      mise();
      requestAnimationFrame(() => el.classList.add("la"));
      if (options.surPret) options.surPret({ el, coins: () => pts, finir, poser: (n) => { pts = n.map((p) => ({ x: p.x, y: p.y })); dessiner(); }, loupe: voirLoupe });
    });
  };
  P.photoEssai = function (n) {
    const paysage = n === 2, L = paysage ? 848 : 600, H = paysage ? 600 : 848;
    const c = U.toile(L, H), g = c.getContext("2d");
    g.fillStyle = "#f4efe2"; g.fillRect(0, 0, L, H);
    let s = 31 + n * 17; const h = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    g.fillStyle = "#22222c"; g.strokeStyle = "#22222c";
    if (n === 0) {                                             // une partition imprimée
      g.font = "600 26px Georgia, serif"; g.textAlign = "center"; g.fillText("Étude n° 4", L / 2, 62);
      g.font = "italic 14px Georgia, serif"; g.fillText("Andante", 92, 96); g.textAlign = "left";
      for (let p = 0; p < 8; p++) {
        const y = 124 + p * 88; g.lineWidth = 1;
        for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(44, y + i * 8); g.lineTo(L - 44, y + i * 8); g.stroke(); }
        for (let m = 1; m <= 4; m++) { const x = 44 + (L - 88) * m / 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
        let x = 70;
        while (x < L - 60) {
          const d = Math.floor(h() * 9) - 1, ny = y + 32 - d * 4, plein = h() > 0.25;
          g.save(); g.translate(x, ny); g.rotate(-0.35); g.beginPath(); g.ellipse(0, 0, 5.4, 3.8, 0, 0, 7); plein ? g.fill() : (g.lineWidth = 1.6, g.stroke()); g.restore();
          g.lineWidth = 1.3; g.beginPath(); if (d < 4) { g.moveTo(x + 5, ny - 1); g.lineTo(x + 5, ny - 27); } else { g.moveTo(x - 5, ny + 1); g.lineTo(x - 5, ny + 27); } g.stroke();
          x += 20 + h() * 26;
        }
      }
    } else if (n === 1) {                                      // une page de cours imprimée
      g.font = "700 24px Georgia, serif"; g.fillText("Les cadences", 56, 78);
      g.fillStyle = "#3a3a46";
      for (let i = 0; i < 27; i++) {
        const y = 122 + i * 25; if (i % 7 === 6) continue;
        let x = 56 + (i % 7 === 0 ? 22 : 0); const fin = L - 56 - (i % 7 === 5 ? 180 * h() + 60 : 0);
        while (x < fin) { const w = 14 + h() * 52; g.fillRect(x, y, Math.min(w, fin - x), 7); x += w + 8; }
      }
    } else {                                                   // un tableau photographié
      g.fillStyle = "#2f4a3c"; g.fillRect(0, 0, L, H);
      g.strokeStyle = "rgba(240,240,232,0.86)"; g.lineWidth = 2.4; g.lineCap = "round";
      g.font = "30px 'Segoe Print', cursive"; g.fillStyle = "rgba(240,240,232,0.9)"; g.fillText("I   IV   V   I", 70, 110);
      for (let p = 0; p < 2; p++) { const y = 200 + p * 150; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(60, y + i * 14); g.lineTo(L - 60, y + i * 14 + (h() - 0.5) * 3); g.stroke(); } for (let k = 0; k < 9; k++) { g.beginPath(); g.ellipse(110 + k * 76, y + 56 - Math.floor(h() * 8) * 7, 9, 7, -0.3, 0, 7); g.fill(); } }
    }
    const o = g.createRadialGradient(L * 0.4, H * 0.35, 80, L / 2, H / 2, Math.max(L, H) * 0.75);   // la lumière inégale d'une vraie photo
    o.addColorStop(0, "rgba(255,246,220,0.05)"); o.addColorStop(1, "rgba(60,40,20,0.2)");
    g.fillStyle = o; g.fillRect(0, 0, L, H);
    return { image: c.toDataURL("image/jpeg", 0.86), l: paysage ? 1188 : 840, h: paysage ? 840 : 1188, essai: true };
  };

  // ---- contenu d'essai : une écriture manuscrite simulée ----
  function ecriture(lignes, graine, o) {
    o = o || {};
    let s = graine; const h = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const traits = [];
    for (const [x0, y, larg] of lignes) {
      let x = x0;
      while (x < x0 + larg - 20) {
        const lm = 34 + h() * 86, p = []; let px = x, phase = h() * 6;
        const pas = 4;
        for (let u = 0; u < lm; u += pas) {
          const haut = (h() > 0.86 ? 26 : 11) * (o.taille || 1);
          const yy = y - haut * (0.5 + 0.5 * Math.sin(u * 0.42 + phase)) + Math.sin(u * 0.09) * 2;
          px = x + u + Math.cos(u * 0.42 + phase) * 4;
          p.push(Math.round(px * 10) / 10, Math.round(yy * 10) / 10, Math.round((0.38 + 0.3 * Math.abs(Math.sin(u * 0.21 + phase))) * 100) / 100);
        }
        traits.push({ id: U.id("t"), c: o.couleur || "#1c2f8a", e: o.e || 2.4, p });
        x += lm + 16 + h() * 14;
      }
    }
    return traits;
  }
  function notes(nPortees, graine, couleur) {
    let s = graine; const h = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const traits = [], c = couleur || "#1b1b26";
    for (let p = 0; p < nPortees; p++) {
      const y0 = 104 + p * 104; let x = 110 + h() * 20;
      while (x < 760) {
        const d = Math.floor(h() * 10) - 1, y = y0 + 44 - d * 5.5, t = [];
        for (let a = 0; a <= 7.2; a += 0.6) t.push(Math.round((x + Math.cos(a) * 7.5 + (h() - 0.5)) * 10) / 10, Math.round((y + Math.sin(a) * 5 - Math.cos(a) * 2) * 10) / 10, 0.62);
        traits.push({ id: U.id("t"), c, e: 3.4, p: t });
        const haut = d < 4;
        traits.push({ id: U.id("t"), c, e: 2.2, p: haut ? [x + 7, y - 1, 0.5, x + 7.6, y - 18, 0.45, x + 7.2, y - 37, 0.35] : [x - 7, y + 1, 0.5, x - 7.5, y + 18, 0.45, x - 7, y + 37, 0.35] });
        if (h() > 0.8) traits.push({ id: U.id("t"), c, e: 2, p: [x + 24, y0 - 2, 0.4, x + 24.5, y0 + 20, 0.5, x + 24, y0 + 46, 0.4] });
        x += 36 + h() * 44;
      }
    }
    return traits;
  }
  P.contenu = { ecriture, notes };

  function demo(etroit) {
    const lig = (n, d) => Array.from({ length: n }, (_, i) => [130, 166 + (i + (d || 0)) * 34 * 2, 560 + ((i * 37) % 90)]);
    const feuille = (papier, traits, x, y, r, z) => ({ id: U.id("f"), type: "feuille", papier, traits: traits || [], v: 1, x, y, r, z });
    const ph = (n, x, y, r, z) => Object.assign({ id: U.id("p"), type: "photo", traits: [], v: 1, x, y, r, z }, P.photoEssai(n));
    const cx = 1200, cy = 750, e = etroit ? 0.5 : 1;
    const solfege = [
      feuille("portees", notes(5, 3)), feuille("ligne", ecriture(lig(8), 5)), ph(0), feuille("portees", notes(3, 9)),
      feuille("quadrille", ecriture([[80, 140, 420], [80, 220, 520], [80, 300, 380]], 14, { couleur: "#1b1b26" })), feuille("ligne", ecriture(lig(5), 21)), feuille("portees", notes(7, 27)),
    ];
    const harmonie = [feuille("ligne", ecriture(lig(6), 41, { couleur: "#1b1b26" })), ph(1), feuille("portees", notes(4, 33, "#1c2f8a"))];
    return {
      corbeille: [],
      objets: [
        { id: U.id("k"), type: "classeur", nom: "Solfège", couleur: "#8d2f37", x: cx - 430 * e, y: cy - 110, r: -3, z: 1, pages: solfege },
        { id: U.id("k"), type: "classeur", nom: "Harmonie", couleur: "#2e6a55", x: cx + 440 * e, y: cy + 40, r: 4, z: 2, pages: harmonie },
        feuille("portees", notes(2, 51), cx - 90 * e, cy - 60, -4, 3),
        feuille("ligne", ecriture(lig(4), 61), cx + 120 * e, cy - 150, 6, 4),
        ph(2, cx + 150 * e, cy + 150, -5, 5),
      ],
    };
  }
})(window.Cartable);
