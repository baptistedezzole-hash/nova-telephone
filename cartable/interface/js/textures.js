// Cartable, interface : le papier (portées, ligné, carreaux, blanc), l'encre à pression, le rendu d'une page.
"use strict";
(function (C) {
  const U = C.U;
  const T = C.T = {};
  T.PAGE_L = 840; T.PAGE_H = 1188;                 // une page A4 en unités de page (4 unités = 1 mm)
  T.PAPIER = "#fbf8f0";

  // ---- grain du papier (une petite tuile de bruit, faite une seule fois) ----
  let grain = null;
  T.grain = function () {
    if (grain) return grain;
    const c = U.toile(160, 160), g = c.getContext("2d"), d = g.createImageData(160, 160);
    let s = 12345;
    const h = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < d.data.length; i += 4) {
      const v = h();
      const clair = v > 0.5;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = clair ? 255 : 90;
      d.data[i + 3] = Math.floor((clair ? 26 : 16) * h());
    }
    g.putImageData(d, 0, 0);
    grain = c;
    return c;
  };
  T.grainUrl = () => T.grain().toDataURL("image/png");

  // ---- bois de secours si la vraie texture manque ----
  T.boisSecours = function () {
    const L = 1024, H = 768, c = U.toile(L, H), g = c.getContext("2d");
    const f = g.createLinearGradient(0, 0, 0, H); f.addColorStop(0, "#8c5c38"); f.addColorStop(1, "#7a4d2d");
    g.fillStyle = f; g.fillRect(0, 0, L, H);
    let s = 77; const h = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 1100; i++) {
      const y = h() * H, a1 = 2 + h() * 7, f1 = 0.002 + h() * 0.004, p1 = h() * 9, a2 = h() * 2, f2 = 0.01 + h() * 0.02, p2 = h() * 9;
      g.strokeStyle = h() > 0.45 ? `rgba(48,26,10,${0.04 + h() * 0.13})` : `rgba(226,170,110,${0.03 + h() * 0.09})`;
      g.lineWidth = 0.5 + h() * 2.4;
      g.beginPath();
      for (let x = -8; x <= L + 8; x += 12) { const yy = y + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2 + p2) * a2; if (x < 0) g.moveTo(x, yy); else g.lineTo(x, yy); }
      g.stroke();
    }
    return c.toDataURL("image/jpeg", 0.9);
  };

  // ---- le papier ----
  T.dessinerPapier = function (g, l, h, type) {
    const k = l / T.PAGE_L;
    g.fillStyle = T.PAPIER; g.fillRect(0, 0, l, h);
    g.save();
    g.fillStyle = g.createPattern(T.grain(), "repeat"); g.fillRect(0, 0, l, h);
    g.restore();
    const ligne = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(x0 * k, y0 * k); g.lineTo(x1 * k, y1 * k); g.stroke(); };
    const hp = h / k;
    if (type === "portees") {
      g.strokeStyle = "rgba(38,38,52,0.78)"; g.lineWidth = Math.max(0.6, 1.15 * k);
      const haut = 104, pas = 104, e = 11, n = Math.floor((hp - haut - 40) / pas);
      for (let s = 0; s < n; s++) {
        const y = haut + s * pas;
        for (let i = 0; i < 5; i++) ligne(58, y + i * e, T.PAGE_L - 58, y + i * e);
        ligne(58, y, 58, y + 4 * e); ligne(T.PAGE_L - 58, y, T.PAGE_L - 58, y + 4 * e);
      }
    } else if (type === "ligne") {
      g.strokeStyle = "rgba(70,110,190,0.42)"; g.lineWidth = Math.max(0.5, 1 * k);
      for (let y = 132; y < hp - 40; y += 34) ligne(0, y, T.PAGE_L, y);
      g.strokeStyle = "rgba(206,60,72,0.5)"; ligne(112, 0, 112, hp);
    } else if (type === "quadrille") {
      g.strokeStyle = "rgba(70,120,190,0.26)"; g.lineWidth = Math.max(0.4, 0.8 * k);
      for (let y = 20; y < hp; y += 20) ligne(0, y, T.PAGE_L, y);
      for (let x = 20; x < T.PAGE_L; x += 20) ligne(x, 0, x, hp);
      g.strokeStyle = "rgba(70,120,190,0.4)";
      for (let y = 100; y < hp; y += 100) ligne(0, y, T.PAGE_L, y);
      for (let x = 100; x < T.PAGE_L; x += 100) ligne(x, 0, x, hp);
    }
  };

  // ---- l'encre : largeur selon la pression, courbes lissées ----
  // un trait : { id, c: couleur, e: épaisseur, p: [x, y, pression, x, y, pression, ...] } en unités de page
  const largeur = (t, pr) => t.e * (0.32 + 1.36 * pr);
  T.debutTrait = function (g, t, k) { g.strokeStyle = t.c; g.fillStyle = t.c; g.lineCap = "round"; g.lineJoin = "round"; };
  // dessine le morceau qui se termine au point i (i >= 1) : du milieu précédent au milieu suivant
  T.morceau = function (g, t, i, k) {
    const p = t.p, a = 3 * (i - 1), b = 3 * i;
    const mx = (p[a] + p[b]) / 2, my = (p[a + 1] + p[b + 1]) / 2;
    let dx, dy;
    if (i === 1) { dx = p[0]; dy = p[1]; } else { dx = (p[a - 3] + p[a]) / 2; dy = (p[a - 2] + p[a + 1]) / 2; }
    g.lineWidth = Math.max(0.5, largeur(t, (p[a + 2] + p[b + 2]) / 2) * k);
    g.beginPath(); g.moveTo(dx * k, dy * k); g.quadraticCurveTo(p[a] * k, p[a + 1] * k, mx * k, my * k); g.stroke();
  };
  T.finTrait = function (g, t, k) {
    const p = t.p, n = p.length / 3;
    if (n === 1) { g.beginPath(); g.arc(p[0] * k, p[1] * k, Math.max(0.5, largeur(t, p[2]) * k * 0.55), 0, 7); g.fill(); return; }
    const a = 3 * (n - 2), b = 3 * (n - 1);
    g.lineWidth = Math.max(0.5, largeur(t, p[b + 2]) * k);
    g.beginPath(); g.moveTo((p[a] + p[b]) / 2 * k, (p[a + 1] + p[b + 1]) / 2 * k); g.lineTo(p[b] * k, p[b + 1] * k); g.stroke();
  };
  T.dessinerTrait = function (g, t, k) {
    T.debutTrait(g, t, k);
    const n = t.p.length / 3;
    for (let i = 1; i < n; i++) T.morceau(g, t, i, k);
    T.finTrait(g, t, k);
  };
  T.dessinerTraits = function (g, traits, k) { if (traits) for (const t of traits) T.dessinerTrait(g, t, k); };

  // ---- la version « au propre » rendue par la reconnaissance ----
  // formes acceptées : { calque: image/toile transparente à la taille de la page } | { lignes: [{x,y,h,texte}] } | { traits: [...] }
  T.POLICE_BELLE = '"Segoe Print", "Segoe Script", "Ink Free", "Bradley Hand", "Noteworthy", cursive';
  T.dessinerPropre = function (g, pr, k, o) {
    if (!pr) return;
    if (pr.v === 2 && C.propre) return C.propre.dessiner(g, pr, k, o || {});   // photo mise au propre (propre.js)
    if (pr.calqueImg) g.drawImage(pr.calqueImg, 0, 0, (o.l || T.PAGE_L) * k, (o.h || T.PAGE_H) * k);
    if (pr.traits) T.dessinerTraits(g, pr.traits, k);
    if (pr.belle && window.BelleEcriture) { g.save(); g.scale(k, k); window.BelleEcriture.dessiner(g, pr.belle, { couleur: pr.couleur || "#1b1b26" }); g.restore(); }
    if (pr.musique && window.Musique && pr.musique.symboles) { g.save(); g.scale(k, k); window.Musique.dessiner(g, pr.musique, pr.musique.portees, { couleur: pr.couleur || "#14141c" }); g.restore(); }
    if (pr.garder && o && o.traits) for (const i of pr.garder) if (o.traits[i]) T.dessinerTrait(g, o.traits[i], k);   // ce que la reconnaissance n'a pas compris reste tel quel
    if (pr.lignes) {
      g.fillStyle = pr.couleur || "#1b1b26"; g.textBaseline = "alphabetic";
      for (const li of pr.lignes) { g.font = `${(li.h || 26) * k}px ${T.POLICE_BELLE}`; g.fillText(li.texte, li.x * k, li.y * k); }
    }
  };

  // ---- images des photos (chargées une fois) ----
  const images = new Map();
  T.image = function (src) {
    let e = images.get(src);
    if (!e) {
      e = { img: new Image(), pret: false, attente: [] };
      e.promesse = new Promise((ok) => { e.img.onload = () => { e.pret = true; ok(e.img); }; e.img.onerror = () => ok(null); });
      e.img.src = src; images.set(src, e);
    }
    return e;
  };

  // ---- une page entière sur une toile ----
  // options : cadreA4 (la photo est posée dans une page A4), sansEncre
  T.rendrePage = function (o, largeur_, options) {
    options = options || {};
    const ol = o.l || T.PAGE_L, oh = o.h || T.PAGE_H;
    const cadre = options.cadreA4 && Math.abs(oh / ol - T.PAGE_H / T.PAGE_L) > 0.01;
    const l = Math.round(largeur_), h = Math.round(largeur_ * (cadre ? T.PAGE_H / T.PAGE_L : oh / ol));
    const c = options.toile || U.toile(l, h);
    if (c.width !== l || c.height !== h) { c.width = l; c.height = h; }
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    let k = l / ol;
    if (cadre) {
      T.dessinerPapier(g, l, h, "blanc");
      k = Math.min(l / ol, h / oh) * 0.94;
      g.translate((l - ol * k) / 2, (h - oh * k) / 2);
    }
    if (o.image) {
      const e = T.image(o.image);
      if (e.pret) g.drawImage(e.img, 0, 0, ol * k, oh * k);
      else { g.fillStyle = "#e9e4d8"; g.fillRect(0, 0, ol * k, oh * k); }
    } else if (!cadre) T.dessinerPapier(g, l, h, o.papier);
    else { g.save(); g.beginPath(); g.rect(0, 0, ol * k, oh * k); g.clip(); T.dessinerPapier(g, ol * k, oh * k, o.papier); g.restore(); }
    if (!options.sansEncre) {
      if (o.propre && o.voirPropre) { T.dessinerPropre(g, o.propre, k, o); if (o.traits) T.dessinerTraits(g, o.traits.slice(o.propre.n || 0), k); }   // ce qui a été écrit après reste par-dessus
      else T.dessinerTraits(g, o.traits, k);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c;
  };
  T.imagePrete = (o) => {
    const p = o.image ? T.image(o.image).promesse : Promise.resolve();
    return o.voirPropre && o.propre && o.propre.v === 2 && C.propre ? p.then(() => C.propre.preparer(o)) : p;   // scan net et polices prêts
  };

  // ---- image d'une page pour le classeur (URL de blob, gardée tant que la page ne change pas) ----
  const urls = new Map();
  T.urlPage = function (o) {
    const e = urls.get(o.id);
    const v = (o.v || 0) + (o.voirPropre ? 0.5 : 0);
    if (e && e.v === v) return e.promesse;
    const n = { v, url: null };
    n.promesse = T.imagePrete(o).then(() => new Promise((ok) => {
      const c = T.rendrePage(o, 1120, { cadreA4: true });
      c.toBlob((b) => { n.url = URL.createObjectURL(b); if (e && e.url) setTimeout(() => URL.revokeObjectURL(e.url), 4000); ok(n.url); }, "image/jpeg", 0.92);
    }));
    urls.set(o.id, n);
    return n.promesse;
  };
  T.urlPrete = (o) => { const e = urls.get(o.id); return e && e.url && e.v === (o.v || 0) + (o.voirPropre ? 0.5 : 0) ? e.url : null; };
})(window.Cartable);
