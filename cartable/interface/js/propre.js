// Cartable, interface : la « mise au propre » d'une photo ou d'un scan (agent D).
// Deux étages, l'original n'est jamais touché :
//   { v: 2, n: 0, scan: true }                  le scan net : fond blanc, traits nets, redressé (calculé ici, rien n'est inventé)
//   { v: 2, n: 0, portees: {...}, elements: [] } la feuille redessinée : mêmes mots, mêmes signes, à la même place, en belle écriture
// Positions x en fraction de la largeur, y en fraction de la hauteur, tailles de texte s en fraction de la largeur,
// interligne e en fraction de la hauteur. Le format complet est dans API.md (« Mise au propre d'une photo »).
"use strict";
(function (C) {
  const T = C.T, P = C.pont;
  const R = C.propre = {};
  let ENCRE = "#20212b"; const DOUTE = "rgba(196,120,40,0.85)";
  const MAIN = '"Cartable Caveat", "Segoe Print", "Ink Free", cursive';
  const DEGRE = 'Georgia, "Times New Roman", serif';

  // ---------- le scan net (une fois par image) ----------
  const scans = new Map();   // adresse de l'image -> { toile, promesse }
  function aire(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], s = q[(i + 1) % 4]; a += p.x * s.y - s.x * p.y; } return Math.abs(a) / 2; }
  function scanDe(src) {
    let e = scans.get(src);
    if (e) return e;
    e = { toile: null };
    e.promesse = T.image(src).promesse.then((img) => {
      const Sc = window.Scanner;
      if (!img || !Sc) return null;
      let d = Sc.depuisImage(img, 1800);
      try {                                             // redressé seulement si la feuille est nettement vue dans la photo
        const det = Sc.detecter(d), part = det && det.coins ? aire(det.coins) / (d.width * d.height) : 0;
        if (det && det.confiance >= 0.55 && part > 0.3 && part < 0.93) d = Sc.redresser(d, det.coins, { largeur: d.width, hauteur: d.height });
      } catch (x) { console.warn("[cartable] redressement", x); }
      e.toile = Sc.versCanvas(Sc.nettoyer(d, "couleur"));
      return e.toile;
    }).catch((x) => { console.error("[cartable] scan net", x); return null; });
    scans.set(src, e);
    return e;
  }
  R.estPhoto = (pr) => !!pr && pr.v === 2;
  R.preparer = function (o) {
    const pr = o && o.propre;
    if (!R.estPhoto(pr)) return Promise.resolve();
    const t = [Promise.resolve(P && P.polices).catch(() => {})];
    if (o.image && !Array.isArray(pr.elements)) t.push(scanDe(o.image).promesse);
    return Promise.all(t);
  };

  // ---------- le dessin ----------
  const txt = (s) => (typeof s === "string" ? { x: s } : s || { x: "" });
  function mesurer(g, seg, px) {
    let l = 0;
    for (const brut of seg) {
      const s = txt(brut);
      g.font = police(s, px);
      s._l = g.measureText(String(s.x)).width;
      if (s.e) { g.font = police(s, px * 0.6); s._le = g.measureText(String(s.e)).width + px * 0.04; } else s._le = 0;
      l += s._l + s._le;
    }
    return l;
  }
  let imprime = "";                                      // "imprime" / "italique" : texte imprimé d'une partition (pas de la main)
  const police = (s, px) => (s.d ? `${s.g ? "bold " : ""}${(px * 0.8).toFixed(2)}px ${DEGRE}`
    : imprime ? `${imprime === "italique" ? "italic " : ""}${s.g ? "bold " : ""}${(px * 0.8).toFixed(2)}px ${DEGRE}` : `${s.g ? "bold " : ""}${px.toFixed(2)}px ${MAIN}`);
  // couleurs d'origine (tableau blanc, stylo vert…) : liste fermée, rien d'autre n'est accepté
  const COULEURS = { noir: ENCRE, bleu: "#1d4fa8", rouge: "#c0282d", vert: "#1f7a3a" };
  // ---------- musique (police Bravura, normes SMuFL : 1 interligne = e) ----------
  const G = { sol: 0xE050, fa: 0xE062, ut: 0xE05C, ronde: 0xE0A2, blanche: 0xE0A3, noire: 0xE0A4, "#": 0xE262, b: 0xE260, n: 0xE261,
    soupir: 0xE4E5, "demi-soupir": 0xE4E6, pause: 0xE4E3, "demi-pause": 0xE4E4, point: 0xE1E7, crocheH: 0xE240, crocheB: 0xE241, C: 0xE08A, "C|": 0xE08B };
  function glyphe(g, code, x, y, e, centre) { g.font = `${(4 * e).toFixed(2)}px Bravura`; g.textBaseline = "alphabetic"; g.textAlign = centre ? "center" : "left"; g.fillText(String.fromCharCode(code), x, y); }
  // ligne de la clé, en interlignes depuis le haut de la portée : sol sur la 2e ligne, fa sur la 4e, ut sur la ligne donnée (3 = alto)
  const ligneCle = (el) => (el.k === "fa" ? 1 : el.k === "ut" || el.k === "ut3" || el.k === "ut4" ? 5 - (el.k === "ut4" ? 4 : (el.l || 3)) : 3);
  function ecrire(g, seg, x, y, px, centre) {
    const segs = seg.map(txt), total = mesurer(g, segs, px);
    if (centre) x -= total / 2;
    g.textBaseline = "alphabetic"; g.textAlign = "left";
    for (const s of segs) {
      const l = s._l + s._le;
      g.fillStyle = ENCRE; g.font = police(s, px);
      g.fillText(String(s.x), x, y);
      if (s.e) { g.font = police(s, px * 0.6); g.fillText(String(s.e), x + s._l + px * 0.04, y - px * 0.38); }
      g.lineCap = "round"; g.strokeStyle = ENCRE; g.lineWidth = Math.max(0.8, px * 0.05);
      const debut = x + (String(s.x).length - String(s.x).trimStart().length) * px * 0.2, fin = x + l - (String(s.x).length - String(s.x).trimEnd().length) * px * 0.2;
      if (s.s === 1 || s.s === 2 || s.s === 3) for (let i = 0; i < s.s; i++) { g.beginPath(); g.moveTo(debut, y + px * (0.16 + 0.13 * i)); g.lineTo(fin, y + px * (0.16 + 0.13 * i)); g.stroke(); }
      if (s.s === "arc") { g.beginPath(); g.moveTo(debut, y + px * 0.14); g.quadraticCurveTo((debut + fin) / 2, y + px * 0.42, fin, y + px * 0.14); g.stroke(); }
      if (s.o) { g.beginPath(); g.ellipse((debut + fin) / 2, y - px * 0.2, (fin - debut) / 2 + px * 0.34, px * 0.56, -0.06, 0, Math.PI * 2); g.stroke(); }
      if (s.i) {                                         // mot incertain : petit pointillé discret, le mot reste tel quel
        g.save(); g.strokeStyle = DOUTE; g.lineWidth = Math.max(0.8, px * 0.045); g.setLineDash([px * 0.05, px * 0.14]);
        g.beginPath(); g.moveTo(debut, y + px * 0.2); g.lineTo(fin, y + px * 0.2); g.stroke(); g.restore();
      }
      x += l;
    }
    return total;
  }
  function chemin(g, p, W, H) {
    g.beginPath(); g.moveTo(p[0] * W, p[1] * H);
    if (p.length === 4) g.lineTo(p[2] * W, p[3] * H);
    else {
      for (let i = 2; i < p.length - 2; i += 2) g.quadraticCurveTo(p[i] * W, p[i + 1] * H, (p[i] + p[i + 2]) / 2 * W, (p[i + 1] + p[i + 3]) / 2 * H);
      g.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
    }
  }
  function portee(g, x0, x1, y, e, W, H) { for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(x0 * W, (y + i * e) * H); g.lineTo(x1 * W, (y + i * e) * H); g.stroke(); } }

  R.dessiner = function (g, pr, k, o) {
    const W = (o && o.l || T.PAGE_L) * k, H = (o && o.h || T.PAGE_H) * k;
    if (!Array.isArray(pr.elements)) {                   // étage 1 : le scan net
      const e = o && o.image ? scans.get(o.image) : null;
      if (e && e.toile) g.drawImage(e.toile, 0, 0, W, H);
      else if (o && o.image && T.image(o.image).pret) g.drawImage(T.image(o.image).img, 0, 0, W, H);
      return;
    }
    T.dessinerPapier(g, W, H, "blanc");                  // étage 2 : la feuille redessinée, opaque (elle couvre la photo)
    g.save();
    g.lineCap = "round"; g.lineJoin = "round";
    const f = pr.portees;
    if (f && f.n > 0 && f.n < 40) {                      // le papier à musique d'origine, en pâle
      g.strokeStyle = "rgba(60,72,104,0.2)"; g.lineWidth = Math.max(0.5, W * 0.0011);
      for (let i = 0; i < f.n; i++) portee(g, f.x0, f.x1, f.y0 + i * f.pas, f.e, W, H);
    }
    for (const el of pr.elements) {
      if (!el) continue;
      ENCRE = COULEURS[el.col] || COULEURS.noir;
      g.strokeStyle = ENCRE; g.fillStyle = ENCRE; g.lineWidth = Math.max(0.8, W * (el.ep || 0.0024));
      const px = (el.s || 0.04) * W;
      if (el.t === "ligne") {                            // l = largeur d'origine (le texte s'y ajuste), a = pente d'origine (radians)
        let p = px;
        imprime = el.f === "imprime" || el.f === "italique" ? el.f : "";
        if (el.l > 0) { const m = mesurer(g, (el.seg || []).map(txt), px); if (m > 0) p = Math.min(px * 1.6, Math.max(px * 0.6, px * el.l * W / m)); }
        if (el.a) { g.save(); g.translate(el.x * W, el.y * H); g.rotate(el.a); ecrire(g, el.seg || [], 0, 0, p, !!el.c); g.restore(); }
        else ecrire(g, el.seg || [], el.x * W, el.y * H, p, !!el.c);
        imprime = "";
      }
      else if (el.t === "barre") {                       // barre de mesure : simple, double, fin, reprises (rep-d = :||, rep-g = ||:, rep-gd = :||:)
        const e = (el.e || 0.01) * H, x = el.x * W, y0 = el.y * H, y1 = (el.y1 > el.y ? el.y1 : el.y + 4 * (el.e || 0.01)) * H;
        const fin = e * 0.5, fil = Math.max(0.7, e * 0.16), k = String(el.k || "simple");
        const ligne = (xx, ep) => { g.fillRect(xx - ep / 2, y0, ep, y1 - y0); };
        const points = (xx) => { for (const t of (Array.isArray(el.ys) ? el.ys : [el.y])) { glyphe(g, G.point, xx, t * H + 1.5 * e, e, true); glyphe(g, G.point, xx, t * H + 2.5 * e, e, true); } };
        if (k === "simple") ligne(x, fil);
        else if (k === "double") { ligne(x - e * 0.35, fil); ligne(x + e * 0.35, fil); }
        else if (k === "fin" || k === "rep-d") { ligne(x - e * 0.55, fil); ligne(x + e * 0.1, fin); if (k === "rep-d") points(x - e * 1.1); }
        else if (k === "rep-g") { ligne(x - e * 0.1, fin); ligne(x + e * 0.55, fil); points(x + e * 1.1); }
        else if (k === "rep-gd") { ligne(x - e * 0.5, fil); ligne(x, fin); ligne(x + e * 0.5, fil); points(x - e * 1.05); points(x + e * 1.05); }
      } else if (el.t === "alt") {                      // altération (aussi l'armure) : # b n à la hauteur pos de la portée
        const e = (el.e || 0.01) * H;
        if (G[el.a] && el.a.length === 1) glyphe(g, G[el.a], el.x * W, el.y * H + 4 * e - (el.pos || 0) * e / 2, e, true);
      } else if (el.t === "silence") {                  // soupir, demi-soupir, pause, demi-pause (posés au milieu de la portée)
        const e = (el.e || 0.01) * H, v = String(el.v || "soupir");
        const dy = v === "pause" ? 1 : v === "demi-pause" ? 2 : 2;
        if (G[v]) glyphe(g, G[v], el.x * W, el.y * H + dy * e, e, true);
      } else if (el.t === "mesure") {                   // chiffrage : haut/bas (3/4) ou C, C|
        const e = (el.e || 0.01) * H;
        if (el.c === "C" || el.c === "C|") glyphe(g, G[el.c], el.x * W, el.y * H + 2 * e, e, true);
        else {
          const chif = (n, y) => { const s = String(n == null ? "" : n).replace(/[^0-9]/g, "").slice(0, 2); for (let i = 0; i < s.length; i++) glyphe(g, 0xE080 + +s[i], el.x * W + (i - (s.length - 1) / 2) * e * 1.9, y, e, true); };
          chif(el.haut, el.y * H + e); chif(el.bas, el.y * H + 3 * e);
        }
      } else if (el.t === "poutre") {                   // barre de croches : de (x0,y0) à (x1,y1), épaisseur un demi-interligne
        const p = el.p, e = (el.e || 0.01) * H;
        if (Array.isArray(p) && p.length === 4) { const ep = e * 0.5 * (el.h === -1 ? -1 : 1); g.beginPath(); g.moveTo(p[0] * W, p[1] * H); g.lineTo(p[2] * W, p[3] * H); g.lineTo(p[2] * W, p[3] * H + ep); g.lineTo(p[0] * W, p[1] * H + ep); g.closePath(); g.fill(); }
      }
      else if (el.t === "frac") {
        const lh = mesurer(g, (el.haut || []).map(txt), px), lb = mesurer(g, (el.bas || []).map(txt), px), l = Math.max(lh, lb) + px * 0.5;
        ecrire(g, el.haut || [], el.x * W, el.y * H - px * 0.3, px, true);
        ecrire(g, el.bas || [], el.x * W, el.y * H + px * 0.82, px, true);
        g.lineWidth = Math.max(0.8, px * 0.06); g.beginPath(); g.moveTo(el.x * W - l / 2, el.y * H); g.lineTo(el.x * W + l / 2, el.y * H); g.stroke();
      } else if (el.t === "trait") {
        const p = el.p, n = el.n === 2 ? 2 : 1;
        for (let j = 0; j < n; j++) {
          g.save(); g.translate(0, j * W * 0.008);
          if (el.onde && p.length === 4) {
            const x0 = p[0] * W, y0 = p[1] * H, x1 = p[2] * W, y1 = p[3] * H, L = Math.hypot(x1 - x0, y1 - y0), a = W * 0.0045, pas = W * 0.05;
            g.beginPath();
            for (let d = 0; d <= L; d += 3) { const t = d / L, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + Math.sin(d / pas * Math.PI * 2) * a; if (d === 0) g.moveTo(x, y); else g.lineTo(x, y); }
          } else chemin(g, p, W, H);
          g.stroke(); g.restore();
        }
      } else if (el.t === "fleche") {
        const p = el.p, n = p.length, t = (el.e || 0.016) * W;
        chemin(g, p, W, H); g.stroke();
        const x = p[n - 2] * W, y = p[n - 1] * H, a = Math.atan2(y - p[n - 3] * H, x - p[n - 4] * W);
        g.beginPath(); g.moveTo(x - t * Math.cos(a - 0.42), y - t * Math.sin(a - 0.42)); g.lineTo(x, y); g.lineTo(x - t * Math.cos(a + 0.42), y - t * Math.sin(a + 0.42)); g.stroke();
      } else if (el.t === "ovale") { g.beginPath(); g.ellipse(el.x * W, el.y * H, el.rx * W, el.ry * H, el.rot || 0, 0, Math.PI * 2); g.stroke(); }
      else if (el.t === "portee") { g.lineWidth = Math.max(0.7, W * 0.0015); portee(g, el.x0, el.x1, el.y, el.e, W, H); }
      else if (el.t === "cle" || el.t === "note") {
        const e = el.e * H;
        g.font = `${(4 * e).toFixed(2)}px Bravura`; g.textBaseline = "alphabetic"; g.textAlign = el.t === "note" ? "center" : "left";
        if (el.t === "cle") g.fillText(String.fromCharCode(el.k === "fa" ? G.fa : /^ut/.test(el.k || "") ? G.ut : G.sol), el.x * W, el.y * H + ligneCle(el) * e);
        else {
          // v = ronde (défaut), blanche, noire, croche ; h = 1 hampe en haut, -1 en bas (sinon : en bas dès le milieu de la portée)
          // hl = longueur de hampe en interlignes (3,5 par défaut) ; b = croche reliée par une poutre (pas de crochet) ; p = points
          const y = el.y * H + 4 * e - (el.pos || 0) * e / 2, x = el.x * W, v = G[el.v] && /^(ronde|blanche|noire)$/.test(el.v) ? el.v : el.v === "croche" ? "noire" : "ronde";
          g.fillText(String.fromCharCode(G[v]), x, y);
          if (v !== "ronde") {
            const h = el.h === 1 || el.h === -1 ? el.h : (el.pos || 0) >= 4 ? -1 : 1, L = (el.hl > 0 && el.hl < 12 ? el.hl : 3.5) * e;
            const sx = x + h * e * 0.59 - h * e * 0.065, ep = e * 0.13;
            g.fillRect(sx - ep / 2, h === 1 ? y - L : y + e * 0.17, ep, L - e * 0.17);
            if (el.v === "croche" && !el.b) glyphe(g, h === 1 ? G.crocheH : G.crocheB, sx - ep / 2, h === 1 ? y - L : y + L, e, false);
          }
          for (let i = 0; i < Math.min(2, el.p || 0); i++) glyphe(g, G.point, x + e * (v === "ronde" ? 1.35 : 1.15) + i * e * 0.55, y - ((el.pos || 0) % 2 === 0 ? e / 2 : 0), e, true);
          g.font = `${(4 * e).toFixed(2)}px Bravura`; g.textAlign = "center";
          g.lineWidth = Math.max(0.7, W * 0.0015);        // petites lignes supplémentaires sous ou sur la portée
          for (let q = -2; q >= (el.pos || 0); q -= 2) { g.beginPath(); g.moveTo(el.x * W - e * 1.25, el.y * H + 4 * e - q * e / 2); g.lineTo(el.x * W + e * 1.25, el.y * H + 4 * e - q * e / 2); g.stroke(); }
          for (let q = 10; q <= (el.pos || 0); q += 2) { g.beginPath(); g.moveTo(el.x * W - e * 1.25, el.y * H + 4 * e - q * e / 2); g.lineTo(el.x * W + e * 1.25, el.y * H + 4 * e - q * e / 2); g.stroke(); }
        }
      }
    }
    ENCRE = COULEURS.noir;
    g.restore();
  };
})(window.Cartable);
