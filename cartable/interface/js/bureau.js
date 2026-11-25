// Cartable, interface : le bureau. Des objets qu'on prend, qu'on lance, qu'on pose, qu'on range ; une table qu'on parcourt.
"use strict";
(function (C) {
  const U = C.U, T = C.T, S = C.sons, P = C.pont;
  const B = C.bureau = {};
  const ML = 2400, MH = 1500, EK = 150 / 840;          // le monde, et l'échelle page -> bureau
  B.ML = ML; B.MH = MH;
  const elB = document.getElementById("bureau"), elM = document.getElementById("monde"), elCorb = document.getElementById("corbeille");
  const cam = { x: ML / 2, y: MH / 2, z: 1, vx: 0, vy: 0, zc: 1, ancre: null };
  B.cam = cam;
  const vues = new Map(), actives = new Set(), ptrs = new Map();
  let zmax = 1, vw = innerWidth, vh = innerHeight, tourne = false, pince = null;
  B.surToucher = null; B.selection = null;

  const taille = (o) => (o.type === "classeur" ? [190, 250] : [(o.l || T.PAGE_L) * EK, (o.h || T.PAGE_H) * EK]);
  B.taille = taille;
  const monde = (sx, sy) => ({ x: cam.x + (sx - vw / 2) / cam.z, y: cam.y + (sy - vh / 2) / cam.z });
  const ecran = (wx, wy) => ({ x: vw / 2 + (wx - cam.x) * cam.z, y: vh / 2 + (wy - cam.y) * cam.z });
  B.monde = monde; B.ecran = ecran;

  // ---------- la caméra ----------
  function zmin() { return Math.max(vw / ML, vh / MH, 0.3); }
  function appliquerCam() {
    cam.z = U.borne(cam.z, zmin(), 2.2);
    const dx = vw / 2 / cam.z, dy = vh / 2 / cam.z;
    cam.x = dx * 2 >= ML ? ML / 2 : U.borne(cam.x, dx, ML - dx);
    cam.y = dy * 2 >= MH ? MH / 2 : U.borne(cam.y, dy, MH - dy);
    elM.style.transform = `translate3d(${(vw / 2 - cam.x * cam.z).toFixed(2)}px,${(vh / 2 - cam.y * cam.z).toFixed(2)}px,0) scale(${cam.z.toFixed(4)})`;
  }
  B.redimensionner = function () { vw = innerWidth; vh = innerHeight; cam.zc = cam.z = U.borne(cam.z, zmin(), 2.2); appliquerCam(); };
  B.cadrer = function (z) { cam.z = cam.zc = z; cam.x = ML / 2; cam.y = MH / 2; appliquerCam(); };

  // ---------- les objets ----------
  function creerVue(o) {
    const [l, h] = taille(o);
    const el = U.el("div", "objet " + o.type, elM);
    el.style.cssText = `width:${l}px;height:${h}px;left:${-l / 2}px;top:${-h / 2}px;z-index:${o.z || 1}`;
    const repos = U.el("div", "ombre repos", el), leve = U.el("div", "ombre leve", el);
    const corps = U.el("div", "corps", el);
    const v = { o, el, corps, repos, leve, l, h, vx: 0, vy: 0, tenu: false, vol: false, lev: new U.Ressort(0, 260, 22), inc: new U.Ressort(0, 170, 15), ech: new U.Ressort(1, 320, 19), fondu: 1 };
    if (o.type === "classeur") garnirClasseur(v);
    else { v.toile = U.el("canvas", "", corps); B.repeindre(v); }
    el.__vue = v; vues.set(o.id, v);
    zmax = Math.max(zmax, o.z || 1);
    placer(v);
    return v;
  }
  function garnirClasseur(v) {
    const o = v.o;
    U.el("div", "feuilles", v.corps);
    const couv = v.couv = U.el("div", "couv", v.corps);
    couv.style.backgroundColor = o.couleur;
    U.el("div", "dos", couv);
    const et = U.el("div", "etiq", couv);
    v.nom = U.el("b", "", et); v.compte = U.el("small", "", et);
    U.el("div", "reflet", couv);
    B.majClasseur(v);
  }
  B.majClasseur = function (v) {
    const n = v.o.pages.length;
    v.nom.textContent = v.o.nom;
    v.compte.textContent = n === 0 ? "vide" : n + (n > 1 ? " pages" : " page");
    v.corps.style.setProperty("--ep", U.borne(2 + n * 0.5, 2, 9) + "px");
    const c = v.o.couv || "";                                             // couverture choisie (image), sinon le cuir d'origine
    if (v.couvVue !== c) { v.couvVue = c; v.couv.style.backgroundImage = c ? `url("${c}")` : ""; v.couv.classList.toggle("image", !!c); }
  };
  B.repeindre = function (v) {
    if (!v.toile) return;
    T.rendrePage(v.o, 360, { toile: v.toile });
    if ((v.o.image && !T.image(v.o.image).pret) || (v.o.voirPropre && v.o.propre && v.o.propre.v === 2)) T.imagePrete(v.o).then(() => { if (vues.get(v.o.id) === v) T.rendrePage(v.o, 360, { toile: v.toile }); });
  };
  function placer(v) {
    const lev = v.lev.v, s = v.ech.v * (1 + 0.075 * lev);
    v.el.style.transform = `translate3d(${v.o.x.toFixed(2)}px,${v.o.y.toFixed(2)}px,0) rotate(${(v.o.r + v.inc.v).toFixed(3)}deg) scale(${s.toFixed(4)})`;
    v.leve.style.opacity = U.borne(lev, 0, 1).toFixed(3);
    v.repos.style.opacity = U.borne(1 - lev * 0.85, 0, 1).toFixed(3);
  }
  function activer(v) { actives.add(v); lancer(); }
  function lancer() { if (!tourne) { tourne = true; U.boucle.ajouter(pas); } }
  function devant(v) { v.o.z = ++zmax; v.el.style.zIndex = v.o.z; }

  // ---------- la boucle : ressorts, glisse, élan de la table ----------
  function pas(dt) {
    let encore = false;
    // la table
    if (cam.ancre && Math.abs(cam.zc - cam.z) > 0.0004) {
      cam.z += (cam.zc - cam.z) * (1 - Math.exp(-17 * dt));
      const a = cam.ancre;
      cam.x = a.wx - (a.sx - vw / 2) / cam.z; cam.y = a.wy - (a.sy - vh / 2) / cam.z;
      appliquerCam(); encore = true;
    } else if (cam.ancre) { cam.ancre = null; }
    if (Math.abs(cam.vx) + Math.abs(cam.vy) > 3) {
      cam.x += cam.vx * dt; cam.y += cam.vy * dt;
      const f = Math.exp(-4.2 * dt); cam.vx *= f; cam.vy *= f;
      const x = cam.x, y = cam.y; appliquerCam();
      if (cam.x !== x) cam.vx = 0; if (cam.y !== y) cam.vy = 0;
      encore = true;
    }
    // les objets
    for (const v of actives) {
      const o = v.o;
      if (v.vol) { encore = true; continue; }
      if (v.tenu) {
        const p = v.ptr, w = monde(p.x, p.y), vi = p.vit.lire();
        o.x = w.x - p.gx; o.y = w.y - p.gy;
        v.inc.c = U.borne((vi.x * 0.011 + (p.gx / v.l) * vi.y * 0.02) / cam.z, -13, 13);
      } else if (Math.abs(v.vx) + Math.abs(v.vy) > 5) {
        o.x += v.vx * dt; o.y += v.vy * dt;
        const f = Math.exp(-6.2 * dt); v.vx *= f; v.vy *= f;
        const mx = v.l * 0.3, my = v.h * 0.3;
        if (o.x < mx) { o.x = mx; v.vx = Math.abs(v.vx) * 0.35; } else if (o.x > ML - mx) { o.x = ML - mx; v.vx = -Math.abs(v.vx) * 0.35; }
        if (o.y < my) { o.y = my; v.vy = Math.abs(v.vy) * 0.35; } else if (o.y > MH - my) { o.y = MH - my; v.vy = -Math.abs(v.vy) * 0.35; }
      } else { v.vx = v.vy = 0; }
      v.lev.pas(dt); v.inc.pas(dt); v.ech.pas(dt);
      placer(v);
      if (!v.tenu && !v.vx && !v.vy && v.lev.repos(0.002) && v.inc.repos(0.02) && v.ech.repos(0.001)) {
        v.lev.poser(v.lev.c); v.inc.poser(v.inc.c); v.ech.poser(v.ech.c); placer(v);
        actives.delete(v); v.el.classList.remove("bouge");
        P.sauver(o);
      } else encore = true;
    }
    if (!encore) { tourne = false; return false; }
  }

  // ---------- prendre, porter, lâcher ----------
  function prendre(v, p) {
    v.tenu = true; v.ptr = p; v.vx = v.vy = 0; v.lev.c = 1;
    devant(v); v.el.classList.add("tenu", "bouge");
    document.body.classList.add("porte");
    B.selection = v;
    S.jouer("prise"); activer(v);
  }
  function classeurSous(sx, sy, sauf) {
    const w = monde(sx, sy); let mieux = null;
    for (const k of vues.values()) {
      if (k === sauf || k.o.type !== "classeur" || k.vol) continue;
      if (Math.abs(w.x - k.o.x) < k.l / 2 + 8 && Math.abs(w.y - k.o.y) < k.h / 2 + 8 && (!mieux || k.o.z > mieux.o.z)) mieux = k;
    }
    return mieux;
  }
  function surCorbeille(sx, sy) { const r = elCorb.getBoundingClientRect(); return sx > r.left - 26 && sx < r.right + 26 && sy > r.top - 26 && sy < r.bottom + 26; }
  function survol(p, v) {
    const k = v.o.type === "classeur" ? null : classeurSous(p.x, p.y, v);
    if (k !== p.cible) {
      if (p.cible) { p.cible.el.classList.remove("accueille"); p.cible.ech.c = 1; activer(p.cible); }
      if (k) { k.el.classList.add("accueille"); k.ech.c = 1.07; activer(k); }
      p.cible = k;
    }
    const c = surCorbeille(p.x, p.y);
    if (c !== p.jette) { p.jette = c; elCorb.classList.toggle("chaud", c); v.el.classList.toggle("fantome", c); }
  }
  function lacher(v, p) {
    v.tenu = false; v.ptr = null; v.lev.c = 0; v.inc.c = 0;
    v.el.classList.remove("tenu", "fantome");
    document.body.classList.remove("porte"); elCorb.classList.remove("chaud");
    const k = p.cible; if (k) { k.el.classList.remove("accueille"); k.ech.c = 1; activer(k); }
    if (p.jette) return B.jeter(v);
    if (k) return ranger(v, k);
    const vi = p.vit.lire(), lim = 3200;
    v.vx = U.borne(vi.x / cam.z, -lim, lim); v.vy = U.borne(vi.y / cam.z, -lim, lim);
    const garde = v.inc.v * 0.3; v.o.r = U.borne(v.o.r + garde, -28, 28); v.inc.v -= garde;   // l'objet garde un peu de l'angle pris en vol
    S.jouer("pose", U.borne(0.6 + (Math.abs(v.vx) + Math.abs(v.vy)) / 3000, 0.6, 1.3));
    activer(v);
  }
  function envol(v, cx, cy, fin) {            // l'objet file vers un point du monde en rapetissant, puis disparaît
    v.vol = true; v.el.classList.add("bouge"); activer(v);
    const x0 = v.o.x, y0 = v.o.y, e0 = v.ech.v * (1 + 0.075 * v.lev.v), i0 = v.inc.v;
    v.lev.poser(0);
    U.anim(250, (t) => {
      const d = U.douce2(t);
      v.o.x = U.melange(x0, cx, d); v.o.y = U.melange(y0, cy, d); v.ech.v = U.melange(e0, 0.22, d); v.inc.v = i0 * (1 - d);
      placer(v); v.el.style.opacity = (1 - t * t).toFixed(3);
    }, () => { v.vol = false; actives.delete(v); fin(); });
  }
  function ranger(v, k) {
    const o = v.o;
    envol(v, k.o.x + 20, k.o.y, () => {
      oter(v);
      const d = P.donnees(), i = d.objets.indexOf(o); if (i >= 0) d.objets.splice(i, 1);
      k.o.pages.push(o); B.majClasseur(k);
      k.ech.vit = 1.5; activer(k);
      S.jouer("range"); P.sauver(k.o);
      C.dire(`Rangée dans « ${k.o.nom} »`, { libelle: "Annuler", action() { const j = k.o.pages.indexOf(o); if (j >= 0) k.o.pages.splice(j, 1); B.majClasseur(k); o.x = k.o.x + 150; o.y = k.o.y + 30; d.objets.push(o); B.ajouter(o, ecran(k.o.x, k.o.y)); P.sauver(); } });
    });
  }
  B.jeter = function (v) {
    const o = v.o, r = elCorb.getBoundingClientRect(), c = monde(r.left + r.width / 2, r.top + r.height / 2), d = P.donnees();
    const ox = o.x, oy = o.y;
    if (B.selection === v) B.selection = null;
    envol(v, c.x, c.y, () => {
      oter(v);
      const i = d.objets.indexOf(o); if (i >= 0) d.objets.splice(i, 1);
      d.corbeille.push(o); P.sauver();                                  // rien n'est détruit : la corbeille garde tout
      S.jouer("feuille");
      C.dire(o.type === "classeur" ? `Classeur « ${o.nom} » jeté` : (o.type === "photo" ? "Photo jetée" : "Feuille jetée"), {
        libelle: "Annuler", duree: 7000,
        action() { const j = d.corbeille.indexOf(o); if (j >= 0) d.corbeille.splice(j, 1); o.x = ox; o.y = oy; d.objets.push(o); B.ajouter(o, { x: r.left + r.width / 2, y: r.top + r.height / 2 }); P.sauver(); },
      });
    });
  };
  function oter(v) { actives.delete(v); vues.delete(v.o.id); v.el.remove(); }
  B.retirer = function (id) { const v = vues.get(id); if (v) oter(v); };

  // ---------- les doigts, le stylet, la souris ----------
  elB.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    const el = e.target.closest ? e.target.closest(".objet") : null, v = el && el.__vue;
    try { elB.setPointerCapture(e.pointerId); } catch (x) { /* pointeur d'essai */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, bouge: false, vit: new U.Vitesse(), seuil: e.pointerType === "mouse" ? 4 : 9 };
    p.vit.noter(p.x, p.y);
    if (v && !v.vol && e.button === 0) {
      const w = monde(p.x, p.y);
      p.k = "objet"; p.v = v; p.gx = w.x - v.o.x; p.gy = w.y - v.o.y;
      v.vx = v.vy = 0;                                                    // on arrête net un objet qui glissait
      if (e.pointerType !== "mouse" && v.o.type === "classeur")           // appui long (doigt, stylet) sans bouger : le menu du classeur
        p.long = setTimeout(() => { if (ptrs.get(p.id) === p && !p.bouge) { ptrs.delete(p.id); B.menuClasseur(v, p.x, p.y); } }, 550);
    } else {
      p.k = "cam"; cam.vx = cam.vy = 0; cam.ancre = null; cam.zc = cam.z;
      const autres = Array.from(ptrs.values()).filter((q) => q.k === "cam");
      if (autres.length === 1) debutPince(autres[0], p);
    }
    ptrs.set(p.id, p);
    e.preventDefault();
  });
  function debutPince(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w = monde(mx, my);
    pince = { a, b, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: cam.z, wx: w.x, wy: w.y };
  }
  addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY; p.vit.noter(p.x, p.y);
    if (!p.bouge) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) < p.seuil) return;
      p.bouge = true; clearTimeout(p.long);
      if (p.k === "objet") prendre(p.v, p);
    }
    if (p.k === "objet") { survol(p, p.v); lancer(); }
    else if (pince && (pince.a === p || pince.b === p)) {
      const a = pince.a, b = pince.b, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam.z = cam.zc = U.borne(pince.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pince.d0, zmin(), 2.2);
      cam.x = pince.wx - (mx - vw / 2) / cam.z; cam.y = pince.wy - (my - vh / 2) / cam.z;
      appliquerCam();
    } else { cam.x -= dx / cam.z; cam.y -= dy / cam.z; appliquerCam(); }
  });
  function fin(e, annule) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    ptrs.delete(p.id); clearTimeout(p.long);
    if (p.k === "objet") {
      if (p.bouge) lacher(p.v, p);
      else if (!annule) { B.selection = p.v; if (B.surToucher) B.surToucher(p.v); }
    } else if (pince && (pince.a === p || pince.b === p)) {
      pince = null;                                                        // le doigt qui reste continue de promener la table
    } else if (p.bouge && !annule) {
      const vi = p.vit.lire(); cam.vx = -vi.x / cam.z; cam.vy = -vi.y / cam.z; lancer();
    }
  }
  addEventListener("pointerup", (e) => fin(e, false));
  addEventListener("pointercancel", (e) => fin(e, true));
  elB.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.shiftKey) { cam.x += (e.deltaY + e.deltaX) / cam.z; appliquerCam(); return; }
    const w = cam.ancre && Math.abs(cam.ancre.sx - e.clientX) < 2 && Math.abs(cam.ancre.sy - e.clientY) < 2 ? cam.ancre : monde(e.clientX, e.clientY);
    cam.ancre = { sx: e.clientX, sy: e.clientY, wx: w.wx === undefined ? w.x : w.wx, wy: w.wy === undefined ? w.y : w.wy };
    cam.zc = U.borne(cam.zc * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), zmin(), 2.2);
    cam.vx = cam.vy = 0; lancer();
  }, { passive: false });
  elB.addEventListener("contextmenu", (e) => {                             // clic droit sur un classeur : son menu
    e.preventDefault();
    const el = e.target.closest ? e.target.closest(".objet") : null, v = el && el.__vue;
    if (v && v.o.type === "classeur") B.menuClasseur(v, e.clientX, e.clientY);
  });

  // ---------- la couverture d'un classeur : clic droit ou appui long, puis « Changer la couverture » ----------
  let elMenu = null, elGal = null;
  const ICONES = {
    ouvrir: '<svg viewBox="0 0 24 24"><path d="M4 6h7v13H4zM13 6h7v13h-7z"/></svg>',
    couv: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM5 15l4-4 4 4 3-3 3 3M15.5 8.5h.01"/></svg>',
    origine: '<svg viewBox="0 0 24 24"><path d="M8 5L4 9l4 4M4 9h10a5 5 0 010 10h-3"/></svg>',
    fichier: '<svg viewBox="0 0 24 24"><path d="M4 6h6l2 2h8v11H4zM12 11v5M9.5 13.5L12 11l2.5 2.5"/></svg>',
  };
  function fermerMenu() { if (!elMenu) return; const m = elMenu; elMenu = null; m.classList.remove("la"); setTimeout(() => m.remove(), 180); }
  B.menuClasseur = function (v, x, y) {
    if (!v || v.o.type !== "classeur" || v.vol || elGal || vues.get(v.o.id) !== v) return;
    fermerMenu();
    B.selection = v; S.jouer("prise");
    const m = elMenu = U.el("div", "", document.body);
    m.id = "menu-classeur";
    m.innerHTML = `<button data-a="ouvrir">${ICONES.ouvrir}<span>Ouvrir</span></button><button data-a="couv">${ICONES.couv}<span>Changer la couverture</span></button>` +
      (v.o.couv ? `<button data-a="origine">${ICONES.origine}<span>Couverture d'origine</span></button>` : "");
    const l = m.offsetWidth, h = m.offsetHeight, gx = x + l + 10 > vw, gy = y + h + 10 > vh;      // toujours dans l'écran
    m.style.left = U.borne(gx ? x - l : x, 8, Math.max(8, vw - l - 8)) + "px";
    m.style.top = U.borne(gy ? y - h : y, 8, Math.max(8, vh - h - 8)) + "px";
    m.style.transformOrigin = (gx ? "100%" : "0") + " " + (gy ? "100%" : "0");
    requestAnimationFrame(() => m.classList.add("la"));
    m.addEventListener("contextmenu", (e) => e.preventDefault());
    m.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      fermerMenu();
      if (b.dataset.a === "ouvrir") { if (B.surToucher) B.surToucher(v); }
      else if (b.dataset.a === "couv") B.couvertures(v);
      else poserCouverture(v, null);
    });
  };
  addEventListener("pointerdown", (e) => { if (elMenu && !elMenu.contains(e.target)) fermerMenu(); }, true);
  addEventListener("keydown", (e) => {                                     // la galerie et le menu prennent le clavier tant qu'ils sont là
    if (!elMenu && !elGal) return;
    if (e.target && e.target.tagName === "INPUT") return;
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); if (elMenu) fermerMenu(); else B.fermerCouvertures(); }
  }, true);
  async function poserCouverture(v, choix) {
    try { await P.couverture(v.o, choix); }
    catch (e) { console.error(e); if (C.dire) C.dire("La couverture n'a pas pu être posée."); return false; }
    if (vues.get(v.o.id) !== v) return true;
    B.majClasseur(v);
    v.couv.classList.remove("neuve"); void v.couv.offsetWidth; v.couv.classList.add("neuve");     // un éclat, et le classeur sursaute
    devant(v); B.sursaut(v); S.jouer("classeur");
    if (C.dire) C.dire(choix ? `Nouvelle couverture sur « ${v.o.nom} »` : `Couverture d'origine sur « ${v.o.nom} »`);
    return true;
  }
  B.poserCouverture = poserCouverture;
  B.couverturesOuvertes = () => !!elGal;
  B.fermerCouvertures = function () {
    const g = elGal; if (!g) return;
    elGal = null; g.classList.remove("la");
    setTimeout(() => { g.remove(); for (const u of g.__jetables || []) URL.revokeObjectURL(u); }, 260);
  };
  // la galerie : la couverture d'origine, les propositions rangées pour ce classeur, ou une image à soi
  B.couvertures = async function (v) {
    if (elGal || !v || v.o.type !== "classeur") return;
    fermerMenu();
    const g = elGal = U.el("div", "", document.body);
    g.id = "couvertures";
    g.innerHTML = '<div class="carte"><h2>Couverture de « <b></b> »</h2><div class="choix"></div>' +
      `<div class="bas"><button data-a="fichier">${ICONES.fichier}<span>Une image à moi</span></button><button class="ok" data-a="fermer">Fermer</button></div></div>`;
    g.querySelector("h2 b").textContent = v.o.nom;
    const choix = g.querySelector(".choix");
    const livre = (classe, texte, i) => {
      const b = U.el("button", "livre " + classe, choix);
      b.innerHTML = '<i class="dos"></i><i class="etiq"><b></b></i><i class="reflet"></i><span></span>';
      b.querySelector(".etiq b").textContent = v.o.nom; b.querySelector("span").textContent = texte;
      b.style.animationDelay = i * 45 + "ms";
      return b;
    };
    const o = livre("origine" + (v.o.couv ? "" : " choisi"), "D'origine", 0);
    o.style.backgroundColor = v.o.couleur; o.dataset.a = "origine";
    const attente = U.el("p", "attente", choix); attente.textContent = "Je sors les couvertures…";
    requestAnimationFrame(() => g.classList.add("la"));
    let liste = [];
    g.addEventListener("contextmenu", (e) => e.preventDefault());
    g.addEventListener("click", async (e) => {
      if (e.target === g) return B.fermerCouvertures();
      const b = e.target.closest("button"); if (!b || g !== elGal) return;
      const a = b.dataset.a;
      if (a === "fermer") return B.fermerCouvertures();
      if (a === "fichier") { const img = await P.choisirImage(); if (img && g === elGal) { B.fermerCouvertures(); poserCouverture(v, { image: img }); } return; }
      if (b.classList.contains("occupe")) return;
      for (const x of choix.querySelectorAll(".livre")) x.classList.toggle("choisi", x === b);
      b.classList.add("occupe");                                            // l'image vient du disque : le classeur choisi palpite en attendant
      const fait = await poserCouverture(v, a === "origine" ? null : liste[+b.dataset.i]);
      b.classList.remove("occupe");
      if (fait && g === elGal) B.fermerCouvertures();
    });
    try { liste = await P.couvertures(v.o.nom); } catch (e) { liste = []; }
    g.__jetables = liste.filter((c) => c.jetable).map((c) => c.url);
    if (g !== elGal) { for (const u of g.__jetables) URL.revokeObjectURL(u); return; }
    attente.remove();
    liste.forEach((c, i) => {
      const b = livre("image", String(i + 1), i + 1);
      b.style.backgroundImage = `url("${c.url}")`; b.dataset.i = i; b.title = c.nom;
    });
    if (!liste.length) { const p = U.el("p", "attente", choix); p.textContent = "Pas encore de proposition pour ce classeur : prends une image à toi, ou demande des idées de couverture à Nova."; }
  };

  // ---------- l'interface du bureau ----------
  B.init = function (d) { for (const v of Array.from(vues.values())) oter(v); for (const o of d.objets) creerVue(o); appliquerCam(); };
  B.vue = (id) => vues.get(id);
  B.vues = () => Array.from(vues.values());
  B.activer = activer; B.placer = placer; B.devant = devant;
  // une place libre près du milieu de l'écran
  B.placeLibre = function () {
    const c = monde(vw / 2, vh * 0.44);
    const dx = Math.max(200, vw / cam.z / 2 - 110), dy = Math.max(160, vh / cam.z * 0.36 - 60);   // on reste dans ce qu'on voit
    let mieux = c, note = -1;
    for (let i = 0; i < 140; i++) {
      const a = i * 2.4, r = 46 * Math.sqrt(i);
      const x = U.borne(c.x + U.borne(Math.cos(a) * r * 1.5, -dx, dx), 120, ML - 120), y = U.borne(c.y + U.borne(Math.sin(a) * r, -dy, dy), 150, MH - 150);
      let pres = 9;
      for (const v of vues.values()) pres = Math.min(pres, Math.max(Math.abs(v.o.x - x) / 172, Math.abs(v.o.y - y) / 236));
      if (pres >= 1) return { x, y };
      if (pres > note) { note = pres; mieux = { x, y }; }
    }
    return mieux;                                    // table pleine : là où ça recouvre le moins
  };
  // ajoute un objet ; « depuis » (point de l'écran) = il arrive de là en volant
  B.ajouter = function (o, depuis) {
    if (!o.z) o.z = ++zmax; else if (depuis) o.z = ++zmax;
    const v = creerVue(o);
    if (!depuis) return v;
    const d = monde(depuis.x, depuis.y), ax = o.x, ay = o.y, r0 = (Math.random() - 0.5) * 34;
    v.vol = true; v.el.classList.add("bouge"); activer(v);
    U.anim(430, (t) => {
      const e = U.douce(t), haut = Math.sin(Math.PI * t);
      o.x = U.melange(d.x, ax, e); o.y = U.melange(d.y, ay, e) - haut * 46 / cam.z;
      v.ech.v = U.melange(0.3, 1, e); v.inc.v = r0 * (1 - e); v.lev.v = haut;
      placer(v); v.el.style.opacity = Math.min(1, t * 5).toFixed(2);
    }, () => { v.vol = false; o.x = ax; o.y = ay; v.lev.poser(0); v.lev.v = 0.12; v.inc.v = 0; v.ech.v = 1; v.ech.vit = -0.9; v.el.style.opacity = ""; S.jouer("pose"); activer(v); });
    return v;
  };
  // tirer un objet tout neuf hors du tiroir : il naît sous le doigt
  B.sortirSousLeDoigt = function (o, e) {
    const w = monde(e.clientX, e.clientY); o.x = w.x; o.y = w.y; o.z = ++zmax;
    const v = creerVue(o);
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, bouge: true, vit: new U.Vitesse(), seuil: 0, k: "objet", v, gx: 0, gy: 0 };
    ptrs.set(p.id, p); v.ech.v = 0.5; prendre(v, p);
    return v;
  };
  // où est l'objet à l'écran (pour l'ouvrir en grand depuis sa place)
  B.rectEcran = function (v) { const c = ecran(v.o.x, v.o.y); return { x: c.x, y: c.y, l: v.l * cam.z, h: v.h * cam.z, r: v.o.r }; };
  B.cacher = function (v, oui) { v.el.style.visibility = oui ? "hidden" : ""; };
  B.sursaut = function (v) { v.ech.vit = 1.3; activer(v); };
  B.occupe = () => ptrs.size > 0;
})(window.Cartable);
