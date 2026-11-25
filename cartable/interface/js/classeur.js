// Cartable, interface : le classeur ouvert. Des pages qui se courbent et tournent, qu'on tire du doigt ; une fouille pour tout réorganiser.
"use strict";
(function (C) {
  const U = C.U, T = C.T, S = C.sons, P = C.pont, B = C.bureau, F = C.feuille;
  const K = C.classeur = {};
  const el = document.getElementById("classeur"), q = (s) => el.querySelector(s);
  const scene = q(".scene"), livre = q(".livre"), voile = q(".voile"), stG = q(".page.gauche"), stD = q(".page.droite");
  const omG = stG.querySelector(".ombre-portee"), omD = stD.querySelector(".ombre-portee"), trG = q(".tranche.g"), trD = q(".tranche.d");
  const barre = q(".barre"), titre = q(".titre"), compte = q(".compte"), fouille = q(".fouille"), grille = q(".grille"), sortie = q(".sortie");
  // la couverture (elle pivote à l'ouverture et devient le rabat gauche) et le petit mot du classeur vide
  const couv = U.el("div", "couverture", livre), couvExt = U.el("div", "ext", couv); U.el("div", "int", couv);
  const couvNom = U.el("b", "", U.el("div", "etiq", couvExt));
  const conseil = U.el("div", "conseil", livre); conseil.textContent = "Classeur vide. Touche + pour ajouter une page.";
  const N = 10;                                            // bandes par feuillet : assez pour une belle courbe
  let k = null, kv = null, ouvert = false, anime = false, double = true, pw = 400, ph = 566, bx = 0, by = 0;
  let s = 0, vols = [], reserve = [], tourne = false, ptr = null, molette = 0;
  K.ouvert = () => ouvert;

  // ---------- les pages et les feuillets ----------
  const nb = () => k.pages.length;
  const nF = () => (double ? Math.ceil(nb() / 2) : nb());
  const maxS = () => (double ? Math.floor(nb() / 2) : Math.max(0, nb() - 1));
  const recto = (j) => (double ? k.pages[2 * j] : k.pages[j]) || null;
  const verso = (j) => (double ? k.pages[2 * j + 1] || null : null);
  function mesurer() {
    const W = innerWidth, H = innerHeight, haut = 58;
    double = W > H;
    pw = Math.floor(double ? Math.min((W - 96) / 2, (H - haut - 46) / 1.4143) : Math.min(W - 26, (H - haut - 34) / 1.4143));
    ph = Math.round(pw * 1.4143);
    bx = Math.round(double ? W / 2 - pw : (W - pw) / 2 - pw);       // téléphone : même livre, la moitié gauche hors de l'écran
    by = Math.round(haut + (H - haut - ph) / 2);
    livre.style.left = bx + "px"; livre.style.top = by + "px"; livre.style.width = 2 * pw + "px"; livre.style.height = ph + "px";
    el.style.setProperty("--pw", pw + "px"); el.style.setProperty("--ph", ph + "px");
    el.classList.toggle("simple", !double);
    for (const f of reserve) f.el.remove();
    reserve = [];
  }
  // met l'image d'une page en fond d'un élément (sans clignoter si elle n'est pas encore prête)
  function fond(e, pg, garder) {
    const cle = pg ? pg.id + ":" + (pg.v || 0) + (pg.voirPropre ? "p" : "") : "";
    if (e.__cle === cle) return;
    e.__cle = cle;
    e.classList.toggle("vide", !pg);
    if (!pg) { e.style.backgroundImage = ""; return; }
    const u = T.urlPrete(pg);
    if (u) { e.style.backgroundImage = `url(${u})`; return; }
    if (!garder) e.style.backgroundImage = "";
    T.urlPage(pg).then((url) => { if (e.__cle === cle) e.style.backgroundImage = `url(${url})`; });
  }
  function precharger() {
    const i0 = double ? 2 * s : s;
    for (let i = Math.max(0, i0 - 5); i < Math.min(nb(), i0 + 7); i++) {
      const pg = k.pages[i];
      if (!T.urlPrete(pg)) T.urlPage(pg).then((u) => { const im = new Image(); im.src = u; if (im.decode) im.decode().catch(() => {}); });
    }
  }
  function majStatiques() {
    let lo = s, hi = s;
    if (vols.length) { lo = Math.min.apply(null, vols.map((f) => f.j)); hi = Math.max.apply(null, vols.map((f) => f.j)) + 1; }
    fond(stG, double && lo > 0 ? verso(lo - 1) : null, true);
    fond(stD, hi < nF() ? recto(hi) : null, true);
    trG.style.width = U.borne(lo * 1.3, 0, 10).toFixed(1) + "px"; trD.style.width = U.borne((nF() - hi) * 1.3, 0, 10).toFixed(1) + "px";
    const n = nb();
    conseil.hidden = n > 0;
    if (!n) compte.textContent = "vide";
    else if (!double) compte.textContent = (s + 1) + " / " + n;
    else { const a = 2 * s, b = Math.min(n, 2 * s + 1); compte.textContent = (a < 1 ? "1" : b > a ? a + " – " + b : String(a)) + " / " + n; }
    q('[data-action="avant"]').disabled = s <= 0; q('[data-action="apres"]').disabled = s >= maxS();
    majBascules();
  }

  // ---------- une photo dans le classeur : « Original / Au propre » sous la page, sans l'ouvrir ----------
  const ICONES = { original: "M4 7h3l1.5-2h7L17 7h3v12H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z", propre: "M5 19L16 8M14 6l4 4M18 3v3M16.5 4.5h3M7 4v2M6 5h2M20 13v2M19 14h2" };
  const basc = [0, 1].map((i) => {
    const e = U.el("div", "bascule", el); e.hidden = true; U.el("i", "glisse", e);
    for (const [voir, nom] of [["original", "Original"], ["propre", "Au propre"]]) {
      const b = U.el("button", "", e); b.dataset.voir = voir; b.title = (voir === "propre" ? "Voir la feuille au propre" : "Voir la photo d'origine") + " (P)";
      b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONES[voir]}"/></svg>`;
      U.el("span", "", b).textContent = nom;
    }
    const x = { el: e, pg: null };
    e.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b && x.pg) basculerPage(x.pg, b.dataset.voir === "propre"); });
    return x;
  });
  let bascOccupe = false;
  const pagesVues = () => (k ? [double && s > 0 ? verso(s - 1) : null, s < nF() ? recto(s) : null] : [null, null]);
  function majBascules() {
    const vues = pagesVues(), libre = ouvert && !anime && !vols.length && fouille.hidden;
    basc.forEach((b, i) => {
      const pg = libre ? vues[i] : null, photo = !!(pg && pg.image);
      b.pg = photo ? pg : null; b.el.hidden = !photo;
      if (!photo) return;
      const pr = !!(pg.voirPropre && pg.propre);
      b.el.classList.toggle("propre", pr);
      for (const bt of b.el.querySelectorAll("button")) bt.setAttribute("aria-pressed", String((bt.dataset.voir === "propre") === pr));
      b.el.style.left = Math.round(bx + (i ? 1.5 : 0.5) * pw) + "px"; b.el.style.top = Math.round(by + ph - 8) + "px";
    });
  }
  async function basculerPage(pg, veut) {
    if (!ouvert || anime || bascOccupe || !pg || !pg.image || !C.propre) return;
    const est = !!(pg.voirPropre && pg.propre);
    if (veut === undefined) veut = !est;
    if (veut === est) return;
    bascOccupe = true;
    try {
      if (veut) { if (!C.propre.estPhoto(pg.propre)) pg.propre = { v: 2, n: 0, scan: true }; await C.propre.preparer(pg); }
      pg.voirPropre = veut; pg.v = (pg.v || 0) + 1;
      S.jouer("magie"); P.sauver(k); majBascules();
      await T.urlPage(pg);
    } catch (e) { console.error(e); }
    bascOccupe = false;
    if (ouvert && k) majStatiques();
  }
  // la touche P : la page de droite d'abord ; deux photos côte à côte changent ensemble
  K.basculerPropre = function () {
    const v = pagesVues().filter((pg) => pg && pg.image).reverse(); if (!v.length || !fouille.hidden || vols.length) return false;
    const veut = !(v[0].voirPropre && v[0].propre);
    (async () => { for (const pg of v) await basculerPage(pg, veut); })();
    return true;
  };
  K.bascules = () => basc.map((b) => (b.el.hidden ? null : { voit: b.el.classList.contains("propre") ? "propre" : "original", rect: b.el.getBoundingClientRect().toJSON() }));

  function creerFeuillet() {
    const e = U.el("div", "feuillet", livre), f = { el: e, j: 0, p: new U.Ressort(0, 140, 22), bandes: [], retard: 0, tenu: false };
    const w = pw / N;
    for (let i = 0; i < N; i++) {
      const b = U.el("div", "bande", e); b.style.width = (w + 0.6).toFixed(2) + "px";
      const r = U.el("div", "face recto", b), v = U.el("div", "face verso", b);
      r.style.backgroundSize = v.style.backgroundSize = `${pw}px ${ph}px`;
      r.style.backgroundPosition = `${(-i * w).toFixed(2)}px 0`; v.style.backgroundPosition = `${(-((N - 1 - i) * w - 0.6)).toFixed(2)}px 0`;
      f.bandes.push({ b, r, v, or: U.el("i", "", r), ov: U.el("i", "", v) });
    }
    return f;
  }
  function prendre(j, depart) {
    let f = vols.find((x) => x.j === j);
    if (f) return f;
    f = reserve.pop() || creerFeuillet();
    f.j = j; f.p.k = 140; f.p.a = 22; f.p.poser(depart); f.retard = 0; f.tenu = false;
    const r = recto(j), v = verso(j);
    for (const b of f.bandes) { fond(b.r, r); fond(b.v, v); }
    f.el.style.display = "";
    vols.push(f); dessiner(f);
    return f;
  }
  // la page se courbe : le bord qu'on tire est en avance, la reliure retient
  function dessiner(f) {
    const p = U.borne(f.p.v, 0, 1), w = pw / N, courbe = 55 * Math.sin(Math.PI * p);
    const a0 = -180 * p + courbe / 2, d = -courbe / (N - 1);
    let x = 0, z = 0.8;
    for (let i = 0; i < N; i++) {
      const a = a0 + i * d, rad = a * Math.PI / 180, b = f.bandes[i], om = Math.abs(Math.sin(rad));
      b.b.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${a.toFixed(2)}deg)`;
      b.or.style.opacity = (0.15 * om).toFixed(3); b.ov.style.opacity = (0.13 * om).toFixed(3);
      x += w * Math.cos(rad); z -= w * Math.sin(rad);
    }
  }
  function ranger(f) { vols.splice(vols.indexOf(f), 1); f.el.style.display = "none"; reserve.push(f); }
  function lancer() { if (!tourne) { tourne = true; U.boucle.ajouter(pas); } }
  function pas(dt) {
    vols.sort((a, b) => a.j - b.j);
    for (const f of vols) {
      if (f.retard > 0) { f.retard -= dt; continue; }
      f.p.pas(dt);
      if (f.p.v > 1) { f.p.v = 1; f.p.vit = Math.min(0, f.p.vit); } else if (f.p.v < 0) { f.p.v = 0; f.p.vit = Math.max(0, f.p.vit); }
    }
    for (let i = 1; i < vols.length; i++) {                  // deux feuillets ne se traversent jamais
      const a = vols[i - 1], b = vols[i];
      if (b.p.v > a.p.v - 0.014) { if (b.p.c >= 0.5 && !b.tenu) b.p.v = Math.max(0, a.p.v - 0.014); else a.p.v = Math.min(1, b.p.v + 0.014); }
    }
    let change = false;
    for (;;) {                                               // ils se posent dans l'ordre
      const g = vols[0], d = vols[vols.length - 1];
      const pose = (f) => f && !f.tenu && f.retard <= 0 && Math.abs(f.p.v - f.p.c) < 0.004 && Math.abs(f.p.vit) < 0.3;
      if (pose(g) && g.p.c === 1) ranger(g); else if (pose(d) && d.p.c === 0) ranger(d); else break;
      change = true;
    }
    let oG = 0, oD = 0;
    for (const f of vols) { dessiner(f); const p = U.borne(f.p.v, 0, 1), o = Math.sin(Math.PI * p); oD = Math.max(oD, o * (1 - p)); oG = Math.max(oG, o * p); }
    omD.style.opacity = (oD * 1.5).toFixed(3); omG.style.opacity = (oG * 1.5).toFixed(3);
    if (change) majStatiques();
    if (!vols.length) { tourne = false; return false; }
  }
  function poserTout() { for (const f of vols.slice()) ranger(f); omD.style.opacity = omG.style.opacity = 0; if (k) majStatiques(); }
  function aller(ns) {
    ns = U.borne(ns, 0, maxS());
    if (ns === s || anime) return;
    let i = 0;
    if (ns > s) for (let j = s; j < ns; j++) { const f = prendre(j, 0); f.p.c = 1; f.retard = f.p.v > 0 ? 0 : i++ * 0.07; }
    else for (let j = s - 1; j >= ns; j--) { const f = prendre(j, 1); f.p.c = 0; f.retard = f.p.v < 1 ? 0 : i++ * 0.07; }
    s = ns; k.s = s;
    S.jouer("page"); majStatiques(); precharger(); lancer();
  }
  function sauter(ns) { poserTout(); s = U.borne(ns, 0, maxS()); k.s = s; majStatiques(); precharger(); }
  K.suivant = () => aller(s + 1);
  K.precedent = () => aller(s - 1);
  K.aller = aller;

  // ---------- ouvrir et refermer ----------
  const forme = (a, m) => { const cx = bx + 1.5 * pw, cy = by + ph / 2, e0 = a.h / (ph + 28); return `translate3d(${((a.x - cx) * (1 - m)).toFixed(2)}px,${((a.y - cy) * (1 - m)).toFixed(2)}px,0) rotate(${(a.r * (1 - m)).toFixed(3)}deg) scale(${U.melange(e0, 1, m).toFixed(5)})`; };
  function poseCouv(c) {
    couv.style.transform = `rotateY(${(-180 * c).toFixed(2)}deg) translateZ(2px)`;
    const o = U.borne((c - 0.45) / 0.1, 0, 1).toFixed(3);
    stG.style.opacity = o; trG.style.opacity = o;
  }
  K.ouvrir = function (v) {
    if (ouvert || F.ouvert()) return false;
    k = v.o; kv = v; ouvert = true; anime = true;
    el.hidden = false; fouille.hidden = true; el.classList.remove("fouille-la", "la");
    mesurer(); vols = [];
    s = U.borne(k.s || 0, 0, maxS());
    titre.value = k.nom; couvNom.textContent = k.nom; el.style.setProperty("--couleur", k.couleur);
    majStatiques(); precharger();
    const a = B.rectEcran(v);
    B.cacher(v, true);
    livre.style.transform = forme(a, 0); poseCouv(0); voile.style.opacity = 0;
    void el.offsetWidth; el.classList.add("la");
    S.jouer("classeur");
    U.anim(640, (t) => {
      livre.style.transform = forme(a, U.douce(Math.min(1, t / 0.6)));
      poseCouv(U.douce2(U.borne((t - 0.1) / 0.9, 0, 1)));
      voile.style.opacity = Math.min(1, t * 2).toFixed(3);
    }, () => { anime = false; livre.style.transform = ""; majBascules(); });
    return true;
  };
  K.fermer = function () {
    if (!ouvert || anime) return;
    if (!fouille.hidden) return fermerFouille();
    poserTout(); anime = true; k.s = s; el.classList.remove("la"); majBascules();
    if (document.activeElement === titre) titre.blur();
    const a = B.rectEcran(kv);
    S.jouer("classeur");
    U.anim(520, (t) => {
      poseCouv(1 - U.douce2(Math.min(1, t / 0.8)));
      livre.style.transform = forme(a, 1 - U.douce2(U.borne((t - 0.25) / 0.75, 0, 1)));
      voile.style.opacity = (1 - t * t).toFixed(3);
    }, () => {
      el.hidden = true; ouvert = false; anime = false; livre.style.transform = "";
      B.cacher(kv, false); B.majClasseur(kv); B.sursaut(kv); P.sauver(k);
      k = null; kv = null;
    });
  };
  K.redimensionner = function () {
    if (!ouvert || anime) return;
    poserTout(); mesurer(); s = U.borne(s, 0, maxS()); majStatiques();
    if (!fouille.hidden) disposer();
  };

  // ---------- tirer une page, ou la toucher pour écrire dessus ----------
  scene.addEventListener("pointerdown", (e) => {
    if (!ouvert || anime || ptr) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { scene.setPointerCapture(e.pointerId); } catch (x) { /* pointeur d'essai */ }
    const x = e.clientX, y = e.clientY;
    ptr = { id: e.pointerId, x0: x, y0: y, bouge: false, vit: new U.Vitesse(), f: null, dehors: y < by - 14 || y > by + ph + 14 || x < (double ? bx : bx + pw) - 16 || x > bx + 2 * pw + 16 };
    ptr.vit.noter(x, y);
  });
  addEventListener("pointermove", (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const x = e.clientX, dos = bx + pw;
    ptr.vit.noter(x, e.clientY);
    if (!ptr.bouge) {
      if (Math.hypot(x - ptr.x0, e.clientY - ptr.y0) < 6) return;
      ptr.bouge = true;
      if (ptr.dehors) return;
      const avant = double ? ptr.x0 > dos : x < ptr.x0;
      if (avant ? s < maxS() : s > 0) {
        const f = prendre(avant ? s : s - 1, avant ? 0 : 1);
        f.tenu = true; f.retard = 0; f.p.k = 900; f.p.a = 58; ptr.f = f; ptr.avant = avant;
        ptr.ref = Math.max(Math.abs(ptr.x0 - dos), 0.35 * pw);
        majStatiques();
      }
    }
    const f = ptr.f; if (!f) return;
    if (double) f.p.c = Math.acos(U.borne((x - dos) / ptr.ref, -1, 1)) / Math.PI;
    else f.p.c = ptr.avant ? U.borne((ptr.x0 - x) / (0.7 * pw), 0, 1) : 1 - U.borne((x - ptr.x0) / (0.7 * pw), 0, 1);
    lancer();
  });
  function finPtr(e) {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr, f = p.f; ptr = null;
    if (f) {
      const vx = p.vit.lire().x, cible = e.type === "pointercancel" ? (p.avant ? 0 : 1) : vx < -300 ? 1 : vx > 300 ? 0 : f.p.v > 0.5 ? 1 : 0;
      f.tenu = false; f.p.k = 140; f.p.a = 22; f.p.c = cible;
      f.p.vit = U.borne(f.p.vit, -6, 6);
      const avant = s;
      s = U.borne(cible === 1 ? Math.max(s, f.j + 1) : Math.min(s, f.j), 0, maxS()); k.s = s;
      if (s !== avant) { S.jouer("page"); precharger(); }
      majStatiques(); lancer();
      return;
    }
    if (p.bouge || e.type === "pointercancel") return;
    if (p.dehors) return K.fermer();
    ouvrirPage(double ? (p.x0 < bx + pw ? 2 * s - 1 : 2 * s) : s);
  }
  addEventListener("pointerup", finPtr);
  addEventListener("pointercancel", finPtr);
  function ouvrirPage(i) {
    const pg = k.pages[i]; if (!pg || vols.length) return;
    const gauche = double && i % 2 === 1;
    F.ouvrir(pg, () => ({ x: bx + (gauche ? 0.5 : 1.5) * pw, y: by + ph / 2, l: pw * (pg.l && pg.l > pg.h ? 0.94 : pg.l ? 0.66 : 1), r: 0 }), {
      avantRetour: (page) => T.urlPage(page),
      fini() { if (ouvert) majStatiques(); },
    });
  }
  K.pageCourante = () => (k ? k.pages[double ? Math.min(nb() - 1, 2 * s) : s] || null : null);
  el.addEventListener("wheel", (e) => {
    if (!fouille.hidden) return;
    e.preventDefault();
    const d = e.deltaY + e.deltaX, t = performance.now();
    if (Math.abs(d) < 4 || t - molette < 110) return;
    molette = t; aller(s + (d > 0 ? 1 : -1));
  }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- la barre ----------
  barre.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !ouvert || anime) return;
    const a = b.dataset.action;
    if (a === "avant") aller(s - 1); else if (a === "apres") aller(s + 1);
    else if (a === "ajouter") K.ajouter(); else if (a === "fouiller") K.fouiller(); else if (a === "fermer") { if (!fouille.hidden) fermerFouille(); K.fermer(); }
  });
  titre.addEventListener("input", () => { if (!k) return; k.nom = titre.value.trim() || "Classeur"; couvNom.textContent = k.nom; B.majClasseur(kv); P.sauver(k); });
  K.ajouter = function () {
    if (!ouvert || anime) return;
    poserTout();
    const n = nb(), i0 = double ? 2 * s : s, cour = k.pages[Math.min(n - 1, i0)];
    const pg = { id: U.id("f"), type: "feuille", papier: (cour && cour.papier) || K.papier || "ligne", traits: [], v: 1 };
    const i = n === 0 ? 0 : Math.min(n, i0 + 1);
    k.pages.splice(i, 0, pg); B.majClasseur(kv); P.sauver(k);
    S.jouer("feuille");
    T.urlPage(pg).then(() => {
      if (!ouvert) return;
      if (!fouille.hidden) return construire();
      majStatiques(); aller(double ? Math.ceil(i / 2) : i);
    });
  };

  // ---------- fouiller : toutes les pages à plat, on les déplace, on en sort ----------
  let vigs = [], geo = null, pf = null;
  K.fouiller = function () { if (!ouvert || anime) return; if (fouille.hidden) ouvrirFouille(); else fermerFouille(); };
  K.fouilleOuverte = () => ouvert && !fouille.hidden;
  function ouvrirFouille() { poserTout(); fouille.hidden = false; el.classList.add("fouille-la"); majBascules(); construire(); S.jouer("feuille"); }
  function fermerFouille() { fouille.hidden = true; el.classList.remove("fouille-la"); pf = null; s = U.borne(s, 0, maxS()); majStatiques(); }
  function construire() {
    grille.textContent = "";
    vigs = k.pages.map((pg) => { const e = U.el("div", "vig", grille); fond(U.el("div", "im", e), pg); const g = { el: e, pg, num: U.el("b", "", e), tenu: false }; e.__g = g; return g; });
    geo = { cale: U.el("div", "cale", grille) };
    disposer();
  }
  function disposer() {
    const W = grille.clientWidth || innerWidth, petit = W < 560;
    const tw = petit ? 96 : 148, th = Math.round(tw * 1.4143), esp = petit ? 16 : 26, bas = 26;
    const cols = Math.max(2, Math.floor((W - esp) / (tw + esp))), x0 = (W - (cols * (tw + esp) - esp)) / 2;
    Object.assign(geo, { tw, th, esp, bas, cols, x0 });
    grille.style.setProperty("--tw", tw + "px"); grille.style.setProperty("--th", th + "px");
    vigs.forEach((g, i) => {
      g.x = x0 + (i % cols) * (tw + esp); g.y = esp + Math.floor(i / cols) * (th + esp + bas);
      if (!g.tenu) g.el.style.transform = `translate3d(${g.x.toFixed(1)}px,${g.y.toFixed(1)}px,0)`;
      g.num.textContent = i + 1;
    });
    geo.cale.style.height = (esp + Math.ceil(vigs.length / cols) * (th + esp + bas) + 20) + "px";
  }
  grille.addEventListener("pointerdown", (e) => {
    if (pf || (e.pointerType === "mouse" && e.button !== 0)) return;
    const ev = e.target.closest ? e.target.closest(".vig") : null; if (!ev) return;
    const g = ev.__g, r = grille.getBoundingClientRect();
    pf = { id: e.pointerId, g, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, tenu: false, annule: false, dx: e.clientX - r.left - g.x, dy: e.clientY - r.top + grille.scrollTop - g.y };
    if (e.pointerType !== "mouse") pf.minuterie = setTimeout(() => { if (pf && pf.g === g && !pf.annule) saisir(); }, 280);   // appui long : on prend la page (sinon on fait défiler)
  });
  function saisir() { pf.tenu = true; pf.g.tenu = true; pf.g.el.classList.add("tenu"); S.jouer("prise"); suivre(); }
  function suivre() {
    const g = pf.g, r = grille.getBoundingClientRect();
    const x = pf.x - r.left - pf.dx, y = pf.y - r.top + grille.scrollTop - pf.dy;
    g.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(1.07) rotate(-2deg)`;
    const col = U.borne(Math.round((x - geo.x0) / (geo.tw + geo.esp)), 0, geo.cols - 1), lig = Math.max(0, Math.round((y - geo.esp) / (geo.th + geo.esp + geo.bas)));
    const i = U.borne(lig * geo.cols + col, 0, vigs.length - 1), de = vigs.indexOf(g);
    if (i !== de) { vigs.splice(de, 1); vigs.splice(i, 0, g); disposer(); }
    const sr = sortie.getBoundingClientRect();
    pf.sort = pf.x > sr.left - 20 && pf.x < sr.right + 20 && pf.y > sr.top - 24;
    sortie.classList.toggle("chaud", pf.sort);
    if (pf.y > r.bottom - 46) grille.scrollTop += 10; else if (pf.y < r.top + 46) grille.scrollTop -= 10;
  }
  addEventListener("pointermove", (e) => {
    if (!pf || e.pointerId !== pf.id) return;
    pf.x = e.clientX; pf.y = e.clientY;
    const d = Math.hypot(pf.x - pf.x0, pf.y - pf.y0);
    if (!pf.tenu) {
      if (e.pointerType === "mouse") { if (d > 5) saisir(); }
      else if (d > 10) { pf.annule = true; clearTimeout(pf.minuterie); }
      return;
    }
    suivre();
  });
  grille.addEventListener("touchmove", (e) => { if (pf && pf.tenu) e.preventDefault(); }, { passive: false });
  function finFouille(e) {
    if (!pf || e.pointerId !== pf.id) return;
    const p = pf, g = p.g; pf = null;
    clearTimeout(p.minuterie); sortie.classList.remove("chaud");
    if (!p.tenu) {
      if (e.type === "pointerup" && !p.annule && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) { const i = vigs.indexOf(g); fermerFouille(); sauter(double ? Math.ceil(i / 2) : i); }
      return;
    }
    g.tenu = false; g.el.classList.remove("tenu");
    if (p.sort && e.type === "pointerup") return sortir(g, p);
    disposer();
    k.pages.splice(0, k.pages.length, ...vigs.map((x) => x.pg));
    S.jouer("pose"); P.sauver(k);
  }
  addEventListener("pointerup", finFouille);
  addEventListener("pointercancel", finFouille);
  // la page quitte le classeur et se pose sur le bureau, à côté
  function sortir(g, p) {
    const pg = g.pg, cl = k, v = kv, d = P.donnees(), i = vigs.indexOf(g);
    vigs.splice(i, 1); g.el.remove(); disposer();
    cl.pages.splice(0, cl.pages.length, ...vigs.map((x) => x.pg));
    pg.x = U.borne(cl.x + 190 + Math.random() * 50, 100, B.ML - 100); pg.y = U.borne(cl.y + (Math.random() - 0.5) * 120, 120, B.MH - 120); pg.r = (Math.random() - 0.5) * 12; pg.z = 0;
    d.objets.push(pg); B.ajouter(pg, { x: p.x, y: p.y });
    B.majClasseur(v); P.sauver();
    C.dire("Page sortie sur le bureau", { libelle: "Annuler", action() {
      const j = d.objets.indexOf(pg); if (j < 0) return;
      d.objets.splice(j, 1); B.retirer(pg.id);
      cl.pages.splice(Math.min(i, cl.pages.length), 0, pg); B.majClasseur(v); P.sauver();
      if (ouvert && k === cl) { if (!fouille.hidden) construire(); else majStatiques(); }
    } });
  }
  K.etat = () => ({ ouvert, anime, double, s, n: k ? nb() : 0, vols: vols.length, pw, ph, bx, by, fouille: !fouille.hidden, geo: geo && { tw: geo.tw, th: geo.th, esp: geo.esp, bas: geo.bas, cols: geo.cols, x0: geo.x0 } });
})(window.Cartable);
