// Cartable, interface : écrire sur une feuille. Le stylet écrit (pression), le doigt déplace, deux doigts zooment.
"use strict";
(function (C) {
  const U = C.U, T = C.T, S = C.sons, P = C.pont;
  const F = C.feuille = {};
  const el = document.getElementById("ecriture"), sup = el.querySelector(".support"), voile = el.querySelector(".voile");
  const cPap = el.querySelector("canvas.papier"), cPro = el.querySelector("canvas.propre"), cEnc = el.querySelector("canvas.encre");
  const eclat = el.querySelector(".eclat"), outils = el.querySelector(".outils");
  const cNet = el.querySelector("canvas.net"), bascule = el.querySelector(".bascule");
  // Pas de toile « desynchronized » : sur un vrai écran, Windows peut la sortir en superposition matérielle quand la feuille
  // est grande, et le transparent devient noir. Une toile ordinaire, composée avec le reste, ne peut pas faire ça.
  const gP = cPro.getContext("2d"), gE = cEnc.getContext("2d"), gN = cNet.getContext("2d"), gPap = cPap.getContext("2d");
  const etat = { outil: "stylo", couleur: "#1b1b26", surCouleur: T.SURLIGNEURS[0], taille: 2.6, doigtEcrit: true, styletVu: false };
  try { const c = localStorage.getItem("cartable-surligneur"); if (T.SURLIGNEURS.includes(c)) etat.surCouleur = c; } catch (e) { /* pas de stockage : jaune */ }
  // mode du doigt et de la souris : sélection (déplacer, zoomer) par défaut, sinon le dernier mode choisi ; le stylet écrit toujours
  etat.doigtEcrit = false;
  try { etat.doigtEcrit = localStorage.getItem("cartable-doigt") === "ecrit"; } catch (e) { /* pas de stockage : sélection */ }
  F.etat = etat;
  let o = null, ouvert = false, anime = false, occupe = false, rect = null, opt = null, change = false;
  let ol = 840, oh = 1188, e0 = 1, w = 100, h = 100, k = 1, zone = null;
  const vue = { x: 0, y: 0, z: 1 };
  let pile = [], refaits = [], trait = null, pince = null, sale = false;
  const ptrs = new Map();
  F.ouvert = () => ouvert;
  F.page = () => o;

  // ---------- la mise en page ----------
  function mesurer() {
    const W = innerWidth, H = innerHeight, paysage = W > H;
    el.classList.toggle("portrait", !paysage);
    const photo = !!o.image;                               // une photo : la pastille « Original / Au propre » est en haut, la feuille lui laisse la place
    bascule.hidden = !photo;
    zone = paysage ? (photo ? { x: 86, y: 66, l: W - 86 - 70, h: H - 80 } : { x: 86, y: 14, l: W - 86 - 70, h: H - 28 }) : { x: 8, y: 60, l: W - 16, h: H - 60 - 84 };
    ol = o.l || T.PAGE_L; oh = o.h || T.PAGE_H;
    e0 = Math.min(zone.l / ol, zone.h / oh);
    w = ol * e0; h = oh * e0;
    sup.style.width = w.toFixed(1) + "px"; sup.style.height = h.toFixed(1) + "px";
    const lc = Math.round(Math.min(2200, w * (window.devicePixelRatio || 1) * 1.45));
    k = lc / ol;
    for (const c of [cPap, cPro, cEnc]) { c.width = lc; c.height = Math.round(lc * oh / ol); }
  }
  function vueInitiale() {
    const z = 1;   // la page entière, centrée (en paysage elle ne dépasse plus en bas ; pincer pour zoomer)
    vue.z = z; vue.x = zone.x + (zone.l - w * z) / 2; vue.y = z > 1 ? zone.y : zone.y + (zone.h - h) / 2;
  }
  function borner() {
    vue.z = U.borne(vue.z, 0.5, 5);
    vue.x = U.borne(vue.x, 90 - w * vue.z, innerWidth - 90);
    vue.y = U.borne(vue.y, 90 - h * vue.z, innerHeight - 90);
  }
  const forme = (cx, cy, s, r) => `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(5)}) translate(${(-w / 2).toFixed(2)}px,${(-h / 2).toFixed(2)}px)`;
  function appliquer() { sup.style.transform = forme(vue.x + w * vue.z / 2, vue.y + h * vue.z / 2, vue.z, 0); planifierNet(); }
  const versPage = (sx, sy) => [(sx - vue.x) / (e0 * vue.z), (sy - vue.y) / (e0 * vue.z)];

  // Le surlignage est peint sur le papier (toile opaque), sous l'encre : il passe sous le texte. surPeint = le papier en porte.
  let surPeint = false;
  const aSur = () => !!(o && o.traits && o.traits.some((t) => t.s));
  const proOpaque = () => !!(o && o.image && o.propre);     // photo au propre : le scan net recouvre le papier, le surlignage y est peint aussi
  function peindrePapier() { T.rendrePage(o, cPap.width, { toile: cPap, sansEncre: true }); T.dessinerSurlignes(gPap, o.traits, k, o); surPeint = aSur(); }
  function peindreTout() {
    peindrePapier();
    dessinerPropre(); redessinerEncre();
    cPro.style.opacity = o.voirPropre && o.propre ? 1 : 0;
  }
  function dessinerPropre() {
    gP.setTransform(1, 0, 0, 1, 0, 0); gP.clearRect(0, 0, cPro.width, cPro.height);
    if (o.propre) { T.dessinerPropre(gP, o.propre, k, o); gP.setTransform(1, 0, 0, 1, 0, 0); if (proOpaque()) T.dessinerSurlignes(gP, o.traits, k, o); }
    if (ouvert && !anime) planifierNet(60);
  }
  function redessiner() {
    if (surPeint || aSur()) { peindrePapier(); if (proOpaque()) dessinerPropre(); }
    redessinerEncre();
  }
  function redessinerEncre() {
    gE.clearRect(0, 0, cEnc.width, cEnc.height);
    T.dessinerTraits(gE, o.voirPropre && o.propre ? o.traits.slice(o.propre.n || 0) : o.traits, k);
    if (net) peindreNet();
  }

  // ---------- la toile nette ----------
  // Les trois toiles de la feuille sont agrandies par le zoom, jamais redessinées : floues de près, et très grandes pour la
  // carte graphique. La toile nette ne couvre que ce qu'on voit, à la taille exacte de l'écran : elle ne dépasse jamais la
  // fenêtre, quel que soit le zoom, et elle est opaque (photo ou papier), donc jamais de trou noir.
  let net = null, netMinuterie = 0, redimAttente = false;
  function cacherNet() { clearTimeout(netMinuterie); netMinuterie = 0; if (net) { net = null; cNet.style.display = "none"; } }
  function planifierNet(ms) { clearTimeout(netMinuterie); netMinuterie = setTimeout(rendreNet, ms === undefined ? 180 : ms); }
  function rendreNet() {
    netMinuterie = 0;
    if (!ouvert || anime || occupe || !o) return;
    if (trait || pince) return planifierNet(250);
    const z = vue.z, dpr = window.devicePixelRatio || 1;
    const rx0 = Math.max(0, -vue.x / z), ry0 = Math.max(0, -vue.y / z), rx1 = Math.min(w, (innerWidth - vue.x) / z), ry1 = Math.min(h, (innerHeight - vue.y) / z);
    if (rx1 - rx0 < 2 || ry1 - ry0 < 2) return cacherNet();
    let q = z * dpr;
    q = Math.min(q, 4096 / (rx1 - rx0), 4096 / (ry1 - ry0));
    const ox = Math.floor(rx0 * q), oy = Math.floor(ry0 * q), pl = Math.ceil(rx1 * q) - ox, ph = Math.ceil(ry1 * q) - oy;
    if (pl < 2 || ph < 2) return cacherNet();
    if (cNet.width !== pl) cNet.width = pl;
    if (cNet.height !== ph) cNet.height = ph;
    cNet.style.left = (ox / q) + "px"; cNet.style.top = (oy / q) + "px"; cNet.style.width = (pl / q) + "px"; cNet.style.height = (ph / q) + "px";
    net = { K: e0 * q, ox, oy, q };
    if (!peindreNet()) return cacherNet();
    cNet.style.display = "block";
  }
  function peindreNet() {
    const K = net.K, L = ol * K, H = oh * K;
    gN.setTransform(1, 0, 0, 1, -net.ox, -net.oy);
    if (o.image) {
      const e = T.image(o.image);
      if (!e.pret) return false;
      gN.imageSmoothingEnabled = true; gN.imageSmoothingQuality = "high";
      gN.drawImage(e.img, 0, 0, L, H);
    } else T.dessinerPapier(gN, L, H, o.papier);
    if (o.voirPropre && o.propre) { T.dessinerPropre(gN, o.propre, K, o); gN.setTransform(1, 0, 0, 1, -net.ox, -net.oy); T.dessinerSurlignes(gN, o.traits, K, o); T.dessinerTraits(gN, o.traits.slice(o.propre.n || 0), K); }
    else { T.dessinerSurlignes(gN, o.traits, K, o); T.dessinerTraits(gN, o.traits, K); }
    gN.setTransform(1, 0, 0, 1, -net.ox, -net.oy);
    return true;
  }
  F.net = () => (net ? { l: cNet.width, h: cNet.height, K: net.K, visible: cNet.style.display === "block" } : null);
  // la carte graphique a perdu ses images (veille, pilote relancé) ou la fenêtre revient : tout est repeint
  function repeindre() { if (!ouvert || anime || !o) return; peindreTout(); planifierNet(0); }
  for (const c of [cPap, cPro, cEnc, cNet]) c.addEventListener("contextrestored", repeindre);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) repeindre(); });
  function demanderRedessin() { if (sale) return; sale = true; U.boucle.ajouter(() => { sale = false; if (ouvert) redessiner(); return false; }); }

  // ---------- ouvrir et reposer (la feuille part de sa place et y retourne) ----------
  // rectDe() rend { x, y, l, r } : centre, largeur et angle de la feuille à l'écran ; options : { avantRetour(page) -> promesse, fini(page, change) }
  F.ouvrir = function (page, rectDe, options) {
    if (ouvert) return false;
    if (C.partition && C.partition.estPartition(page)) return C.partition.ouvrir(page, rectDe, options);   // photo de partition lue : page Partition (js/partition.js)
    o = page; ouvert = true; anime = true; rect = rectDe; opt = options || {}; change = false;
    if (!o.traits) o.traits = [];
    pile = []; refaits = []; trait = null; pince = null; ptrs.clear();
    cacherNet(); redimAttente = false; eclat.hidden = true;
    el.hidden = false;
    mesurer(); vueInitiale(); peindreTout(); majOutils();
    if (o.image && !T.image(o.image).pret) T.imagePrete(o).then(() => { if (o === page) { peindrePapier(); planifierNet(0); } });
    if (o.propre && o.propre.v === 2 && C.propre) C.propre.preparer(o).then(() => { if (o === page) dessinerPropre(); });   // photo au propre : scan net, polices
    if (o.propre && o.propre.calque && !o.propre.calqueImg) T.image(o.propre.calque).promesse.then((im) => { if (o === page && im) { o.propre.calqueImg = im; dessinerPropre(); } });
    const a = (rect && rect()) || { x: innerWidth / 2, y: innerHeight / 2, l: w * 0.5, r: 0 };
    const bx = vue.x + w * vue.z / 2, by = vue.y + h * vue.z / 2, s0 = a.l / w;
    sup.style.transform = forme(a.x, a.y, s0, a.r); voile.style.opacity = 0;
    void el.offsetWidth; el.classList.add("la");
    S.jouer("feuille");
    U.anim(400, (t) => {
      const d = U.douce(t), ds = U.rebond(t);
      sup.style.transform = forme(U.melange(a.x, bx, d), U.melange(a.y, by, d), s0 * Math.pow(vue.z / s0, ds), a.r * (1 - d));
      voile.style.opacity = Math.min(1, t * 1.6).toFixed(3);
    }, () => { anime = false; if (redimAttente) F.redimensionner(); else appliquer(); });
    return true;
  };
  F.fermer = function () {
    if (!ouvert || anime) return;
    if (trait) finTrait();
    anime = true; el.classList.remove("la"); cacherNet();
    const page = o, b = (rect && rect()) || { x: innerWidth / 2, y: innerHeight / 2, l: w * 0.5, r: 0 };
    const ax = vue.x + w * vue.z / 2, ay = vue.y + h * vue.z / 2, s1 = b.l / w;
    const attente = opt.avantRetour ? Promise.resolve(opt.avantRetour(page, change)).catch(() => {}) : Promise.resolve();
    S.jouer("pose", 0.8);
    U.anim(300, (t) => {
      const d = U.douce2(t);
      sup.style.transform = forme(U.melange(ax, b.x, d), U.melange(ay, b.y, d), vue.z * Math.pow(s1 / vue.z, d), b.r * d);
      voile.style.opacity = (1 - d).toFixed(3);
    }, () => {
      attente.then(() => {
        if (opt.fini) opt.fini(page, change);
        el.hidden = true; ouvert = false; anime = false; o = null; ptrs.clear();
      });
    });
  };
  // la fenêtre change de taille (agrandie, plein écran, tablette tournée) : tout est remesuré et repeint, même si ça arrive pendant l'ouverture
  F.redimensionner = function () {
    if (!ouvert) return;
    if (anime) { redimAttente = true; return; }
    redimAttente = false;
    cacherNet(); mesurer(); vueInitiale(); peindreTout(); appliquer();
  };

  // ---------- écrire ----------
  function pression(ev, tr, x, y) {
    if (ev.pointerType === "pen") return ev.pressure > 0 ? ev.pressure : 0.5;
    const t = U.boucle.estManuel() ? U.maintenant() : ev.timeStamp, dt = t - tr.temps;
    if (dt > 0.5) {
      const v = Math.hypot(x - tr.dx, y - tr.dy) * e0 * vue.z / (dt / 1000);              // pixels par seconde : vite = fin, lent = appuyé
      tr.pr += (U.borne(0.85 - v * 0.0009, 0.25, 0.85) - tr.pr) * 0.3;
      tr.temps = t;
    }
    return tr.pr;
  }
  function debutTrait(p, e) {
    const [x, y] = versPage(e.clientX, e.clientY);
    const gomme = etat.outil === "gomme" || (e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32)));
    if (gomme) { trait = { gomme: true, ptr: p, retires: [] }; gommer(x, y); return; }
    // le surligneur : l'outil choisi, ou le bouton du stylet / le clic droit de la souris tenu pendant le trait
    if (etat.outil === "surligneur" || (e.pointerType !== "touch" && (e.button === 2 || (e.buttons & 2)))) {
      trait = { sur: true, ptr: p, dx: x, dy: y, t: { id: U.id("t"), s: 1, c: etat.surCouleur, e: T.largeurSur(etat.taille), p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.5] } };
      surPeint = true; morceauSur(0);
      return;
    }
    const pr = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.5) : 0.6;
    trait = { ptr: p, pr, dx: x, dy: y, temps: U.boucle.estManuel() ? U.maintenant() : e.timeStamp, t: { id: U.id("t"), c: etat.couleur, e: etat.taille, p: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100) / 100] } };
    T.debutTrait(gE, trait.t, k);
    if (net) T.debutTrait(gN, trait.t, net.K);
  }
  function morceauSur(i) {
    const t = trait.t;
    T.morceauSur(gPap, t, i, k, o);
    if (proOpaque()) T.morceauSur(gP, t, i, k, o);
    if (net) T.morceauSur(gN, t, i, net.K, o);
  }
  // un surlignage presque droit est redressé : une bande bien horizontale sous la ligne de texte
  function redresser(t) {
    const p = t.p, n = p.length / 3; if (n < 3) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sy = 0;
    for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); sy += p[i + 1]; }
    if (x1 - x0 < 30 || y1 - y0 > Math.max(9, 0.07 * (x1 - x0))) return;
    const y = Math.round(sy / n * 10) / 10;
    t.p = [x0, y, 0.5, x1, y, 0.5];
  }
  function point(ev) {
    const tr = trait, [x, y] = versPage(ev.clientX, ev.clientY);
    if (tr.gomme) return gommer(x, y);
    if (tr.sur) {
      if (Math.hypot(x - tr.dx, y - tr.dy) < 1.5) return;
      tr.dx = x; tr.dy = y;
      tr.t.p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.5);
      return morceauSur(tr.t.p.length / 3 - 1);
    }
    if (Math.hypot(x - tr.dx, y - tr.dy) < 0.6) return;
    const pr = pression(ev, tr, x, y);
    tr.dx = x; tr.dy = y;
    tr.t.p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pr * 100) / 100);
    T.morceau(gE, tr.t, tr.t.p.length / 3 - 1, k);
    if (net) T.morceau(gN, tr.t, tr.t.p.length / 3 - 1, net.K);
  }
  function finTrait() {
    const tr = trait; trait = null;
    if (!tr) return;
    if (tr.gomme) { if (tr.retires.length) { pile.push({ t: "retrait", items: tr.retires }); refaits.length = 0; modifie(); } return; }
    if (tr.sur) {
      redresser(tr.t);
      o.traits.push(tr.t); pile.push({ t: "ajout", trait: tr.t }); refaits.length = 0; modifie();
      return redessiner();                                   // repeint propre : bande lissée ou redressée
    }
    T.debutTrait(gE, tr.t, k); T.finTrait(gE, tr.t, k);
    if (net) { T.debutTrait(gN, tr.t, net.K); T.finTrait(gN, tr.t, net.K); }
    o.traits.push(tr.t); pile.push({ t: "ajout", trait: tr.t }); refaits.length = 0; modifie();
  }
  function modifie() { o.v = (o.v || 0) + 1; change = true; P.sauver(o); majOutils(); }
  function oublierPropre() { if (!o.propre) return; o.propre = null; o.voirPropre = false; dessinerPropre(); cPro.style.opacity = 0; majOutils(); }
  function gommer(x, y) {
    const R = 13 / Math.sqrt(vue.z), R2 = R * R, debut = o.voirPropre && o.propre ? (o.propre.n || 0) : 0;
    let touche = false;
    // d'abord l'encre ; le surlignage ne part que si la gomme ne touche aucune écriture à cet endroit (gommer une note posée sur du surligné le laisse)
    for (const sur of [false, true]) {
      if (sur && touche) break;
      for (let i = o.traits.length - 1; i >= debut; i--) {
        const tt = o.traits[i], p = tt.p; let dedans = false;
        if (!!tt.s !== sur) continue;
        if (sur) dedans = T.toucheSur(tt, x, y, R * 0.5);
        else for (let j = 0; j < p.length; j += 3) { const dx = p[j] - x, dy = p[j + 1] - y; if (dx * dx + dy * dy < R2) { dedans = true; break; } }
        if (!dedans) continue;
        if (o.propre && i < (o.propre.n || 0)) oublierPropre();
        trait.retires.push({ i, trait: o.traits[i] }); o.traits.splice(i, 1); touche = true;
      }
    }
    if (touche) demanderRedessin();
  }
  F.action = function (nom) {
    if (!ouvert || anime || occupe) return;
    if (nom === "annuler") {
      const a = pile.pop(); if (!a) return;
      if (a.t === "ajout") { const i = o.traits.indexOf(a.trait); if (i >= 0) { if (o.propre && i < (o.propre.n || 0)) oublierPropre(); o.traits.splice(i, 1); } }
      else for (let j = a.items.length - 1; j >= 0; j--) o.traits.splice(Math.min(a.items[j].i, o.traits.length), 0, a.items[j].trait);
      refaits.push(a); modifie(); redessiner();
    } else if (nom === "refaire") {
      const a = refaits.pop(); if (!a) return;
      if (a.t === "ajout") o.traits.push(a.trait);
      else for (const it of a.items) { const i = o.traits.indexOf(it.trait); if (i >= 0) { if (o.propre && i < (o.propre.n || 0)) oublierPropre(); o.traits.splice(i, 1); } }
      pile.push(a); modifie(); redessiner();
    } else if (nom === "doigt") { etat.doigtEcrit = !etat.doigtEcrit; try { localStorage.setItem("cartable-doigt", etat.doigtEcrit ? "ecrit" : "selection"); } catch (e) { /* tant pis */ } majOutils(); C.dire(etat.doigtEcrit ? "Mode écriture : le doigt et la souris écrivent." : "Mode sélection : on déplace et on zoome, le stylet écrit."); }
    else if (nom === "propre") return auPropre();
  };
  // choisir le surligneur alors qu'il est déjà en main : couleur suivante
  function prendre(nom) {
    if (nom === "surligneur" && etat.outil === "surligneur") choisirSur(T.SURLIGNEURS[(T.SURLIGNEURS.indexOf(etat.surCouleur) + 1) % T.SURLIGNEURS.length]);
    etat.outil = nom;
  }
  function choisirSur(c) { etat.surCouleur = c; try { localStorage.setItem("cartable-surligneur", c); } catch (e) { /* tant pis */ } }
  F.outil = function (nom) { prendre(nom); majOutils(); };

  // ---------- mettre au propre ----------
  async function auPropre() {
    const page = o;
    if (o.voirPropre && o.propre) return basculer(false);
    if (o.image && C.propre) {                             // une photo : scan net tout de suite, ou la version redessinée si elle existe ; l'original reste
      if (!C.propre.estPhoto(o.propre)) o.propre = { v: 2, n: 0, scan: true };
      occupe = true; el.classList.add("cherche");
      await U.attendre(60);
      try { await C.propre.preparer(o); } catch (e) { console.error(e); }
      el.classList.remove("cherche"); occupe = false;
      if (!ouvert || o !== page) return;
      dessinerPropre();
      return basculer(true);
    }
    if (!o.traits.length) return C.dire("Écris d'abord quelque chose.");
    if (o.propre && o.propre.n === o.traits.length) return basculer(true);
    occupe = true; el.classList.add("cherche");
    let r = null;
    try { r = await P.reconnaitre(o); } catch (e) { console.error(e); }
    el.classList.remove("cherche"); occupe = false;
    if (!ouvert || o !== page) return;
    if (!r) return C.dire("La mise au propre n'a pas marché.");
    o.propre = r; dessinerPropre();
    return basculer(true);
  }
  function basculer(vers) {
    occupe = true; o.voirPropre = vers; o.v = (o.v || 0) + 1; change = true;
    cacherNet(); majOutils();
    if (!vers) redessiner();
    cPro.style.opacity = 1; eclat.hidden = false;
    S.jouer("magie");
    return new Promise((ok) => U.anim(760, (t) => {
      const a = (vers ? U.douce2(t) : 1 - U.douce2(t)) * 100;
      cPro.style.clipPath = `inset(0 ${(100 - a).toFixed(2)}% 0 0)`; cEnc.style.clipPath = `inset(0 0 0 ${a.toFixed(2)}%)`;
      eclat.style.opacity = Math.sin(Math.PI * t).toFixed(3); eclat.style.transform = `translate3d(${(a / 100 * w).toFixed(1)}px,0,0)`;
    }, () => {
      cPro.style.clipPath = cEnc.style.clipPath = ""; cPro.style.opacity = vers ? 1 : 0; eclat.style.opacity = 0; eclat.hidden = true;
      if (ouvert) redessiner();
      occupe = false; majOutils(); P.sauver(o); if (ouvert) planifierNet(0); ok();
    }));
  }

  // ---------- les outils ----------
  function majOutils() {
    for (const b of outils.querySelectorAll("button")) {
      const d = b.dataset;
      if (d.outil) { b.classList.toggle("actif", d.outil === etat.outil); if (d.outil === "surligneur") b.style.setProperty("--sur", etat.surCouleur); }
      else if (d.couleur) b.classList.toggle("actif", d.couleur === etat.couleur);
      else if (d.surcouleur) b.classList.toggle("actif", d.surcouleur === etat.surCouleur);
      else if (d.taille) b.classList.toggle("actif", +d.taille === etat.taille);
      else if (d.action === "annuler") b.disabled = !pile.length;
      else if (d.action === "refaire") b.disabled = !refaits.length;
      else if (d.action === "doigt") b.classList.toggle("actif", etat.doigtEcrit);
      else if (d.action === "propre") { b.classList.toggle("actif", !!(o && o.voirPropre)); b.querySelector("span").textContent = o && o.voirPropre ? (o.image ? "Original" : "Mon écriture") : "Au propre"; }
    }
    outils.classList.toggle("sur", etat.outil === "surligneur");   // surligneur en main : ses couleurs remplacent celles de l'encre
    const pr = !!(o && o.voirPropre && o.propre);            // la pastille : le côté allumé est celui qu'on voit
    bascule.classList.toggle("propre", pr);
    for (const b of bascule.querySelectorAll("button")) b.setAttribute("aria-pressed", String((b.dataset.voir === "propre") === pr));
  }
  F.voit = () => (o && o.image ? (o.voirPropre && o.propre ? "propre" : "original") : null);
  bascule.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !ouvert || !o) return;
    if ((b.dataset.voir === "propre") !== !!(o.voirPropre && o.propre)) F.action("propre");
  });
  for (const b of outils.querySelectorAll("[data-couleur] i")) b.style.background = b.parentNode.dataset.couleur;
  for (const b of outils.querySelectorAll("[data-surcouleur] i")) b.style.background = b.parentNode.dataset.surcouleur;
  outils.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !ouvert) return;
    const d = b.dataset;
    if (d.outil) prendre(d.outil);
    else if (d.couleur) { etat.couleur = d.couleur; etat.outil = "stylo"; }
    else if (d.surcouleur) { choisirSur(d.surcouleur); etat.outil = "surligneur"; }
    else if (d.taille) etat.taille = +d.taille;
    else if (d.action) return F.action(d.action);
    majOutils();
  });
  el.querySelector(".fermer").addEventListener("click", () => F.fermer());

  // ---------- stylet, doigts, souris ----------
  el.addEventListener("pointerdown", (e) => {
    if (!ouvert || anime) return;
    if (e.target.closest && e.target.closest(".outils, .fermer, .bascule")) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* pointeur d'essai */ }
    const type = e.pointerType;
    if (type === "pen") etat.styletVu = true;                                      // le stylet écrit sans toucher au mode du doigt
    const p = { id: e.pointerId, type, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, bouge: false, k: "vue", voile: e.target === voile };
    ptrs.set(p.id, p);
    const doigts = Array.from(ptrs.values()).filter((q) => q.type === "touch");
    if (type === "touch" && doigts.length === 2) {
      if (trait && trait.ptr.type === "touch") { trait = null; redessiner(); }                 // deux doigts : on ne trace pas, on déplace
      doigts.forEach((q) => { q.k = "vue"; q.bouge = true; });
      pince = { a: doigts[0], b: doigts[1], d0: Math.hypot(doigts[0].x - doigts[1].x, doigts[0].y - doigts[1].y) || 1, z0: vue.z, p: versPage((doigts[0].x + doigts[1].x) / 2, (doigts[0].y + doigts[1].y) / 2) };
      return;
    }
    const [x, y] = versPage(p.x, p.y), dedans = x > -10 && y > -10 && x < ol + 10 && y < oh + 10;
    const ecrit = type === "pen" || (type === "mouse" && (e.button === 2 || (e.button === 0 && etat.doigtEcrit))) || (type === "touch" && etat.doigtEcrit && doigts.length === 1);   // clic droit = surligner
    if (ecrit && dedans && !trait && !occupe) { p.k = "trait"; debutTrait(p, e); }
  });
  addEventListener("pointermove", (e) => {
    const p = ptrs.get(e.pointerId); if (!p || !ouvert) return;
    if (p.k === "trait" && trait && trait.ptr === p) {
      let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (!evs || !evs.length) evs = [e];
      for (const ev of evs) point(ev);
      p.x = e.clientX; p.y = e.clientY;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.bouge && Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.bouge = true;
    if (pince && (pince.a === p || pince.b === p)) {
      const a = pince.a, b = pince.b, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      vue.z = U.borne(pince.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pince.d0, 0.5, 5);
      vue.x = mx - pince.p[0] * e0 * vue.z; vue.y = my - pince.p[1] * e0 * vue.z;
      borner(); appliquer();
    } else if (p.k === "vue" && p.bouge) { vue.x += dx; vue.y += dy; borner(); appliquer(); }
  });
  function fin(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    ptrs.delete(p.id);
    if (pince && (pince.a === p || pince.b === p)) pince = null;
    if (trait && trait.ptr === p) { if (e.type === "pointercancel" && !trait.gomme) { trait = null; redessiner(); } else finTrait(); return; }
    if (p.k === "vue" && !p.bouge && p.voile && e.type === "pointerup") F.fermer();                // un petit coup à côté de la feuille : on la repose
  }
  addEventListener("pointerup", fin);
  addEventListener("pointercancel", fin);
  el.addEventListener("wheel", (e) => {
    if (!ouvert || anime) return;
    e.preventDefault();
    if (e.ctrlKey) {
      const [px, py] = versPage(e.clientX, e.clientY);
      vue.z = U.borne(vue.z * Math.exp(-e.deltaY * 0.01), 0.5, 5);
      vue.x = e.clientX - px * e0 * vue.z; vue.y = e.clientY - py * e0 * vue.z;
    } else if (e.shiftKey) vue.x -= e.deltaY + e.deltaX;
    else { vue.y -= e.deltaY; vue.x -= e.deltaX; }
    borner(); appliquer();
  }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
})(window.Cartable);
