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
  K.courant = () => (ouvert && k ? k : null);                 // le classeur ouvert (pour Nova : « rajoute une feuille »)

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
    vues0 = signature();
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
    majPastilles();
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

  // ---------- enlever une page : la pastille « Sortir / Jeter » au coin de la page, ou on l'attrape et on la tire dehors ----------
  const elCorb = document.getElementById("corbeille");
  const IC_P = { sortir: "M12 4v11M7 10l5 5 5-5M4 20h16", jeter: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" };
  let choix = 1, arr = null, enVol = 0, vues0 = "";
  // la page visible d'un côté (0 = gauche, 1 = droite) : son rang dans le classeur, ou -1
  const indexVu = (c) => { if (!k) return -1; const j = double ? (c ? 2 * s : 2 * s - 1) : (c ? s : -1); return j >= 0 && j < nb() ? j : -1; };
  const centre = (i) => ({ x: bx + (double && i % 2 === 1 ? 0.5 : 1.5) * pw, y: by + ph / 2 });
  const signature = () => (k ? k.pages.map((pg) => pg.id + ":" + (pg.v || 0)).join(",") + "|" + k.nom : "");
  const past = [0, 1].map((c) => {
    const e = U.el("div", "bascule pastille", el); e.hidden = true;
    for (const [quoi, nom, aide] of [["sortir", "Sortir", "Sortir sur le bureau"], ["jeter", "Jeter", "Jeter à la corbeille (Suppr)"]]) {
      const b = U.el("button", "", e); b.dataset.quoi = quoi; b.title = aide; b.setAttribute("aria-label", aide);
      b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${IC_P[quoi]}"/></svg>`;
      U.el("span", "", b).textContent = nom;
    }
    const x = { el: e, i: -1 };
    e.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b || x.i < 0) return; choix = c; if (b.dataset.quoi === "jeter") K.jeterPage(x.i); else K.sortirPage(x.i); });
    e.addEventListener("pointerenter", () => choisir(c));
    return x;
  });
  function choisir(c) { if (c === choix || indexVu(c) < 0) return; choix = c; majPastilles(); }
  function majPastilles() {
    const libre = ouvert && !anime && !vols.length && fouille.hidden && !arr;
    if (indexVu(choix) < 0) choix = indexVu(1) >= 0 ? 1 : 0;
    past.forEach((p, c) => {
      const j = libre ? indexVu(c) : -1; p.i = j; p.el.hidden = j < 0;
      if (j < 0) return;
      const photo = !!k.pages[j].image, enHaut = !double || (photo && pw < 470);       // téléphone (une seule page) : en haut, loin des messages et de la pastille photo
      p.el.classList.toggle("court", photo || pw < 460); p.el.classList.toggle("a-gauche", !c);
      p.el.classList.toggle("choisie", c === choix && indexVu(1 - c) >= 0);
      p.el.style.left = Math.round(c ? bx + 2 * pw - 12 : bx + 12) + "px"; p.el.style.top = Math.round(enHaut ? by + 10 : by + ph - 8) + "px";
    });
  }
  // la page décollée : une copie qui suit le doigt, ou qui s'envole
  function poserF(a) {
    a.el.style.transform = `translate3d(${(a.x - pw / 2).toFixed(1)}px,${(a.y - ph / 2).toFixed(1)}px,0) rotate(${a.r.toFixed(2)}deg) scale(${a.ech.toFixed(4)})`;
    a.el.style.opacity = a.op.toFixed(3);
  }
  function fantome(pg, i) {
    const e = U.el("div", "arrache", el), c = centre(i);
    e.style.width = pw + "px"; e.style.height = ph + "px"; fond(e, pg);
    const a = { el: e, pg, i, gauche: double && i % 2 === 1, x: c.x, y: c.y, ech: 1, r: 0, op: 1 };
    poserF(a);
    return a;
  }
  // on attrape la page : elle se décolle et suit le doigt ; la corbeille se montre
  function saisirPage(i, x, y) {
    if (arr || enVol || !fouille.hidden) return false;
    poserTout();
    const pg = k.pages[i]; if (!pg) return false;
    const a = arr = fantome(pg, i);
    a.gx = x - a.x; a.gy = y - a.y; a.px = x; a.py = y; a.x0 = x; a.y0 = y;
    a.m = new U.Ressort(0, 190, 21); a.m.c = 1; a.inc = new U.Ressort(0, 130, 15); a.vit = new U.Vitesse(); a.vit.noter(x, y);
    (a.gauche ? stG : stD).classList.add("otee"); a.el.classList.add("tenue");
    document.body.classList.add("porte", "corb-haut");
    S.jouer("prise"); majBascules();
    U.boucle.ajouter(pasArr);
    return true;
  }
  function pasArr(dt) {
    const a = arr; if (!a || a.fini || a.retour) return false;
    a.m.pas(dt); a.inc.pas(dt);
    const m = U.borne(a.m.v, 0, 1.15);
    if (a.vue) {                                              // le bureau la porte déjà : la copie suit, le temps que le classeur se referme
      const v = a.vue, o = a.pg;
      if (!ouvert || B.vue(o.id) !== v || v.vol) { finFantome(); return false; }
      const c = B.ecran(o.x, o.y), z = B.cam.z;
      a.x = c.x + a.ox * (1 - m); a.y = c.y + a.oy * (1 - m);
      a.ech = U.melange(a.e0, Math.max(v.l * z / pw, v.h * z / ph) * 1.07, m); a.r = U.melange(a.r0, v.inc.v + (o.r || 0), U.borne(m, 0, 1));
    } else {
      a.inc.c = U.borne(a.vit.lire().x * 0.011, -12, 12);
      a.x = a.px - a.gx; a.y = a.py - a.gy; a.ech = 1 - 0.06 * m; a.r = a.inc.v;
    }
    poserF(a);
  }
  function suivreArr(e) {
    const a = arr; if (!a || a.vue || a.retour) return;
    a.px = e.clientX; a.py = e.clientY; a.vit.noter(a.px, a.py);
    const hors = a.py < by - 10 || a.py > by + ph + 24 || a.px < (double ? bx : bx + pw) - 24 || a.px > bx + 2 * pw + 24;
    if (hors || Math.hypot(a.px - a.x0, a.py - a.y0) > (double ? Math.min(0.22 * ph, 170) : 110)) arracher(e);
  }
  // elle sort du classeur : le classeur se referme vite, et le bureau prend la page sous le doigt (inertie, corbeille, autre classeur)
  function arracher(e) {
    const a = arr, pg = a.pg, cl = k, d = P.donnees(), i = cl.pages.indexOf(pg);
    if (i < 0) return reposer();
    cl.pages.splice(i, 1); d.objets.push(pg);
    s = U.borne(s, 0, maxS()); cl.s = s; pg.r = (Math.random() - 0.5) * 7;
    stG.classList.remove("otee"); stD.classList.remove("otee");
    try { scene.releasePointerCapture(e.pointerId); } catch (x) { /* pointeur d'essai */ }
    ptr = null;
    a.ox = a.x - e.clientX; a.oy = a.y - e.clientY; a.e0 = a.ech; a.r0 = a.r; a.m.poser(0); a.m.c = 1;
    a.vue = B.sortirSousLeDoigt(pg, e); B.cacher(a.vue, true);
    majStatiques(); B.majClasseur(kv); P.sauver();
    S.jouer("feuille");
    C.dire(`Page sortie de « ${cl.nom} »`, { libelle: "Annuler", action() { remettre(pg, cl, i); } });
    fermer(270);
  }
  // lâchée dans le classeur : elle retourne à sa place
  function reposer() {
    const a = arr; if (!a || a.retour || a.vue) return;
    a.retour = true;
    const c = centre(a.i), x0 = a.x, y0 = a.y, e0 = a.ech, r0 = a.r;
    document.body.classList.remove("porte", "corb-haut"); a.el.classList.remove("tenue");
    U.anim(210, (t) => { const d = U.douce2(t); a.x = U.melange(x0, c.x, d); a.y = U.melange(y0, c.y, d); a.ech = U.melange(e0, 1, d); a.r = r0 * (1 - d); poserF(a); }, () => { finFantome(); S.jouer("pose", 0.6); });
  }
  function finFantome() {
    const a = arr; if (!a) return;
    arr = null; a.fini = true; a.el.remove();
    stG.classList.remove("otee"); stD.classList.remove("otee");
    document.body.classList.remove("corb-haut");
    if (a.vue) B.cacher(a.vue, false);
    if (ouvert && !anime) majBascules();
  }
  // retire la page du classeur ouvert et rend sa copie, prête à s'envoler
  function retirer(i) {
    if (!ouvert || anime || arr || enVol || !fouille.hidden || ptr) return null;
    poserTout();
    const pg = k.pages[i]; if (!pg) return null;
    const a = fantome(pg, i);
    k.pages.splice(i, 1); s = U.borne(s, 0, maxS()); k.s = s;
    majStatiques(); B.majClasseur(kv); precharger();
    return a;
  }
  // « Annuler » : la page retrouve sa place dans le classeur
  function remettre(pg, cl, i) {
    const d = P.donnees();
    if (d.objets.indexOf(cl) < 0 || cl.pages.indexOf(pg) >= 0) return false;
    const j = d.objets.indexOf(pg), c = d.corbeille.indexOf(pg);
    if (j < 0 && c < 0) return false;                         // elle est déjà rangée ailleurs
    if (j >= 0) { d.objets.splice(j, 1); B.retirer(pg.id); } else d.corbeille.splice(c, 1);
    i = Math.min(i, cl.pages.length); cl.pages.splice(i, 0, pg);
    const v = B.vue(cl.id); if (v) { B.majClasseur(v); if (!(ouvert && k === cl)) B.sursaut(v); }
    S.jouer("range"); P.sauver();
    if (ouvert && k === cl && !anime) { if (!fouille.hidden) construire(); else sauter(double ? Math.ceil(i / 2) : i); }
    return true;
  }
  // bouton « Sortir » : la page quitte le classeur (qui reste ouvert) et se pose sur le bureau, à côté
  K.sortirPage = function (i) {
    if (i === undefined) i = indexVu(choix);
    const cl = k, d = P.donnees(), a = retirer(i); if (!a) return false;
    const pg = a.pg, sens = a.gauche ? -1 : 1;
    pg.x = U.borne(cl.x + 190 + Math.random() * 50, 100, B.ML - 100); pg.y = U.borne(cl.y + (Math.random() - 0.5) * 120, 120, B.MH - 120); pg.r = (Math.random() - 0.5) * 12; pg.z = 0;
    d.objets.push(pg); B.ajouter(pg); P.sauver();
    S.jouer("feuille"); enVol++;
    const x0 = a.x, y0 = a.y, dx = sens * Math.min(pw * 0.8, 300);
    U.anim(430, (t) => {
      const e = U.douce(t);
      a.x = x0 + dx * e; a.y = y0 + ph * 0.16 * e - Math.sin(Math.PI * t) * 46; a.ech = U.melange(1, 0.4, e); a.r = sens * 16 * e; a.op = 1 - t * t * t;
      poserF(a);
    }, () => { a.el.remove(); enVol--; S.jouer("pose", 0.7); if (ouvert) majBascules(); });
    C.dire("Page sortie sur le bureau", { libelle: "Annuler", action() { remettre(pg, cl, i); } });
    return true;
  };
  // bouton « Jeter » ou touche Suppr : la page file dans la corbeille (rien n'est détruit)
  K.jeterPage = function (i) {
    if (i === undefined) i = indexVu(choix);
    const cl = k, d = P.donnees(), a = retirer(i); if (!a) return false;
    const pg = a.pg;
    d.corbeille.push(pg); P.sauver();
    S.jouer("prise"); enVol++;
    document.body.classList.add("porte", "corb-haut");
    const x0 = a.x, y0 = a.y, cx = innerWidth / 2, cy = elCorb.offsetTop + elCorb.offsetHeight / 2, r1 = (a.gauche ? 1 : -1) * 9;
    U.anim(400, (t) => {
      const e = U.douce2(t);
      a.x = U.melange(x0, cx, e); a.y = U.melange(y0, cy, e) - Math.sin(Math.PI * t) * 18; a.ech = U.melange(1, 0.1, e); a.r = r1 * e; a.op = 1 - t * t * t * t;
      if (t > 0.5) elCorb.classList.add("chaud");
      poserF(a);
    }, () => {
      a.el.remove(); enVol--; S.jouer("feuille");
      setTimeout(() => { if (enVol || arr || B.occupe()) return; elCorb.classList.remove("chaud"); document.body.classList.remove("porte", "corb-haut"); }, 260);
      if (ouvert) majBascules();
    });
    C.dire(pg.type === "photo" || pg.image ? "Photo jetée" : "Feuille jetée", { libelle: "Annuler", duree: 7000, action() { remettre(pg, cl, i); } });
    return true;
  };
  // le classeur ouvert a changé ailleurs (Nova, un autre appareil) : on montre tout de suite ses vraies pages
  K.rafraichir = function () {
    if (!ouvert || !k || anime || ptr || arr || pf) return false;
    if (P.donnees().objets.indexOf(k) < 0) { if (!fouille.hidden) fermerFouille(); K.fermer(); return true; }
    if (signature() === vues0) return false;
    poserTout(); s = U.borne(s, 0, maxS()); k.s = s;
    if (document.activeElement !== titre) titre.value = k.nom;
    couvNom.textContent = k.nom;
    majStatiques(); precharger();
    if (!fouille.hidden) construire();
    return true;
  };
  K.pastilles = () => past.map((p) => (p.el.hidden ? null : { i: p.i, choisie: p.el.classList.contains("choisie"), court: p.el.classList.contains("court"), rect: p.el.getBoundingClientRect().toJSON() }));

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
  // fluidité : la couverture choisie, réduite à la taille de l'écran et décodée d'avance (jamais une photo de 1400 px qui se décode pendant l'animation)
  const couvPretes = new Map();                            // url d'origine + taille -> url réduite et décodée
  const tailleCouv = () => {
    const W = innerWidth, H = innerHeight, d = W > H, dpr = Math.min(2, devicePixelRatio || 1);
    const p = Math.floor(d ? Math.min((W - 96) / 2, (H - 104) / 1.4143) : Math.min(W - 26, (H - 92) / 1.4143));
    return [Math.ceil((p + 16) * dpr), Math.ceil((p * 1.4143 + 28) * dpr)];
  };
  function preparerCouv(url) {
    if (!url) return Promise.resolve("");
    const [w, h] = tailleCouv(), cle = url + "|" + w + "x" + h;
    let x = couvPretes.get(cle);
    if (x) return x.p;
    x = { u: "" };
    x.p = (async () => {
      let u = url;
      try {                                                  // tout hors du fil principal : lecture, décodage, réduction, encodage
        let bm0, iw, ih;
        if (/^https?:/i.test(new URL(url, location.href).protocol)) { bm0 = await createImageBitmap(await (await fetch(url)).blob()); iw = bm0.width; ih = bm0.height; }
        else { bm0 = new Image(); bm0.decoding = "async"; bm0.src = url; await bm0.decode(); iw = bm0.naturalWidth; ih = bm0.naturalHeight; }   // blob:, data:, file:// (sans fetch : la CSP le bloque)
        const e = Math.max(w / iw, h / ih), rw = Math.round(iw * e), rh = Math.round(ih * e);
        if (e < 0.85) {
          const bm = await createImageBitmap(bm0, { resizeWidth: rw, resizeHeight: rh, resizeQuality: "high" });
          let bl;
          if (window.OffscreenCanvas) { const cv = new OffscreenCanvas(rw, rh); cv.getContext("2d").drawImage(bm, 0, 0); bl = await cv.convertToBlob({ type: "image/jpeg", quality: 0.9 }); }
          else { const cv = document.createElement("canvas"); cv.width = rw; cv.height = rh; cv.getContext("2d").drawImage(bm, 0, 0); bl = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.9)); }
          bm.close && bm.close();
          if (bl) u = URL.createObjectURL(bl);
        }
        bm0.close && bm0.close();
      } catch (er) { u = url; }
      const im = new Image(); im.decoding = "async"; im.src = u;   // décodée d'avance : elle s'affiche sans attendre
      try { await im.decode(); } catch (er) {}
      x.im = im;                                             // gardée en mémoire tant que la couverture sert
      x.u = u; return u;
    })().catch(() => { x.u = url; return url; });
    couvPretes.set(cle, x);
    return x.p;
  }
  const couvPrete = (url) => { if (!url) return ""; const [w, h] = tailleCouv(), x = couvPretes.get(url + "|" + w + "x" + h); return x && x.u; };
  // au repos, on prépare d'avance les couvertures des classeurs du bureau
  K.prechargerCouvertures = function () {
    let objs = [];
    try { objs = (P.donnees().objets || []).filter((o) => o && o.couv); } catch (e) { return; }
    const suite = () => { const o = objs.shift(); if (!o) return; preparerCouv(o.couv).then(() => tranquille(suite)); };
    tranquille(suite);
  };
  const tranquille = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2500 }) : setTimeout(f, 200));
  // une couverture toute neuve se réduit une fois, quand rien ne bouge (jamais pendant une page qui tourne)
  let geste = 0;
  for (const t of ["pointerdown", "pointerup", "wheel", "keydown"]) window.addEventListener(t, () => { geste = performance.now(); }, { capture: true, passive: true });
  const auCalme = (f) => setTimeout(() => {
    const essai = (d) => (anime || vols.length || ptr || performance.now() - geste < 2500 || (d && !d.didTimeout && d.timeRemaining() < 30) ? auCalme(f) : f());
    window.requestIdleCallback ? requestIdleCallback(essai) : essai();
  }, 1500);
  setTimeout(() => K.prechargerCouvertures(), 1500);
  setInterval(() => { if (!ouvert && !document.hidden) K.prechargerCouvertures(); }, 10000);   // une couverture changée : prête avant la prochaine ouverture
  function poserCouv() {                                     // (pas encore prête : l'originale, et la réduite une fois le livre posé)
    const url = k.couv || "", u = couvPrete(url);
    couvExt.classList.toggle("image", !!url);
    couvExt.style.backgroundImage = url ? `url("${u || url}")` : "";
  }
  // pendant l'ouverture et la fermeture : le livre devient un seul calque qui glisse et grandit, sans rien redessiner
  const bouge = (oui) => el.classList.toggle("bouge", oui);
  const forme =(a, m) => { const cx = bx + 1.5 * pw, cy = by + ph / 2, e0 = a.h / (ph + 28); return `translate3d(${((a.x - cx) * (1 - m)).toFixed(2)}px,${((a.y - cy) * (1 - m)).toFixed(2)}px,0) rotate(${(a.r * (1 - m)).toFixed(3)}deg) scale(${U.melange(e0, 1, m).toFixed(5)})`; };
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
    poserCouv();                                             // couverture choisie (sinon le cuir d'origine), réduite et décodée d'avance
    majStatiques();
    const a = B.rectEcran(v);
    B.cacher(v, true);
    bouge(true);
    livre.style.transform = forme(a, 0); poseCouv(0); voile.style.opacity = 0;
    void el.offsetWidth; el.classList.add("la");
    S.jouer("classeur");
    U.anim(640, (t) => {
      livre.style.transform = forme(a, U.douce(Math.min(1, t / 0.6)));
      poseCouv(U.douce2(U.borne((t - 0.1) / 0.9, 0, 1)));
      voile.style.opacity = Math.min(1, t * 2).toFixed(3);
    }, () => {
      anime = false; livre.style.transform = ""; bouge(false); majBascules();
      if (k) { precharger(); const kk = k; if (kk.couv && !couvPrete(kk.couv)) auCalme(() => preparerCouv(kk.couv).then((u) => { if (k === kk && u && !anime) couvExt.style.backgroundImage = `url("${u}")`; })); }
    });
    return true;
  };
  K.fermer = function () {
    if (!ouvert || anime || arr) return;
    if (!fouille.hidden) return fermerFouille();
    fermer(520);
  };
  function fermer(duree) {
    poserTout(); anime = true; k.s = s; el.classList.remove("la"); majBascules();
    if (document.activeElement === titre) titre.blur();
    const a = B.rectEcran(kv);
    S.jouer("classeur");
    bouge(true);
    U.anim(duree, (t) => {
      poseCouv(1 - U.douce2(Math.min(1, t / 0.8)));
      livre.style.transform = forme(a, 1 - U.douce2(U.borne((t - 0.25) / 0.75, 0, 1)));
      voile.style.opacity = (1 - t * t).toFixed(3);
    }, () => {
      el.hidden = true; ouvert = false; anime = false; livre.style.transform = ""; bouge(false);
      B.cacher(kv, false); B.majClasseur(kv); B.sursaut(kv); P.sauver(k);
      k = null; kv = null;
      finFantome();
    });
  }
  K.redimensionner = function () {
    if (!ouvert || anime) return;
    poserTout(); mesurer(); s = U.borne(s, 0, maxS()); majStatiques();
    if (!fouille.hidden) disposer();
  };

  // ---------- tirer une page, ou la toucher pour écrire dessus ----------
  scene.addEventListener("pointerdown", (e) => {
    if (!ouvert || anime || ptr || arr || enVol) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { scene.setPointerCapture(e.pointerId); } catch (x) { /* pointeur d'essai */ }
    const x = e.clientX, y = e.clientY;
    const p = ptr = { id: e.pointerId, x0: x, y0: y, bouge: false, vit: new U.Vitesse(), f: null, dehors: y < by - 14 || y > by + ph + 14 || x < (double ? bx : bx + pw) - 16 || x > bx + 2 * pw + 16 };
    ptr.vit.noter(x, y);
    const cote = double && x < bx + pw ? 0 : 1;
    p.i = p.dehors || vols.length ? -1 : indexVu(cote);
    if (p.i >= 0) {
      choisir(cote);
      p.long = setTimeout(() => { if (ptr === p && !p.bouge && !p.f && ouvert && !anime && saisirPage(p.i, p.x0, p.y0)) p.pris = true; }, 380);   // appui long : la page se décolle
    }
  });
  scene.addEventListener("pointermove", (e) => { if (!ptr && !arr && ouvert && double && e.pointerType === "mouse") choisir(e.clientX < bx + pw ? 0 : 1); });
  addEventListener("pointermove", (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const x = e.clientX, dos = bx + pw;
    ptr.vit.noter(x, e.clientY);
    if (ptr.pris) { ptr.bouge = true; return suivreArr(e); }
    if (!ptr.bouge) {
      if (Math.hypot(x - ptr.x0, e.clientY - ptr.y0) < 6) return;
      ptr.bouge = true; clearTimeout(ptr.long);
      if (ptr.dehors) return;
      // tirée vers le haut ou le bas : on l'attrape pour la sortir (de côté : on tourne la page, comme avant)
      if (ptr.i >= 0 && Math.abs(e.clientY - ptr.y0) > 1.4 * Math.abs(x - ptr.x0) && saisirPage(ptr.i, ptr.x0, ptr.y0)) { ptr.pris = true; return suivreArr(e); }
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
    clearTimeout(p.long);
    if (p.pris) { if (arr && !arr.vue) reposer(); return; }
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
  K.etat = () => ({ ouvert, anime, double, s, n: k ? nb() : 0, vols: vols.length, pw, ph, bx, by, fouille: !fouille.hidden, choix, pastilles: K.pastilles(), tenue: arr ? { i: arr.i, sortie: !!arr.vue } : null, geo: geo && { tw: geo.tw, th: geo.th, esp: geo.esp, bas: geo.bas, cols: geo.cols, x0: geo.x0 } });
})(window.Cartable);
