// Cartable, interface : le démarrage, le tiroir, le clavier, les petits messages, et les outils d'essai.
"use strict";
(function (C) {
  const U = C.U, T = C.T, S = C.sons, P = C.pont, B = C.bureau, F = C.feuille, K = C.classeur;
  const $ = (s) => document.querySelector(s);
  const elMsg = $("#messages"), elAide = $("#aide"), elFps = $("#fps"), elTiroir = $("#tiroir");

  // ---------- les petits messages (avec « Annuler ») ----------
  C.dire = function (texte, o) {
    o = o || {};
    while (elMsg.children.length >= 1) elMsg.firstChild.remove();   // un seul message à la fois : le dernier
    const m = U.el("div", "msg", elMsg);
    U.el("span", "", m).textContent = texte;
    let parti = false;
    const partir = () => { if (parti) return; parti = true; m.classList.remove("la"); setTimeout(() => m.remove(), 260); };
    if (o.action) {
      const b = U.el("button", "", m); b.textContent = o.libelle || "Annuler";
      b.addEventListener("click", () => { if (parti) return; partir(); try { o.action(); } catch (e) { console.error(e); } });
    }
    void m.offsetWidth; m.classList.add("la");
    setTimeout(partir, o.duree || (o.action ? 5200 : 2600));
    return m;
  };

  // ---------- créer : feuille, classeur, photo ----------
  const COULEURS = ["#8d2f37", "#2e6a55", "#2f4f86", "#b0732a", "#5b3f7a", "#3d3d46"];
  function neuf(quoi, papier) {
    const r = (Math.random() - 0.5) * 9;
    if (quoi === "classeur") {
      const n = P.donnees().objets.filter((x) => x.type === "classeur").length;
      return { id: U.id("k"), type: "classeur", nom: "Classeur", couleur: COULEURS[n % COULEURS.length], pages: [], r, x: 0, y: 0 };
    }
    return { id: U.id("f"), type: "feuille", papier: papier || "blanc", traits: [], v: 1, r, x: 0, y: 0 };
  }
  function centreBloc(quoi, papier) {
    const b = elTiroir.querySelector(quoi === "feuille" ? `[data-papier="${papier}"]` : `[data-creer="${quoi}"]`);
    if (!b) return { x: innerWidth / 2, y: innerHeight - 40 };
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  let photoEnCours = false;
  async function creer(quoi, papier) {
    if (F.ouvert() || K.ouvert()) return null;
    if (quoi === "photo") {
      if (photoEnCours) return null;
      photoEnCours = true;
      let ph = null;
      try { ph = await P.scanner(); } catch (e) { console.error(e); }
      photoEnCours = false;
      if (!ph || !ph.image) { if (ph !== null) C.dire("Pas de photo."); return null; }
      const o = { id: U.id("p"), type: "photo", image: ph.image, l: ph.l || 840, h: ph.h || 1188, traits: [], v: 1, r: (Math.random() - 0.5) * 10 };
      if (ph.sha) o.sha = ph.sha;
      await T.imagePrete(o);
      const pl = B.placeLibre(); o.x = pl.x; o.y = pl.y;
      P.donnees().objets.push(o); B.ajouter(o, centreBloc("photo")); P.sauver(o);
      return o;
    }
    const o = neuf(quoi, papier), pl = B.placeLibre();
    o.x = pl.x; o.y = pl.y;
    P.donnees().objets.push(o); B.ajouter(o, centreBloc(quoi, papier)); P.sauver(o);
    if (quoi === "feuille") S.jouer("feuille");
    return o;
  }
  C.creer = creer;

  // le tiroir : un petit coup = l'objet se pose tout seul ; tirer vers le haut = il naît sous le doigt
  let tir = null;
  elTiroir.addEventListener("pointerdown", (e) => {
    const b = e.target.closest ? e.target.closest(".bloc") : null;
    if (!b || tir || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    tir = { id: e.pointerId, b, x0: e.clientX, y0: e.clientY, sorti: false };
    b.classList.add("presse");
  });
  addEventListener("pointermove", (e) => {
    if (!tir || tir.id !== e.pointerId || tir.sorti) return;
    const d = tir.b.dataset;
    if (d.creer === "photo" || F.ouvert() || K.ouvert()) return;
    if (tir.y0 - e.clientY > 8 || Math.hypot(e.clientX - tir.x0, e.clientY - tir.y0) > 16) {
      tir.sorti = true; tir.b.classList.remove("presse");
      const o = neuf(d.creer, d.papier);
      P.donnees().objets.push(o);
      B.sortirSousLeDoigt(o, e);
      if (d.creer === "feuille") S.jouer("feuille");
      tir = null;                                                   // le bureau prend le relais : c'est lui qui suit le doigt
    }
  });
  function finTir(e) {
    if (!tir || tir.id !== e.pointerId) return;
    const t = tir; tir = null;
    t.b.classList.remove("presse");
    if (e.type === "pointerup" && !t.sorti) creer(t.b.dataset.creer, t.b.dataset.papier);
  }
  addEventListener("pointerup", finTir);
  addEventListener("pointercancel", finTir);
  elTiroir.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- toucher un objet du bureau ----------
  B.surToucher = function (v) {
    if (F.ouvert() || K.ouvert()) return;
    if (v.o.type === "classeur") return K.ouvrir(v);
    if (F.ouvrir(v.o, () => B.rectEcran(v), { fini() { B.repeindre(v); B.cacher(v, false); B.sursaut(v); } })) B.cacher(v, true);
  };

  // ---------- le menu ----------
  function majSons() { $("#btn-sons").classList.toggle("actif", S.actif()); }
  $("#btn-sons").addEventListener("click", () => { S.regler(!S.actif()); majSons(); if (S.actif()) S.jouer("pose", 1); C.dire(S.actif() ? "Sons discrets : oui" : "Sons : non"); });
  function aide(oui) { elAide.hidden = !oui; }
  $("#btn-aide").addEventListener("click", () => aide(true));
  elAide.addEventListener("click", (e) => { if (e.target === elAide || e.target.closest(".ok")) aide(false); });
  function majSynchro() {
    const e = P.etat() || {}, el = $("#etat-synchro");
    el.classList.toggle("ligne", !!e.enLigne);
    el.querySelector("b").textContent = e.texte || (e.enLigne ? "Synchronisé" : "Hors ligne");
  }
  C.majSynchro = majSynchro;
  function fluidite() {
    if (U.fps.actif()) { U.fps.arreter(); elFps.hidden = true; }
    else { elFps.hidden = false; elFps.textContent = "…"; U.fps.demarrer(elFps); }
  }

  // ---------- le clavier (gros PC) ----------
  addEventListener("keydown", (e) => {
    const t = e.target, k = e.key, m = e.ctrlKey || e.metaKey;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) { if (k === "Enter" || k === "Escape") { t.blur(); e.preventDefault(); } return; }
    if (k === "F1") { e.preventDefault(); return aide(elAide.hidden); }
    if (!elAide.hidden) { if (k === "Escape" || k === "Enter") aide(false); return; }
    const l = k.length === 1 ? k.toLowerCase() : k;
    if (F.ouvert()) {
      if (k === "Escape") F.fermer();
      else if (m && l === "z" && !e.shiftKey) F.action("annuler");
      else if (m && (l === "y" || (l === "z" && e.shiftKey))) F.action("refaire");
      else if (!m && l === "s") F.outil("stylo");
      else if (!m && l === "g") F.outil("gomme");
      else if (!m && l === "p") F.action("propre");
      else return;
      return e.preventDefault();
    }
    if (K.ouvert()) {
      if (k === "Escape") K.fermer();
      else if (k === "ArrowRight" || k === "PageDown") K.suivant();
      else if (k === "ArrowLeft" || k === "PageUp") K.precedent();
      else if (k === " ") K.fouiller();
      else if (k === "+" || k === "=") K.ajouter();
      else if (k === "Home") K.aller(0);
      else if (k === "End") K.aller(9999);
      else if (k === "Delete" || k === "Backspace") K.jeterPage();
      else if (!m && l === "p") { if (!K.basculerPropre()) return; }
      else return;
      return e.preventDefault();
    }
    if (m || e.altKey) return;
    if (l === "n") creer("feuille", "portees");
    else if (l === "l") creer("feuille", "ligne");
    else if (l === "q") creer("feuille", "quadrille");
    else if (l === "b") creer("feuille", "blanc");
    else if (l === "c") creer("classeur");
    else if (l === "p") creer("photo");
    else if (l === "f") fluidite();
    else if (k === "Delete" || k === "Backspace") { const v = B.selection; if (v && B.vue(v.o.id) === v && !v.vol && !B.occupe()) B.jeter(v); }
    else if (k === "Enter") { const v = B.selection; if (v && B.vue(v.o.id) === v) B.surToucher(v); }
    else return;
    e.preventDefault();
  });

  let redim = 0;
  addEventListener("resize", () => { cancelAnimationFrame(redim); redim = requestAnimationFrame(() => { marquer(); B.redimensionner(); F.redimensionner(); K.redimensionner(); }); });
  function marquer() {
    const etroit = Math.min(innerWidth, innerHeight) < 560;
    document.body.classList.toggle("etroit", etroit);
    document.body.classList.toggle("tactile", U.tactile());
    return etroit;
  }

  // ---------- Nova : « ouvre mon classeur », « envoie la page au téléphone » ----------
  function pngPageCourante() {
    const page = F.page() || K.pageCourante();
    if (!page) return Promise.resolve(null);
    return T.imagePrete(page).then(() => new Promise((ok) => {
      T.rendrePage(page, 1240, { cadreA4: true }).toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a))) : ok(null)), "image/png");
    }));
  }
  C.pngPageCourante = pngPageCourante;
  function brancherNova() {
    const N = window.CartableNoyau;
    if (!N || !N.surNova || P.essai) return;
    N.surNova(async (cmd, r) => {
      if (!cmd || !r) return;
      if (cmd.action === "ouvrir" && r.ok && r.id) {
        await U.attendre(120);                                       // le temps que le bureau se redessine
        const v = B.vue(r.id);
        if (v && !F.ouvert() && !K.ouvert()) B.surToucher(v);
      }
      if ((cmd.action === "importer" || cmd.action === "propre") && r.ok) {      // photo ajoutée par Nova, mise au propre à la voix
        if (r.aReconnaitre && r.id) {                                // écriture au stylet : on ouvre la feuille et on la met au propre
          await U.attendre(120);
          const v = B.vue(r.id);
          if (v && !F.ouvert() && !K.ouvert()) { B.surToucher(v); await U.attendre(700); F.action("propre"); }
          else { r.ok = false; r.erreur = "ouvre d'abord cette feuille"; }
        } else if (r.dit) C.dire(r.dit);
      }
      if (cmd.action === "envoyer-telephone" || cmd.action === "exporter") {
        const png = await pngPageCourante();
        if (png && window.cartableHote && window.cartableHote.envoyerPng) { await window.cartableHote.envoyerPng(png, cmd.action); C.dire(cmd.action === "exporter" ? "Page exportée." : "Page envoyée au téléphone."); }
        else if (!png) C.dire("Ouvre d'abord une page.");
      }
    });
  }

  // ---------- démarrage ----------
  async function demarrer() {
    const etroit = marquer();
    // la table : vraie texture de bois, sinon un bois de secours
    const bois = new Image();
    bois.onerror = () => { $("#monde").style.backgroundImage = `url(${T.boisSecours()})`; };
    bois.src = "textures/bois.jpg";
    for (const b of elTiroir.querySelectorAll(".mini.papier")) b.style.backgroundImage = `url(${T.rendrePage({ papier: b.parentNode.dataset.papier }, 96).toDataURL()})`;
    let d;
    try { d = await P.charger(etroit); } catch (e) { console.error(e); d = P.donnees(); C.dire("Le cartable n'a pas pu être relu."); }
    if (P.polices) await Promise.race([P.polices.catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);   // les belles écritures prêtes avant les miniatures
    B.init(d);
    B.cadrer(etroit ? 0.62 : Math.max(1, Math.min(innerWidth / 1500, 1.25)));
    majSons(); majSynchro();
    // un autre appareil (ou Nova) a changé quelque chose : on redessine dès que les mains sont libres
    let aRefaire = false;
    const refaire = () => {
      if (!aRefaire) return;
      if (F.ouvert() || K.ouvert() || B.occupe()) return void setTimeout(refaire, 400);
      aRefaire = false; B.init(P.donnees());
    };
    P.surChangement(() => { majSynchro(); if (K.ouvert()) K.rafraichir(); aRefaire = true; refaire(); });
    setInterval(majSynchro, 3000);
    brancherNova();
    document.body.classList.add("pret");
    C.pret = true;
  }

  // ---------- outils d'essai (seulement avec ?essai=1) : de faux doigts, une horloge à la main ----------
  if (P.essai) {
    const ev = (type, x, y, o) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: (o && o.id) || 7, pointerType: (o && o.type) || "mouse",
      pressure: type === "pointerup" ? 0 : (o && o.pression) || 0.5, button: (o && o.bouton) || 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true,
    });
    const E = C.essai = {
      bas(x, y, o) { (document.elementFromPoint(x, y) || document.body).dispatchEvent(ev("pointerdown", x, y, o)); },
      bouge(x, y, o) { window.dispatchEvent(ev("pointermove", x, y, o)); },
      haut(x, y, o) { window.dispatchEvent(ev("pointerup", x, y, o)); },
      toucher(x, y, o) { E.bas(x, y, o); E.haut(x, y, o); },
      manuel(oui) { U.boucle.manuel(oui); },
      avancer(ms) { U.boucle.avancer(ms); },
      // horloge manuelle : un geste de (x0,y0) à (x1,y1) en « ms » ; o.garde = ne relâche pas
      glisser(x0, y0, x1, y1, ms, o) {
        o = o || {};
        E.bas(x0, y0, o);
        const n = Math.max(2, Math.round((ms || 240) / 8));
        for (let i = 1; i <= n; i++) { const t = i / n; E.bouge(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, o); U.boucle.avancer(8); }
        if (!o.garde) E.haut(x1, y1, o);
      },
      // temps réel : le même geste image par image, avec la mesure de fluidité ; rend { images, moyenne, mediane, bas1, pire, lentes }
      glisserReel(x0, y0, x1, y1, ms, o) {
        o = o || {};
        return new Promise((ok) => {
          E.bas(x0, y0, o);
          let t0 = 0;
          U.fps.demarrer();
          const pas = (t) => {
            if (!t0) t0 = t;
            const a = Math.min(1, (t - t0) / ms), d = o.allerRetour ? Math.sin(Math.PI * a) : a;
            E.bouge(x0 + (x1 - x0) * d + (o.onde ? Math.sin(a * 40) * o.onde : 0), y0 + (y1 - y0) * d + (o.onde ? Math.cos(a * 31) * o.onde : 0), o);
            if (a < 1) return requestAnimationFrame(pas);
            E.haut(o.allerRetour ? x0 : x1, o.allerRetour ? y0 : y1, o);
            let reste = o.suite === undefined ? 30 : o.suite;                 // on mesure aussi l'élan qui suit
            const fin = () => (reste-- > 0 ? requestAnimationFrame(fin) : ok(U.fps.arreter()));
            fin();
          };
          requestAnimationFrame(pas);
        });
      },
      // mesure pendant « ms » sans rien faire d'autre (une animation déjà lancée)
      mesurer(ms) { return new Promise((ok) => { U.fps.demarrer(); setTimeout(() => ok(U.fps.arreter()), ms); }); },
      etat() { return { pret: !!C.pret, feuille: F.ouvert(), classeur: K.etat(), objets: P.donnees().objets.length, corbeille: P.donnees().corbeille.length, cam: { x: B.cam.x, y: B.cam.y, z: B.cam.z }, boucle: U.boucle.actifs() }; },
    };
  }

  demarrer();
})(window.Cartable);
