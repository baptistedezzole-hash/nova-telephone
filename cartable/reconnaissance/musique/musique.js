/* Cartable - musique manuscrite -> belle notation (navigateur ET Node).
   S'appuie sur le moteur de partition-stylet (recognizer.js, chargé AVANT ce fichier : globalThis.Part).

   const r = Musique.reconnaitre(traits, portee, opts)
     traits : [[{x,y}...], ...] en pixels de la feuille
     portee : { haut: y de la ligne du haut (px), interligne: écart entre deux lignes (px), gauche?: x du début (px), cle?: 'sol'|'fa' }
              ou un tableau de portées (chaque groupe de traits va à la portée la plus proche)
     -> { symboles: [ { type, label, score, alternatives, boite:{x,y,l,h}, traits:[indices], portee:index, ... } ] }
        note : { duree:'w'|'h'|'q'|'e'|'s'|'t', points, hauteurs:[{ nom:'Mi4', diatonique, midi, y }], alteration, sens:'up'|'down', tete:{x,y} }
   Musique.dessiner(ctx, r, portee, { couleur, lignes:true })  dessine la notation propre (police Bravura, SMuFL)
   Musique.chargerPolice(url)  charge Bravura (FontFace) avant de dessiner ; url par défaut ../polices/Bravura.woff2 */
