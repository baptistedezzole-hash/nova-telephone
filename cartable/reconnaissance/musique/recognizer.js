/* Copie du moteur de reconnaissance de partition-stylet (crea game/partition-stylet/app/src/recognizer.js, 25/11/2026).
   Ne pas modifier ici : corriger dans partition-stylet puis recopier. Unités = espaces de portée. */
/* Reconnaissance de traits à main levée pour la musique.
   Entrée : des traits en « espaces de portée » (1 unité = 1 espace entre deux lignes), y = 0 à la ligne du haut de la portée,
   y vers le BAS. Sortie : une liste de propositions triées {type, score, ...} (la meilleure en premier).
   Principe : chaque trait est ramené à une primitive (point, ligne, anneau, tache pleine, arc, zigzag…), les primitives sont
   assemblées (tête + hampe + crochets + point = note ; deux verticales + barres = dièse…), puis chaque règle propose un score.
   Aucune bibliothèque externe, tout marche hors ligne. */
(function () {
  const P = (globalThis.Part = globalThis.Part || {});
  const PI = Math.PI;

  // ---------------------------------------------------------------- géométrie de base
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sig = (x) => 1 / (1 + Math.exp(-x));
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }

  function resample(pts, step) {
    const clean = [pts[0]];
    for (let i = 1; i < pts.length; i++) if (dist(pts[i], clean[clean.length - 1]) > 1e-6) clean.push({ x: pts[i].x, y: pts[i].y });
    if (clean.length < 2) return clean.length ? [clean[0], { x: clean[0].x + 1e-3, y: clean[0].y }] : [];
    const out = [{ x: clean[0].x, y: clean[0].y }];
    let carry = 0;
    for (let i = 1; i < clean.length; i++) {
      let a = clean[i - 1]; const b = clean[i]; let d = dist(a, b);
      while (carry + d >= step) {
        const t = (step - carry) / d;
        a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        out.push(a); d = dist(a, b); carry = 0;
      }
      carry += d;
    }
    const last = clean[clean.length - 1];
    if (dist(out[out.length - 1], last) > step * 0.3) out.push({ x: last.x, y: last.y });
    return out;
  }
  function smooth(R, n = 2) {
    let A = R;
    for (let k = 0; k < n; k++) {
      const B = A.map((p, i) => (i === 0 || i === A.length - 1) ? p : { x: (A[i - 1].x + p.x + A[i + 1].x) / 3, y: (A[i - 1].y + p.y + A[i + 1].y) / 3 });
      A = B;
    }
    return A;
  }
  function dp(R, eps) { // Douglas-Peucker
    const keep = new Array(R.length).fill(false); keep[0] = keep[R.length - 1] = true;
    const rec = (i, j) => {
      let md = 0, mi = -1; const a = R[i], b = R[j];
      for (let k = i + 1; k < j; k++) {
        const d = segDist(R[k], a, b); if (d > md) { md = d; mi = k; }
      }
      if (md > eps && mi >= 0) { keep[mi] = true; rec(i, mi); rec(mi, j); }
    };
    rec(0, R.length - 1);
    return R.filter((_, i) => keep[i]);
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return dist(p, a);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  // ---------------------------------------------------------------- primitives d'un trait
  function features(raw) {
    if (raw.length === 0) return null;
    let R = raw.length < 2 ? [raw[0], { x: raw[0].x + 1e-3, y: raw[0].y }] : resample(raw, 0.07);
    if (R.length < 3) R = [R[0], { x: (R[0].x + R[R.length - 1].x) / 2, y: (R[0].y + R[R.length - 1].y) / 2 }, R[R.length - 1]];
    R = smooth(R, 2);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, len = 0;
    for (let i = 0; i < R.length; i++) {
      const p = R[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      if (i) len += dist(R[i - 1], p);
    }
    const w = x1 - x0, h = y1 - y0;
    const chord = dist(R[0], R[R.length - 1]);
    // virage cumulé (angle des segments sur 0,28 espace)
    const k = 4; const dirs = [];
    for (let i = 0; i + k < R.length; i++) dirs.push(Math.atan2(R[i + k].y - R[i].y, R[i + k].x - R[i].x));
    let turn = 0, absTurn = 0;
    for (let i = 1; i < dirs.length; i++) { const d = wrap(dirs[i] - dirs[i - 1]); turn += d; absTurn += Math.abs(d); }
    // sommets du polygone simplifié -> coins
    const diag = Math.hypot(w, h);
    const S = dp(R, Math.min(0.2, 0.14 * diag + 0.03));
    let sharp = 0, bends = 0; const corners = [];
    for (let i = 1; i < S.length - 1; i++) {
      const a = Math.atan2(S[i].y - S[i - 1].y, S[i].x - S[i - 1].x), b = Math.atan2(S[i + 1].y - S[i].y, S[i + 1].x - S[i].x);
      const t = Math.abs(wrap(b - a));
      if (t >= 1.9) { sharp++; corners.push(S[i]); } else if (t >= 1.0) bends++;
    }
    let sag = 0;
    { const a = R[0], b = R[R.length - 1]; for (let i = 0; i < R.length; i++) sag = Math.max(sag, segDist(R[i], a, b) * (chord > 1e-6 ? 1 : 0)); if (chord <= 1e-6) sag = Math.max(w, h); }
    const f = {
      sag, lean: (R[R.length - 1].y - R[0].y) !== 0 ? -((R[R.length - 1].x - R[0].x) / (R[R.length - 1].y - R[0].y)) : 0,
      R, S, x0, x1, y0, y1, w, h, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, len, chord, turn, absTurn, sharp, bends, corners,
      straight: len > 0 ? chord / len : 1, first: R[0], last: R[R.length - 1],
      closed: chord <= 0.38 * Math.max(w, h) + 0.12,
    };
    return f;
  }

  const LINE_OK = 0.9;
  function orient(f) { // pour une ligne : 'v' | 'h' | '/' | '\\'
    const dx = f.last.x - f.first.x, dy = f.last.y - f.first.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax <= 0.5 * ay) return 'v'; // ≈ 27° de la verticale
    if (ay <= 0.42 * ax) return 'h'; // ≈ 23° de l'horizontale
    return (dx * dy < 0) ? '/' : '\\';
  }

  // une prim : { k, f, x0,x1,y0,y1,cx,cy,w,h, ... }
  function classify(f) {
    const mx = Math.max(f.w, f.h), mn = Math.min(f.w, f.h);
    const base = { f, x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, cx: f.cx, cy: f.cy, w: f.w, h: f.h };
    if (mx <= 0.55 && f.len <= 1.9) return Object.assign(base, { k: 'dot' });
    const ratio = f.len / (f.w + f.h + 1e-6);
    const thin = mn <= 0.2 * mx || (mn <= 0.3 && mx >= 1.4);
    if ((f.straight >= LINE_OK && f.len >= 0.45 && f.sag <= 0.1 * f.chord + 0.06) || (thin && mx >= 0.7 && f.sag <= 0.12 * mx + 0.06)) {
      let o = orient(f);
      if (thin) o = f.h >= f.w ? 'v' : 'h';
      return Object.assign(base, { k: 'line', o, lean: f.lean, length: thin ? mx : f.len, thick: thin && (f.len / Math.max(mx, 0.1) >= 1.8 && mn >= 0.09 || f.len / Math.max(mx, 0.1) >= 1.08 && mn >= 0.2) });
    }
    // anneau (ellipse fermée ou presque) : avant les taches, tant que le trait n'est pas « gribouillé »
    if (mn >= 0.33 && mx <= 3.0 && f.closed && f.absTurn >= 1.45 * PI && f.absTurn < 3.4 * PI && ratio < 2.0 && f.sharp <= 3) {
      return Object.assign(base, { k: 'loop', ratio });
    }
    // tache pleine (remplie en gribouillant ou en spiralant)
    if (mx <= 2.6 && mn >= 0.28 && ((f.sharp >= 2 && ratio >= 2.0) || (f.closed && f.absTurn >= 3.3 * PI) || (f.absTurn >= 4.2 * PI && f.len >= 2.2 * (f.w + f.h) * 0.8) || ratio >= 3.2)) {
      return Object.assign(base, { k: 'blob', fill: ratio });
    }
    // anneau (ellipse fermée ou presque)
    if (mn >= 0.33 && mx <= 3.0 && f.closed && f.absTurn >= 1.45 * PI && f.absTurn < 3.6 * PI && f.sharp <= 1) {
      return Object.assign(base, { k: 'loop', ratio });
    }
    if (f.sharp >= 2 || (f.sharp >= 1 && f.bends >= 1)) return Object.assign(base, { k: 'zig' });
    if (f.sag > 0.1 * f.chord + 0.06 && f.absTurn >= 0.35 && f.sharp <= 1) return Object.assign(base, { k: 'arc', bend: Math.sign(f.turn) });
    return Object.assign(base, { k: 'other' });
  }

  // un trait « boucle + queue » (tête de note et hampe d'un seul geste) : séparer en deux composants
  function splitLoopTail(f) {
    const R = f.R; const N = R.length;
    if (N < 25 || f.len < 2.0) return null;
    let best = null;
    for (let i = 0; i < N - 12; i++) {
      for (let j = i + 12; j < N; j++) {
        if (dist(R[i], R[j]) < 0.2) {
          let l = 0; for (let k = i + 1; k <= j; k++) l += dist(R[k - 1], R[k]);
          if (l >= 1.4 && (!best || l > best.l)) best = { i, j, l };
        }
      }
    }
    if (!best) return null;
    const loop = R.slice(best.i, best.j + 1);
    const a = R.slice(0, best.i + 1), b = R.slice(best.j);
    const lenOf = (A) => A.reduce((s, p, k) => s + (k ? dist(A[k - 1], p) : 0), 0);
    const pieces = [loop];
    const lb = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }; loop.forEach(q => { lb.x0 = Math.min(lb.x0, q.x); lb.x1 = Math.max(lb.x1, q.x); lb.y0 = Math.min(lb.y0, q.y); lb.y1 = Math.max(lb.y1, q.y); });
    const keep = (A) => {
      if (lenOf(A) < 1.0) return false;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; A.forEach(q => { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); });
      return (x0 < lb.x0 - 0.6 || x1 > lb.x1 + 0.6 || y0 < lb.y0 - 0.6 || y1 > lb.y1 + 0.6);
    };
    if (keep(a)) pieces.push(a);
    if (keep(b)) pieces.push(b);
    if (pieces.length < 2) return null;
    return pieces;
  }

  function makePrims(strokes) {
    const prims = [];
    for (const s of strokes) {
      if (!s || !s.length) continue;
      const f = features(s); if (!f) continue;
      let p = classify(f);
      if (p.k !== 'dot' && p.k !== 'line' && p.k !== 'loop' && p.k !== 'blob') {
        const sp = splitLoopTail(f);
        if (sp) {
          const subs = sp.map(A => classify(features(A))).filter(Boolean);
          const loopSub = subs[0];
          if (loopSub.k === 'loop' || loopSub.k === 'blob') { subs.forEach(x => { x.split = true; prims.push(x); }); continue; }
        }
      }
      prims.push(p);
    }
    return prims;
  }

  // ---------------------------------------------------------------- reconnaissance de chiffres ($P : nuages de points)
  const DIGIT_TEMPLATES = {
    '1': [[[0.3, 0.22], [0.55, 0.0], [0.55, 1.0]], [[0.5, 0.0], [0.5, 1.0]]],
    '2': [[[0.1, 0.22], [0.3, 0.04], [0.65, 0.02], [0.88, 0.25], [0.65, 0.55], [0.1, 1.0], [0.92, 1.0]], [[0.12, 0.2], [0.4, 0.0], [0.8, 0.12], [0.8, 0.4], [0.1, 1.0], [0.9, 0.95]]],
    '3': [[[0.1, 0.1], [0.5, 0.0], [0.85, 0.2], [0.5, 0.46], [0.9, 0.7], [0.5, 1.0], [0.1, 0.9]], [[0.15, 0.0], [0.85, 0.0], [0.45, 0.45], [0.85, 0.65], [0.5, 1.0], [0.1, 0.9]]],
    '4': [[[0.7, 0.0], [0.08, 0.66], [0.95, 0.66]], [[0.7, 0.0], [0.7, 1.0]]],
    '4b': [[[0.15, 0.0], [0.1, 0.62], [0.92, 0.62]], [[0.7, 0.2], [0.7, 1.0]]],
    '4c': [[[0.2, 0.0], [0.15, 0.55], [0.85, 0.55]], [[0.65, 0.0], [0.65, 1.0]]],
    '4d': [[[0.7, 1.0], [0.7, 0.0], [0.05, 0.68], [0.95, 0.68]]],
    '4e': [[[0.15, 0.0], [0.1, 0.62], [0.55, 0.64], [0.9, 0.62]], [[0.7, 0.0], [0.7, 1.0]]],
    '5': [[[0.85, 0.0], [0.2, 0.0], [0.14, 0.45], [0.6, 0.4], [0.9, 0.65], [0.6, 1.0], [0.1, 0.9]], [[0.2, 0.45], [0.55, 0.38], [0.9, 0.65], [0.55, 1.0], [0.1, 0.88]], [[0.2, 0.0], [0.17, 0.5], [0.62, 0.4], [0.9, 0.7], [0.6, 1.0], [0.1, 0.9]], [[0.85, 0.0], [0.2, 0.0]]],
    '6': [[[0.75, 0.0], [0.3, 0.3], [0.1, 0.65], [0.3, 1.0], [0.7, 1.0], [0.9, 0.7], [0.6, 0.45], [0.2, 0.6]], [[0.7, 0.05], [0.2, 0.5], [0.15, 0.85], [0.5, 1.0], [0.85, 0.8], [0.6, 0.5], [0.15, 0.7]]],
    '7': [[[0.1, 0.0], [0.9, 0.0], [0.4, 1.0]], [[0.1, 0.05], [0.92, 0.0], [0.45, 1.0]], [[0.1, 0.0], [0.9, 0.0], [0.4, 1.0]], [[0.3, 0.55], [0.7, 0.5]]],
    '8': [[[0.5, 0.5], [0.15, 0.25], [0.5, 0.0], [0.85, 0.25], [0.5, 0.5], [0.1, 0.75], [0.5, 1.0], [0.9, 0.75], [0.5, 0.5]], [[0.85, 0.2], [0.5, 0.0], [0.15, 0.2], [0.85, 0.8], [0.5, 1.0], [0.15, 0.8], [0.85, 0.2]]],
    '9': [[[0.85, 0.4], [0.5, 0.0], [0.15, 0.25], [0.5, 0.5], [0.85, 0.35], [0.8, 0.7], [0.4, 1.0]], [[0.8, 0.25], [0.5, 0.0], [0.15, 0.25], [0.5, 0.5], [0.85, 0.25], [0.8, 1.0]]],
    '0': [[[0.5, 0.0], [0.12, 0.25], [0.1, 0.75], [0.5, 1.0], [0.9, 0.75], [0.88, 0.25], [0.5, 0.0]]],
    'C': [[[0.9, 0.2], [0.55, 0.0], [0.2, 0.2], [0.1, 0.5], [0.2, 0.8], [0.55, 1.0], [0.9, 0.8]]],
  };
  const NP = 32;
  function cloudOf(strokes) { // strokes : listes de points ; -> nuage normalisé (hauteur = 1)
    let tot = 0; strokes.forEach(s => { for (let i = 1; i < s.length; i++) tot += dist(s[i - 1], s[i]); });
    if (tot < 1e-6) return null;
    const step = tot / (NP - 1); const pts = [];
    strokes.forEach((s, si) => {
      const R = resample(s, step);
      R.forEach(p => pts.push({ x: p.x, y: p.y, id: si }));
    });
    while (pts.length > NP) pts.pop();
    while (pts.length < NP) pts.push(Object.assign({}, pts[pts.length - 1]));
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const sc = Math.max(y1 - y0, (x1 - x0) * 0.8, 1e-6); // hauteur de référence
    pts.asp = (x1 - x0) / Math.max(y1 - y0, 1e-6);
    pts.forEach(p => { p.x = (p.x - x0) / sc; p.y = (p.y - y0) / sc; });
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    pts.forEach(p => { p.x -= cx; p.y -= cy; });
    return pts;
  }
  function cloudDist(a, b, start) {
    const n = a.length; const matched = new Array(n).fill(false); let sum = 0; let i = start;
    const step = Math.floor(Math.pow(n, 0.5));
    do {
      let min = 1e9, idx = -1;
      for (let j = 0; j < n; j++) if (!matched[j]) { const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y); if (d < min) { min = d; idx = j; } }
      matched[idx] = true; const w = 1 - ((i - start + n) % n) / n; sum += w * min; i = (i + 1) % n;
    } while (i !== start);
    return sum;
  }
  function greedy(a, b) {
    const n = a.length; const step = Math.max(1, Math.floor(Math.pow(n, 0.5)));
    let m = 1e9; for (let i = 0; i < n; i += step) m = Math.min(m, cloudDist(a, b, i), cloudDist(b, a, i));
    return m;
  }
  let TPL = null;
  function templates() {
    if (TPL) return TPL; TPL = [];
    for (const k in DIGIT_TEMPLATES) for (const t of DIGIT_TEMPLATES[k]) {
      // les gabarits sont donnés trait par trait (un gabarit = un trait ; on les regroupe selon les variantes multi-traits)
      void t;
    }
    // un gabarit multi-traits = les traits successifs d'une même variante : '4' (2 traits), '4b', '4c', '5' (variantes 1-3 un trait, 4 = barre séparée), '7' (3e = un trait, 4 = barre)
    const multi = { '4': [[0, 1]], '4b': [[0, 1]], '4c': [[0, 1]], '4e': [[0, 1]] };
    for (const k in DIGIT_TEMPLATES) {
      const lab = k.length > 1 && k !== 'C' ? k[0] : k;
      if (multi[k]) { TPL.push({ lab, strokes: multi[k][0].map(i => DIGIT_TEMPLATES[k][i].map(([x, y]) => ({ x, y }))) }); continue; }
      DIGIT_TEMPLATES[k].forEach((t, i) => {
        if (k === '5' && i === 3) return; if (k === '7' && i === 3) return;
        TPL.push({ lab, strokes: [t.map(([x, y]) => ({ x, y }))] });
      });
      if (k === '5') TPL.push({ lab, strokes: [DIGIT_TEMPLATES[k][1].map(([x, y]) => ({ x, y })), DIGIT_TEMPLATES[k][3].map(([x, y]) => ({ x, y }))] });
      if (k === '7') TPL.push({ lab, strokes: [DIGIT_TEMPLATES[k][0].map(([x, y]) => ({ x, y })), DIGIT_TEMPLATES[k][3].map(([x, y]) => ({ x, y }))] });
    }
    TPL.forEach(t => { if (t.lab !== 'C') t.strokes = t.strokes.map(st => st.map(p => ({ x: p.x * 0.66, y: p.y }))); t.cloud = cloudOf(t.strokes); });
    return TPL;
  }
  function matchDigit(strokes) {
    const c = cloudOf(strokes.map(s => resample(s, 0.05)).filter(s => s.length > 1)); if (!c) return [];
    const res = templates().map(t => ({ lab: t.lab, d: greedy(c, t.cloud) }));
    const best = {};
    res.forEach(r => { if (!(r.lab in best) || r.d < best[r.lab]) best[r.lab] = r.d; });
    return Object.keys(best).map(k => ({ lab: k, score: clamp(1 - best[k] / 6.2, 0, 1) })).sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------- assemblage : candidats
  const bboxOf = (ps) => { const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 }; ps.forEach(p => { b.x0 = Math.min(b.x0, p.x0); b.x1 = Math.max(b.x1, p.x1); b.y0 = Math.min(b.y0, p.y0); b.y1 = Math.max(b.y1, p.y1); }); b.w = b.x1 - b.x0; b.h = b.y1 - b.y0; b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; return b; };
  const isHead = (p) => (p.k === 'loop' || p.k === 'blob') && p.w >= 0.45 && p.w <= 2.4 && p.h >= 0.33 && p.h <= 2.0 && p.w / p.h >= 0.55 && p.w / p.h <= 2.6;

  function noteCandidates(prims, env) {
    const out = [];
    // têtes
    let heads = prims.filter(isHead);
    if (!heads.length) return out;
    // une tête « pleine » = anneau + ink à l'intérieur
    heads.sort((a, b) => b.w * b.h - a.w * a.h);
    let head = heads[0];
    // têtes supplémentaires (accord) : même colonne
    const chordHeads = heads.filter(h => h !== head && Math.abs(h.cx - head.cx) < 0.8 && Math.abs(h.cy - head.cy) > 0.6);
    const used = new Set([head, ...chordHeads]);
    let filled = head.k === 'blob';
    const fillRatio = head.k === 'blob' ? head.fill : (head.ratio || 1);
    // encre à l'intérieur de l'anneau = remplissage
    prims.forEach(p => {
      if (used.has(p)) return;
      if (head.k === 'loop' && p.x0 >= head.x0 - 0.15 && p.x1 <= head.x1 + 0.15 && p.y0 >= head.y0 - 0.15 && p.y1 <= head.y1 + 0.15 && (p.k === 'blob' || p.k === 'zig' || p.k === 'dot' || p.k === 'other' || p.k === 'arc' || p.k === 'line' && Math.max(p.w, p.h) < head.h * 1.2)) { used.add(p); filled = true; }
    });
    // hampe
    const hx0 = head.x0 - 0.6, hx1 = head.x1 + 0.6;
    let stem = null;
    prims.forEach(p => {
      if (used.has(p) || p.k !== 'line') return;
      const vertical = p.o === 'v' || ((p.o === '/' || p.o === '\\') && p.h >= 1.8 && Math.abs(p.w) / p.h <= 0.75);
      if (!vertical) return;
      const length = p.h;
      if (length < 1.5) return;
      if (p.cx < hx0 || p.cx > hx1) return;
      // doit toucher ou frôler la tête
      if (p.y1 < head.y0 - 0.5 || p.y0 > head.y1 + 0.5) return;
      if (!stem || length > stem.h) stem = p;
    });
    if (stem) used.add(stem);
    let dir = null;
    if (stem) {
      const up = head.cy - stem.y0, down = stem.y1 - head.cy;
      dir = up >= down ? 'up' : 'down';
    }
    const tipY = stem ? (dir === 'up' ? stem.y0 : stem.y1) : null;
    const tipX = stem ? stem.cx : null;
    // crochets
    let flags = 0;
    prims.forEach(p => {
      if (used.has(p) || !stem) return;
      if (p.k === 'dot' && p.cx > head.x1) return;
      const nearTip = Math.abs((dir === 'up' ? p.y0 : p.y1) - tipY) <= 1.5 || (p.cy > Math.min(tipY, head.cy) - 0.3 && p.cy < Math.max(tipY, head.cy) + 0.3 && Math.abs(p.cy - tipY) < 2.4);
      const sideOk = p.x1 >= tipX - 0.5 && p.x0 <= tipX + 2.4;
      if (!(nearTip && sideOk)) return;
      if (p.k === 'arc' || p.k === 'zig' || p.k === 'other' || (p.k === 'line' && (p.o === '/' || p.o === '\\' || p.o === 'h')) || p.k === 'dot') {
        used.add(p); flags += (p.k === 'zig' || (p.k === 'arc' && p.f.len >= 2.4) ? 2 : 1);
      }
    });
    flags = Math.min(3, flags);
    // points d'augmentation
    let dots = 0;
    prims.forEach(p => {
      if (used.has(p)) return;
      if ((p.k === 'dot' || (p.k === 'blob' && p.w < 0.7 && p.h < 0.7)) && p.cx > head.x1 - 0.15 && p.cx < head.x1 + 1.9 && Math.abs(p.cy - head.cy) < 1.0) { used.add(p); dots++; }
    });
    dots = Math.min(2, dots);
    // reste : altération à gauche de la tête ?
    const rest = prims.filter(p => !used.has(p));
    let acc = null, penalty = 0;
    if (rest.length) {
      const left = rest.filter(p => p.x1 <= head.x0 + 0.5);
      if (left.length === rest.length) {
        const ac = accCandidates(left, env).filter(c => c.type === 'acc');
        if (ac.length && ac[0].score > 0.5) acc = ac[0].a; else penalty += 0.3;
      } else penalty += 0.35;
    }
    // durée
    let dur, base = 0.74;
    const stemScore = stem ? 1 : 0;
    const mk = (d, sc, extra) => out.push(Object.assign({ type: 'note', dur: d, dots, head: { x: head.cx, y: head.cy, w: head.w, h: head.h }, chord: chordHeads.map(h => ({ x: h.cx, y: h.cy })), stem: !!stem, dir, flags, acc, score: clamp(sc - penalty, 0, 1) }, extra || {}));
    const pFilled = filled ? 1 : sig((fillRatio - 2.2) / 0.25);
    // proportions d'une tête plausible
    const asp = head.w / head.h;
    const shapeOk = clamp(1 - Math.abs(Math.log(asp / 1.4)) * 0.35 - Math.max(0, asp - 1.85) * 0.5, 0.4, 1);
    if (head.k === 'blob' || filled || pFilled > 0.5) {
      if (stem) {
        const d = flags >= 3 ? 't' : flags === 2 ? 's' : flags === 1 ? 'e' : 'q';
        mk(d, (base + 0.2) * shapeOk * (0.5 + 0.5 * pFilled) + 0.05);
        if (flags === 0) mk('h', 0.3 * shapeOk * (1 - pFilled + 0.2));
      } else {
        mk('q', (base - 0.12) * shapeOk * (0.55 + 0.45 * pFilled), { stemless: true });
        mk('w', 0.35 * shapeOk * (1 - pFilled + 0.3));
      }
    } else { // anneau creux
      if (stem) { mk('h', (base + 0.2) * shapeOk * (0.55 + 0.45 * (1 - pFilled)) + 0.03); mk('q', 0.3 * shapeOk * pFilled); }
      else { mk('w', (base + 0.06) * shapeOk * (0.55 + 0.45 * (1 - pFilled))); mk('q', 0.28 * pFilled); }
    }
    return out;
  }

  // dièse / bémol / bécarre / double dièse
  function accCandidates(prims, env) {
    const out = [];
    const body = prims.filter(p => p.k !== 'dot');
    if (!body.length) return out;
    const B = bboxOf(body);
    if (B.h < 0.7 || B.h > 4.6 || B.w < 0.4 || B.w > 2.6) return out;
    const vl = body.filter(p => p.k === 'line' && (p.o === 'v') && p.h >= Math.max(1.0, B.h * 0.5));
    const hl = body.filter(p => p.k === 'line' && (p.o === 'h' || p.o === '/' || p.o === '\\') && p.w >= B.w * 0.35 && p.h <= p.w * 0.7);
    // sharp / natural : deux verticales
    if (vl.length >= 2) {
      vl.sort((a, b) => a.cx - b.cx);
      const L = vl[0], R = vl[vl.length - 1];
      if (R.cx - L.cx >= 0.28 * Math.max(B.w, 0.6)) {
        const offset = Math.abs(L.cy - R.cy) / B.h;
        const exts = hl.map(p => Math.max(0, L.cx - p.x0) + Math.max(0, p.x1 - R.cx));
        const ext = exts.length ? Math.max(...exts) / Math.max(0.3, B.w) : 0;
        const sharpS = 0.5 + 0.2 * (offset < 0.22) + 0.15 * (hl.length >= 2) + 0.1 * (ext > 0.12) + 0.05 * (B.h / B.w > 1.6);
        const natS = 0.42 + 0.3 * (offset >= 0.28) + 0.12 * (hl.length >= 1 && hl.length <= 2 && ext < 0.2) + 0.05 * (R.cy > L.cy);
        out.push({ type: 'acc', a: '#', score: clamp(sharpS - (hl.length === 0 ? 0.25 : 0), 0, 1), cx: B.cx, cy: B.cy });
        out.push({ type: 'acc', a: 'n', score: clamp(natS - (hl.length === 0 ? 0.2 : 0), 0, 1), cx: B.cx, cy: B.cy });
      }
    }
    // une seule verticale + bosse en bas à droite : bémol
    const stems = body.filter(p => p.k === 'line' && p.o === 'v' && p.h >= 1.3);
    if (stems.length >= 1) {
      const st = stems.sort((a, b) => b.h - a.h)[0];
      const bump = body.filter(p => p !== st && (p.k === 'loop' || p.k === 'arc' || p.k === 'blob' || p.k === 'other' || p.k === 'zig') && p.cx > st.cx - 0.15);
      if (bump.length) {
        const bb = bboxOf(bump);
        const lowerHalf = bb.cy > st.y0 + 0.5 * st.h;
        const flush = Math.abs(bb.y1 - st.y1) < 0.55 + 0.1 * st.h;
        const small = bb.w <= 1.25 && bb.h <= 0.75 * st.h + 0.3;
        if (lowerHalf && flush && small && st.h >= 1.5) {
          const wNarrow = bb.w <= 0.95;
          out.push({ type: 'acc', a: 'b', score: clamp(0.62 + 0.14 * wNarrow + 0.1 * (bb.w >= 0.35) + 0.1 * (st.h >= 2.0), 0, 0.97), cx: B.cx, cy: B.cy + 0.35 });
        }
      }
    }
    // bémol dessiné d'un seul tenant (sans séparation boucle/queue réussie)
    if (body.length === 1 && body[0].k === 'other' || (body.length === 1 && body[0].k === 'arc')) {
      const p = body[0]; if (p.h >= 1.8 && p.w <= 1.3 && p.f.absTurn > 2.2) {
        // montée/descente verticale à gauche + bosse en bas à droite
        const R = p.f.R; const leftTall = R.filter(q => q.x < p.x0 + 0.3 * p.w); const yr = leftTall.length ? Math.max(...leftTall.map(q => q.y)) - Math.min(...leftTall.map(q => q.y)) : 0;
        const rightPts = R.filter(q => q.x > p.x0 + 0.55 * p.w);
        const ry0 = rightPts.length ? Math.min(...rightPts.map(q => q.y)) : 0;
        if (yr >= 0.6 * p.h && rightPts.length && ry0 > p.y0 + 0.35 * p.h) out.push({ type: 'acc', a: 'b', score: 0.7, cx: B.cx, cy: B.cy + 0.35 });
      }
    }
    // double dièse : petit « x »
    if (B.w <= 1.5 && B.h <= 1.5) {
      const dg = body.filter(p => p.k === 'line' && (p.o === '/' || p.o === '\\'));
      if (dg.length >= 2 && dg.some(p => p.o === '/') && dg.some(p => p.o === '\\')) out.push({ type: 'acc', a: 'x', score: 0.75, cx: B.cx, cy: B.cy });
    }
    // bécarre / zigzag « N » en un seul trait
    if (body.length === 1 && body[0].k === 'zig') {
      const p = body[0]; const S = p.f.S;
      if (S.length >= 4 && p.h >= 1.6 && p.w <= 1.4 && p.h / p.w >= 1.6) {
        const a0 = Math.atan2(S[1].y - S[0].y, S[1].x - S[0].x), a2 = Math.atan2(S[S.length - 1].y - S[S.length - 2].y, S[S.length - 1].x - S[S.length - 2].x);
        const vert = (a) => Math.abs(Math.sin(a)) >= 0.94;
        const l0 = Math.hypot(S[1].x - S[0].x, S[1].y - S[0].y), l2 = Math.hypot(S[S.length - 1].x - S[S.length - 2].x, S[S.length - 1].y - S[S.length - 2].y);
        if (vert(a0) && vert(a2) && l0 >= 0.3 * p.h && l2 >= 0.3 * p.h) out.push({ type: 'acc', a: 'n', score: 0.62, cx: B.cx, cy: B.cy });
      }
    }
    return out;
  }

  function restCandidates(prims, env) {
    const out = [];
    const body = prims.filter(p => p.k !== 'dot' || true);
    if (!body.length) return out;
    const B = bboxOf(body);
    // pause / demi-pause : petit rectangle plein, plus large que haut
    if (body.length <= 2) {
      const p = body.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
      const asp = p.w / Math.max(p.h, 0.05);
      const wide = p.w >= 0.9 && p.w <= 2.4 && p.h >= 0.2 && p.h <= 1.0 && (p.k === 'loop' ? (asp >= 2.4 && p.h <= 0.7) : asp >= 1.8);
      const kindOk = p.k === 'blob' || p.k === 'loop' || p.k === 'zig' || p.k === 'other' || (p.k === 'line' && p.o === 'h' && p.f.len >= 0.8);
      if (wide && kindOk) {
        const sc = (p.k === 'line' ? 0.5 : 0.8) * ((p.cy >= 0.7 && p.cy <= 2.5) ? 1 : 0.55); // une pause se place autour des lignes 3-4
        const whole = clamp(0.5 + (1.5 - p.cy) * 0.9, 0.12, 0.88), half = 1 - whole;
        out.push({ type: 'rest', d: 'w', score: sc * (0.45 + whole * 0.6), cx: p.cx, cy: p.cy });
        out.push({ type: 'rest', d: 'h', score: sc * (0.45 + half * 0.6), cx: p.cx, cy: p.cy });
      }
    }
    // soupir : zigzag vertical en un trait
    if (body.length === 1 && (body[0].k === 'zig' || body[0].k === 'other' || body[0].k === 'arc')) {
      const p = body[0];
      if (p.h >= 1.5 && p.h <= 4.2 && p.w <= 1.7 && p.h / p.w >= 1.2 && p.f.bends + p.f.sharp >= 2) {
        const S = p.f.S; let verticalEnds = false;
        if (S.length >= 4) {
          const a0 = Math.atan2(S[1].y - S[0].y, S[1].x - S[0].x), a2 = Math.atan2(S[S.length - 1].y - S[S.length - 2].y, S[S.length - 1].x - S[S.length - 2].x);
          verticalEnds = Math.abs(Math.sin(a0)) >= 0.94 && Math.abs(Math.sin(a2)) >= 0.94 && p.h / p.w >= 1.9;
        }
        out.push({ type: 'rest', d: 'q', score: verticalEnds ? 0.5 : 0.78, cx: p.cx, cy: p.cy });
      }
    }
    // demi-soupir / quart de soupir : diagonale « / » + 1 ou 2 points / crochets en haut
    const diag = body.filter(p => p.k === 'line' && (p.o === '/' || (p.o === 'v' && p.lean >= 0.13)) && p.h >= 1.2);
    if (diag.length) {
      const d = diag.sort((a, b) => b.h - a.h)[0];
      const others = body.filter(p => p !== d && (p.k === 'dot' || p.k === 'blob' || p.k === 'arc' || p.k === 'loop' || p.k === 'other' || p.k === 'zig' || (p.k === 'line' && p.length <= 1.3)) && p.cy < d.cy + 0.3 && p.cx <= d.cx + 0.25);
      if (others.length === body.length - 1 && others.length <= 2 && d.h <= 3.2) {
        // les éléments qui se touchent (point + crochet) comptent pour un seul
        const cl = [];
        others.forEach(o => { const g = cl.find(c => c.some(q => Math.max(0, Math.max(q.x0, o.x0) - Math.min(q.x1, o.x1)) < 0.4 && Math.max(0, Math.max(q.y0, o.y0) - Math.min(q.y1, o.y1)) < 0.4)); if (g) g.push(o); else cl.push([o]); });
        const n = cl.length;
        out.push({ type: 'rest', d: n >= 2 ? 's' : 'e', score: n === 0 ? 0.42 : 0.82, cx: B.cx, cy: B.cy });
        if (n === 1) out.push({ type: 'rest', d: 's', score: 0.3, cx: B.cx, cy: B.cy });
      }
    }
    // « 7 » en un trait : barre en haut + diagonale vers le bas gauche (demi-soupir)
    if (body.length === 1 && body[0].k === 'zig') {
      const p = body[0], S = p.f.S;
      if (S.length >= 3 && S.length <= 4 && p.h >= 1.2 && p.h <= 3.4 && p.w <= p.h * 0.9) {
        const lastDx = S[S.length - 1].x - S[S.length - 2].x, lastDy = S[S.length - 1].y - S[S.length - 2].y;
        if (lastDy > 0.6 * p.h * 0.6 && lastDx < 0) out.push({ type: 'rest', d: 'e', score: 0.6, cx: p.cx, cy: p.cy });
      }
    }
    return out;
  }

  function clefCandidates(prims, env) {
    const out = [];
    const pre = env.pre === 'clef';
    const body = prims.filter(p => p.k !== 'dot');
    const dots = prims.filter(p => p.k === 'dot' || (p.k === 'blob' && p.w <= 0.7 && p.h <= 0.7));
    if (!body.length) return out;
    const main = body.filter(p => !(p.k === 'blob' && p.w <= 0.7 && p.h <= 0.7));
    if (!main.length) return out;
    const B = bboxOf(main);
    const turnTot = main.reduce((a, p) => a + p.f.absTurn, 0);
    // clé de sol : grande, tourne beaucoup
    const tallest = main.reduce((a, p) => (p.h > a.h ? p : a), main[0]);
    if (B.h >= 3.0 && B.h <= 8 && B.w >= 0.9 && B.w <= 3.4 && B.h / B.w >= 1.3 && turnTot >= 5.0 && dots.length < 2 && tallest.h >= 2.6 && tallest.f.absTurn >= 3.6 && tallest.k !== 'line') {
      out.push({ type: 'clef', clef: 'treble', score: clamp(0.58 + 0.12 * (B.h >= 3.6) + 0.1 * (turnTot >= 7) + 0.18 * pre, 0, 0.98), cy: B.cy, cx: B.cx });
    }
    // clé de fa : courbe + 2 points à droite
    const ds = dots.filter(d => d.cx >= B.x0 + 0.35 * B.w);
    if (main.length <= 2 && B.h >= 1.5 && B.h <= 4.8 && B.w >= 0.9 && B.w <= 3.6) {
      const hasBig = main.some(p => p.k === 'arc' || p.k === 'other' || p.k === 'zig' || p.k === 'loop' || p.k === 'blob');
      if (hasBig && turnTot < 7.5) {
        if (ds.length >= 2) {
          const sep = Math.abs(ds[0].cy - ds[1].cy);
          out.push({ type: 'clef', clef: 'bass', score: clamp(0.66 + 0.1 * (sep >= 0.4 && sep <= 1.8) + 0.12 * pre + 0.08 * (B.h <= 3.6), 0, 0.98), cy: B.cy, cx: B.cx });
        } else if (pre && B.h >= 1.8) {
          out.push({ type: 'clef', clef: 'bass', score: 0.42, cy: B.cy, cx: B.cx });
        }
      }
    }
    // clé de sol dessinée aplatie dans la zone des clés : plus tolérant
    if (pre && !out.length && B.h >= 2.3 && B.h / Math.max(B.w, 0.3) >= 1.2 && turnTot >= 3.5) out.push({ type: 'clef', clef: 'treble', score: 0.45, cy: B.cy, cx: B.cx });
    return out;
  }

  function barCandidates(prims, env) {
    const out = [];
    const lines = prims.filter(p => p.k === 'line' && p.o === 'v');
    if (!lines.length || lines.length !== prims.length) {
      // trait fin + trait épais (blob vertical) = barre de fin
      const thick = prims.filter(p => (p.k === 'blob' || p.k === 'zig' || p.k === 'other') && p.h >= 2.6 && p.w <= 0.9);
      const thin = prims.filter(p => p.k === 'line' && p.o === 'v' && p.h >= 2.6);
      if (thick.length === 1 && thin.length === 1 && thick.length + thin.length === prims.length && thick[0].cx > thin[0].cx && thick[0].cx - thin[0].cx < 1.6) out.push({ type: 'bar', style: 'final', score: 0.8, cx: thick[0].cx });
      return out;
    }
    const tall = lines.filter(p => p.h >= 2.7);
    if (tall.length !== lines.length) return out;
    if (lines.length === 2 && lines.filter(p => p.thick).length === 1 && Math.abs(lines[0].cx - lines[1].cx) < 1.6) {
      const th = lines.find(p => p.thick), tn = lines.find(p => !p.thick);
      if (th.cx > tn.cx) return [{ type: 'bar', style: 'final', score: 0.82, cx: (th.cx + tn.cx) / 2 }];
    }
    const spans = (p) => p.y0 <= 1.1 && p.y1 >= 2.9;
    if (lines.length === 1) {
      const p = lines[0];
      out.push({ type: 'bar', style: 'single', score: (spans(p) ? 0.8 : 0.5) + (p.h >= 3.4 ? 0.08 : 0), cx: p.cx });
    } else if (lines.length === 2 && Math.abs(lines[0].cx - lines[1].cx) < 1.6) {
      out.push({ type: 'bar', style: 'double', score: 0.8, cx: (lines[0].cx + lines[1].cx) / 2 });
    }
    return out;
  }

  // chiffrage : groupes de chiffres en haut / en bas
  function digitCandidates(prims, env) {
    const out = [];
    const body = prims.filter(p => p.k !== 'dot' || true);
    if (!body.length) return out;
    const B = bboxOf(body);
    if (B.h < 1.0 || B.h > 6 || B.w > 5.5) return out;
    // « C » = 4/4
    if (body.length === 1 && body[0].k === 'arc' && body[0].h >= 1.4 && body[0].h <= 3.2 && body[0].w >= 0.8 && body[0].w <= 2.2 && body[0].f.absTurn >= 1.9 && body[0].f.turn !== 0) {
      const m = matchDigit([body[0].f.R]);
      const c = m.find(x => x.lab === 'C');
      if (c && c.score > 0.5) out.push({ type: 'ts', n: 4, d: 4, common: true, score: 0.6, cx: B.cx, cy: B.cy });
    }
    // séparer en rangées (haut / bas) selon le milieu de la portée (y = 2)
    const rows = [[], []];
    body.forEach(p => rows[p.cy < 2.0 ? 0 : 1].push(p));
    if (!rows[0].length || !rows[1].length) return out;
    const readRow = (ps) => {
      ps.sort((a, b) => a.x0 - b.x0);
      // regrouper les traits qui se chevauchent horizontalement
      const groups = [];
      ps.forEach(p => { const g = groups[groups.length - 1]; if (g && p.x0 <= g.x1 + 0.12) { g.items.push(p); g.x1 = Math.max(g.x1, p.x1); } else groups.push({ items: [p], x1: p.x1, x0: p.x0 }); });
      let txt = '', sc = 1;
      for (const g of groups) {
        const gb = bboxOf(g.items);
        if (gb.h < 0.7 || gb.h > 3.4) return null;
        const m = matchDigit(g.items.map(p => p.f.R));
        if (!m.length || m[0].lab === 'C') return null;
        txt += m[0].lab; sc = Math.min(sc, m[0].score);
      }
      return { txt, sc, n: groups.length };
    };
    const rb = [bboxOf(rows[0]), bboxOf(rows[1])];
    if (rb[0].y1 - rb[1].y0 > 0.9 || rb[0].h > 2.7 || rb[1].h > 2.7) return out; // deux rangées bien séparées, chiffres de taille normale
    const a = readRow(rows[0]), b = readRow(rows[1]);
    if (!a || !b) return out;
    if (env.allowDigits && !env.pre && (Math.min(a.sc, b.sc) < 0.75 || (a.txt === '1' && b.txt === '1'))) return out; // hors zone de chiffrage : lecture très sûre exigée
    const n = parseInt(a.txt, 10), d = parseInt(b.txt, 10);
    const dOk = [1, 2, 4, 8, 16, 32].includes(d); const nOk = n >= 1 && n <= 32;
    if (!nOk || !dOk) {
      // proposer quand même la meilleure lecture plausible
      out.push({ type: 'ts', n: nOk ? n : 4, d: dOk ? d : 4, score: 0.3 * Math.min(a.sc, b.sc), cx: B.cx, cy: B.cy, doubtful: true });
      return out;
    }
    out.push({ type: 'ts', n, d, score: clamp(0.35 + 0.65 * Math.min(a.sc, b.sc), 0, 0.97), cx: B.cx, cy: B.cy });
    return out;
  }

  function slurCandidates(prims, env) {
    const out = [];
    if (prims.length !== 1) return out;
    const p = prims[0];
    if (p.k === 'dot' || p.k === 'loop' || p.k === 'blob' || p.k === 'line') return out;
    if (p.w >= 1.7 && p.h <= 0.62 * p.w && p.f.chord >= 1.4) {
      // arc : presque tous les points du même côté de la corde, creux modéré (robuste aux tremblements d'un long trait)
      const f = p.f, a = f.first, b = f.last; const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      let pos = 0, neg = 0, maxSag = 0, reversals = 0, lastSign = 0;
      f.R.forEach((q, i) => { const side = (dx * (q.y - a.y) - dy * (q.x - a.x)) / L; if (Math.abs(side) > 0.05) { if (side > 0) pos++; else neg++; } maxSag = Math.max(maxSag, Math.abs(side)); });
      const one = Math.max(pos, neg) / Math.max(1, pos + neg);
      const sagR = maxSag / L;
      // le trait avance globalement de gauche à droite (ou inversement) sans revenir sur lui-même
      let back = 0; f.R.forEach((q, i) => { if (i && Math.sign((q.x - f.R[i - 1].x) * dx) < 0) back++; });
      if (one >= 0.85 && sagR >= 0.06 && sagR <= 0.5 && back <= 0.1 * f.R.length && f.sharp <= 2) {
        const mid = f.R[Math.floor(f.R.length / 2)]; const baseY = (a.y + b.y) / 2;
        out.push({ type: 'slur', x1: a.x, y1: a.y, x2: b.x, y2: b.y, up: mid.y < baseY, score: 0.74, cx: p.cx, cy: p.cy });
      }
    }
    return out;
  }
  function beamCandidates(prims, env) {
    const out = [];
    if (prims.length !== 1) return out;
    const p = prims[0];
    if (p.k === 'line' && (p.o === 'h' || ((p.o === '/' || p.o === '\\') && p.h <= 0.4 * p.w)) && p.w >= 1.8) {
      out.push({ type: 'beam', x1: p.f.first.x, y1: p.f.first.y, x2: p.f.last.x, y2: p.f.last.y, score: 0.62, cx: p.cx, cy: p.cy });
    }
    return out;
  }
  function dotCandidates(prims) {
    if (prims.length === 1 && (prims[0].k === 'dot' || (prims[0].k === 'blob' && prims[0].w < 0.7))) return [{ type: 'dot', cx: prims[0].cx, cy: prims[0].cy, score: 0.7 }];
    return [];
  }
  function scratchCandidates(prims) {
    if (prims.length === 1 && prims[0].k === 'zig' && prims[0].f.sharp >= 3 && (prims[0].w >= 2.0 || prims[0].h >= 3.0) && prims[0].f.len >= 3 * Math.hypot(prims[0].w, prims[0].h) * 0.8) {
      return [{ type: 'scratch', x0: prims[0].x0, x1: prims[0].x1, y0: prims[0].y0, y1: prims[0].y1, cx: prims[0].cx, cy: prims[0].cy, score: 0.8 }];
    }
    return [];
  }

  // ---------------------------------------------------------------- point d'entrée
  const LABELS = {
    note: { w: 'Ronde', h: 'Blanche', q: 'Noire', e: 'Croche', s: 'Double croche', t: 'Triple croche' },
    rest: { w: 'Pause', h: 'Demi-pause', q: 'Soupir', e: 'Demi-soupir', s: 'Quart de soupir' },
    acc: { '#': 'Dièse', b: 'Bémol', n: 'Bécarre', x: 'Double dièse', bb: 'Double bémol' },
  };

  function recognize(strokes, env) {
    env = env || {};
    const prims = makePrims(strokes);
    if (!prims.length) return [];
    let cands = [];
    const pre = env.pre;
    if (pre === 'ts') cands.push(...digitCandidates(prims, env));
    else if (pre === 'clef') cands.push(...clefCandidates(prims, env), ...accCandidates(prims, env).map(c => Object.assign(c, { score: c.score * 0.6 })));
    else if (pre === 'key') cands.push(...accCandidates(prims, env), ...clefCandidates(prims, env).map(c => Object.assign(c, { score: c.score * 0.7 })));
    else {
      cands.push(...noteCandidates(prims, env));
      cands.push(...restCandidates(prims, env));
      cands.push(...accCandidates(prims, env));
      cands.push(...clefCandidates(prims, env).map(c => Object.assign(c, { score: c.score * 0.92 })));
      cands.push(...barCandidates(prims, env));
      cands.push(...slurCandidates(prims, env));
      cands.push(...beamCandidates(prims, env));
      cands.push(...dotCandidates(prims));
      cands.push(...scratchCandidates(prims));
      if (env.allowDigits) cands.push(...digitCandidates(prims, env));
    }
    // une note n'est jamais à la fois blob-large (pause) : arbitrage simple
    cands.forEach(c => {
      c.label = c.type === 'note' ? LABELS.note[c.dur] + (c.dots ? ' pointée' : '') : c.type === 'rest' ? LABELS.rest[c.d] : c.type === 'acc' ? LABELS.acc[c.a]
        : c.type === 'clef' ? (c.clef === 'treble' ? 'Clé de sol' : 'Clé de fa') : c.type === 'bar' ? (c.style === 'single' ? 'Barre de mesure' : c.style === 'double' ? 'Double barre' : 'Barre finale')
          : c.type === 'ts' ? 'Chiffrage ' + c.n + '/' + c.d : c.type === 'slur' ? 'Liaison' : c.type === 'beam' ? 'Ligature' : c.type === 'dot' ? 'Point' : c.type === 'scratch' ? 'Effacer' : c.type;
    });
    cands.sort((a, b) => b.score - a.score);
    // pas de doublon d'étiquette
    const seen = new Set(); cands = cands.filter(c => { const k = c.label; if (seen.has(k)) return false; seen.add(k); return true; });
    return cands;
  }

  Object.assign(P, { recognize, makePrims, features, classify, matchDigit, resample, recoInternals: { orient, splitLoopTail, cloudOf, templates } });
  if (typeof module === 'object') module.exports = P;
})();