(function () {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  const Part = G.Part || (typeof require === 'function' ? require('./recognizer.js') : null);
  const NOMS = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
  const DEMI = [0, 2, 4, 5, 7, 9, 11];
  const ALT = { '#': 1, b: -1, n: 0, x: 2, bb: -2 };

  const boite = (traits) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    traits.forEach(t => t.forEach(p => { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }));
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  };
  const ecart = (a, b) => Math.hypot(Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)), Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)));
  const enPoints = (t) => Array.isArray(t) && t.length && typeof t[0] === 'number'
    ? Array.from({ length: t.length >> 1 }, (_, i) => ({ x: +t[2 * i], y: +t[2 * i + 1] }))
    : (t.points || t).map(p => ({ x: +p.x, y: +p.y, t: p.t }));

  /** hauteur (diatonique) d'une tête à y (en espaces, 0 = ligne du haut) selon la clé */
  function hauteur(yEsp, cle, alteration) {
    const pas = Math.round((4 - yEsp) * 2);            // demi-espaces au-dessus de la ligne du bas
    const d = (cle === 'fa' ? 18 : 30) + pas;          // Sol2 (fa) / Mi4 (sol) sur la ligne du bas ; Do4 = 28
    const oct = Math.floor(d / 7), deg = ((d % 7) + 7) % 7;
    const alt = alteration && ALT[alteration] != null ? ALT[alteration] : 0;
    const signe = alteration === '#' ? '♯' : alteration === 'b' ? '♭' : alteration === 'x' ? '𝄪' : alteration === 'n' ? '♮' : '';
    return { nom: NOMS[deg] + signe + oct, diatonique: d, midi: 12 * (oct + 1) + DEMI[deg] + alt, yEsp: (4 - pas / 2) };
  }

  function reconnaitre(traitsBruts, portee, opts = {}) {
    if (!Part || !Part.recognize) throw new Error('recognizer.js (partition-stylet) doit être chargé avant musique.js');
    const portees = Array.isArray(portee) ? portee : [portee];
    if (!portees.length || !portees.every(p => p && p.interligne > 0 && Number.isFinite(p.haut))) throw new Error('portée invalide');
    const traits = (traitsBruts || []).slice(0, 4000).map(enPoints).filter(t => t.length);
    // 1) chaque trait va à sa portée (la plus proche verticalement)
    const items = traits.map((t, i) => {
      const b = boite([t]);
      let k = 0, best = Infinity;
      portees.forEach((p, j) => { const c = p.haut + 2 * p.interligne; const d = Math.abs(b.cy - c); if (d < best) { best = d; k = j; } });
      return { i, t, b, k };
    });
    // 2) regrouper les traits proches en symboles (même règle que partition-stylet : écart <= 0,95 espace)
    const parent = items.map((_, i) => i);
    const racine = (i) => parent[i] === i ? i : (parent[i] = racine(parent[i]));
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      if (items[a].k !== items[b].k) continue;
      const s = portees[items[a].k].interligne;
      if (ecart(items[a].b, items[b].b) <= (opts.ecartGroupe || 0.95) * s) parent[racine(a)] = racine(b);
    }
    const groupes = new Map();
    items.forEach((it, i) => { const r = racine(i); if (!groupes.has(r)) groupes.set(r, []); groupes.get(r).push(it); });
    const symboles = [];
    const cles = portees.map(p => p.cle === 'fa' ? 'fa' : 'sol');
    const liste = [...groupes.values()].map(g => ({ g, b: boite(g.map(x => x.t)) })).sort((a, b) => a.b.x0 - b.b.x0);
    for (const { g, b } of liste) {
      const k = g[0].k, P = portees[k], s = P.interligne;
      const rel = g.map(x => x.t.map(p => ({ x: (p.x - (P.gauche || 0)) / s, y: (p.y - P.haut) / s, t: p.t })));
      const env = {};
      const debut = P.gauche != null && (b.x0 - P.gauche) < 3.5 * s && !symboles.some(z => z.portee === k && z.type !== 'clef');
      if (debut) env.pre = 'clef';
      let cands = Part.recognize(rel, env);
      if (debut && (!cands.length || cands[0].type !== 'clef' || cands[0].score < 0.5)) cands = Part.recognize(rel, {});
      const top = cands[0];
      if (!top || (opts.seuil != null && top.score < opts.seuil)) {
        symboles.push({ type: 'inconnu', label: '?', score: 0, alternatives: [], boite: { x: b.x0, y: b.y0, l: b.w, h: b.h }, traits: g.map(x => x.i), portee: k });
        continue;
      }
      const sym = {
        type: top.type, label: top.label, score: +top.score.toFixed(3),
        alternatives: cands.slice(1, 4).map(c => ({ type: c.type, label: c.label, score: +c.score.toFixed(3) })),
        boite: { x: b.x0, y: b.y0, l: b.w, h: b.h }, traits: g.map(x => x.i), portee: k,
      };
      const px = (u) => (P.gauche || 0) + u * s, py = (v) => P.haut + v * s;
      if (top.type === 'note') {
        sym.duree = top.dur; sym.points = top.dots || 0; sym.sens = top.dir || (top.head.y < 2 ? 'down' : 'up'); sym.hampe = !!top.stem; sym.crochets = top.flags || 0;
        sym.alteration = top.acc || null;
        const tetes = [{ x: top.head.x, y: top.head.y }, ...((top.chord || []).filter(h => Math.abs(h.y - top.head.y) > 0.2 || Math.abs(h.x - top.head.x) > 0.4))];
        sym.tete = { x: px(top.head.x), y: py(top.head.y), l: top.head.w * s, h: top.head.h * s };
        sym.hauteurs = tetes.map(h => Object.assign(hauteur(h.y, cles[k], sym.alteration), { x: px(h.x) })).map(h => Object.assign(h, { y: py(h.yEsp) }));
        sym.hauteurs.sort((a, c) => a.diatonique - c.diatonique);
      } else if (top.type === 'rest') sym.duree = top.d;
      else if (top.type === 'acc') { sym.alteration = top.a; sym.y = py(top.cy); }
      else if (top.type === 'clef') { cles[k] = top.clef === 'bass' ? 'fa' : 'sol'; sym.cle = cles[k]; }
      else if (top.type === 'bar') sym.style = top.style;
      else if (top.type === 'ts') { sym.chiffrage = { n: top.n, d: top.d, c: !!top.common }; }
      else if (top.type === 'slur') { sym.de = { x: px(top.x1), y: py(top.y1) }; sym.a = { x: px(top.x2), y: py(top.y2) }; sym.dessus = !!top.up; }
      else if (top.type === 'beam') { sym.de = { x: px(top.x1), y: py(top.y1) }; sym.a = { x: px(top.x2), y: py(top.y2) }; }
      symboles.push(sym);
    }
    // 3) une altération écrite juste à gauche d'une note s'applique à cette note
    for (let i = 0; i < symboles.length; i++) {
      const A = symboles[i]; if (A.type !== 'acc') continue;
      const s = portees[A.portee].interligne;
      const N = symboles.find(z => z.type === 'note' && z.portee === A.portee && z.boite.x >= A.boite.x + A.boite.l * 0.3 && z.boite.x - (A.boite.x + A.boite.l) < 2.5 * s);
      if (!N) continue;
      const tete = N.hauteurs.reduce((m, h) => Math.abs(h.y - A.y) < Math.abs(m.y - A.y) ? h : m, N.hauteurs[0]);
      if (Math.abs(tete.y - A.y) > 1.5 * s) continue;
      const h2 = hauteur(tete.yEsp, cles[N.portee], A.alteration);
      Object.assign(tete, h2, { y: tete.y, x: tete.x, alteration: A.alteration });
      N.alteration = N.alteration || A.alteration;
      A.rattacheA = symboles.indexOf(N);
    }
    return { symboles };
  }

  // ---------- rendu propre (SMuFL / Bravura) ----------
  const GLYPHE = {
    teteNoire: '', teteBlanche: '', ronde: '',
    crochetHaut: ['', '', '', ''], crochetBas: ['', '', '', ''],
    alt: { b: '', n: '', '#': '', x: '', bb: '' },
    cle: { sol: '', fa: '' },
    pause: { w: '', h: '', q: '', e: '', s: '', t: '' },
    point: '', chiffre: (n) => String(n).split('').map(c => String.fromCharCode(0xE080 + +c)).join(''), commun: '',
  };
  const CROCHETS = { w: 0, h: 0, q: 0, e: 1, s: 2, t: 3 };

  async function chargerPolice(url) {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    if ([...document.fonts].some(f => f.family.replace(/"/g, '') === 'Bravura' && f.status === 'loaded')) return true;
    const f = new FontFace('Bravura', `url(${url || new URL('../polices/Bravura.woff2', document.currentScript ? document.currentScript.src : location.href)})`);
    await f.load(); document.fonts.add(f); return true;
  }

  function dessinerPortee(ctx, P, x0, x1, couleur) {
    ctx.save(); ctx.strokeStyle = couleur || '#2b2b2b'; ctx.lineWidth = Math.max(1, P.interligne * 0.1);
    for (let i = 0; i < 5; i++) { const y = P.haut + i * P.interligne; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    ctx.restore();
  }

  /** Dessine les symboles reconnus, au propre, à leur place (x d'origine, hauteur aimantée sur la portée). */
  function dessiner(ctx, resultat, portee, o = {}) {
    const portees = Array.isArray(portee) ? portee : [portee];
    const coul = o.couleur || '#14141c';
    ctx.save(); ctx.fillStyle = coul; ctx.strokeStyle = coul; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const z of resultat.symboles) {
      const P = portees[z.portee]; const s = P.interligne; ctx.font = `${4 * s}px Bravura`;
      const ligneY = (v) => P.haut + v * s;
      const glyphe = (g, x, y) => ctx.fillText(g, x, y);
      if (z.type === 'note') {
        const tete = z.duree === 'w' ? GLYPHE.ronde : z.duree === 'h' ? GLYPHE.teteBlanche : GLYPHE.teteNoire;
        const lt = (z.duree === 'w' ? 1.69 : 1.18) * s; // largeur de la tête (SMuFL)
        const x = z.tete.x - lt / 2;
        for (const h of z.hauteurs) {
          // lignes supplémentaires
          ctx.lineWidth = Math.max(1, s * 0.16);
          for (let v = -1; v >= h.yEsp - 0.01; v--) { ctx.beginPath(); ctx.moveTo(x - 0.4 * s, ligneY(v)); ctx.lineTo(x + lt + 0.4 * s, ligneY(v)); ctx.stroke(); }
          for (let v = 5; v <= h.yEsp + 0.01; v++) { ctx.beginPath(); ctx.moveTo(x - 0.4 * s, ligneY(v)); ctx.lineTo(x + lt + 0.4 * s, ligneY(v)); ctx.stroke(); }
          glyphe(tete, x, h.y);
          if (h.alteration || (z.hauteurs.length === 1 && z.alteration)) glyphe(GLYPHE.alt[h.alteration || z.alteration], x - 1.3 * s, h.y);
          for (let d = 0; d < z.points; d++) glyphe(GLYPHE.point, x + lt + 0.3 * s + d * 0.5 * s, h.y - (Math.abs(h.yEsp % 1) < 0.25 ? 0.5 * s : 0));
        }
        if (z.duree !== 'w') {
          const haut = z.sens === 'up';
          const ys = z.hauteurs.map(h => h.y); const yMin = Math.min(...ys), yMax = Math.max(...ys);
          const sx = haut ? x + lt - s * 0.06 : x + s * 0.06;
          const y0 = haut ? yMax : yMin, y1 = haut ? Math.min(yMin - 3.5 * s, ligneY(2)) : Math.max(yMax + 3.5 * s, ligneY(2));
          ctx.lineWidth = Math.max(1, s * 0.12); ctx.beginPath(); ctx.moveTo(sx, y0 + (haut ? -0.15 : 0.15) * s); ctx.lineTo(sx, y1); ctx.stroke();
          const nc = CROCHETS[z.duree] || 0;
          if (nc) glyphe((haut ? GLYPHE.crochetHaut : GLYPHE.crochetBas)[nc], sx - s * 0.06, y1);
        }
      } else if (z.type === 'rest') {
        const y = z.duree === 'w' ? ligneY(1) : ligneY(2);
        glyphe(GLYPHE.pause[z.duree] || GLYPHE.pause.q, z.boite.x, y);
      } else if (z.type === 'acc' && z.rattacheA == null) {
        glyphe(GLYPHE.alt[z.alteration], z.boite.x, ligneY(Math.round((z.y - P.haut) / s * 2) / 2));
      } else if (z.type === 'clef') {
        glyphe(GLYPHE.cle[z.cle], z.boite.x, z.cle === 'fa' ? ligneY(1) : ligneY(3));
      } else if (z.type === 'bar') {
        const xb = z.boite.x + z.boite.l / 2; ctx.lineWidth = Math.max(1, s * 0.16);
        ctx.beginPath(); ctx.moveTo(xb, ligneY(0)); ctx.lineTo(xb, ligneY(4)); ctx.stroke();
        if (z.style !== 'single') { ctx.lineWidth = z.style === 'final' ? s * 0.5 : Math.max(1, s * 0.16); const x2 = xb + (z.style === 'final' ? 0.75 : 0.6) * s; ctx.beginPath(); ctx.moveTo(x2, ligneY(0)); ctx.lineTo(x2, ligneY(4)); ctx.stroke(); }
      } else if (z.type === 'ts') {
        if (z.chiffrage.c) glyphe(GLYPHE.commun, z.boite.x, ligneY(2));
        else { glyphe(GLYPHE.chiffre(z.chiffrage.n), z.boite.x, ligneY(1)); glyphe(GLYPHE.chiffre(z.chiffrage.d), z.boite.x, ligneY(3)); }
      } else if (z.type === 'slur') {
        const a = z.de, b = z.a, h = (b.x - a.x) * 0.15 * (z.dessus ? -1 : 1);
        ctx.lineWidth = Math.max(1, s * 0.14); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + h * 2, b.x, b.y); ctx.stroke();
      } else if (z.type === 'beam') {
        ctx.lineWidth = s * 0.5; ctx.beginPath(); ctx.moveTo(z.de.x, z.de.y); ctx.lineTo(z.a.x, z.a.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  const Musique = { reconnaitre, dessiner, dessinerPortee, chargerPolice, hauteur, GLYPHE };
  G.Musique = Musique;
  if (typeof module === 'object' && module.exports) module.exports = Musique;
})();
