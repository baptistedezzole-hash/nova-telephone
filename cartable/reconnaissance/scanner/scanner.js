/* Cartable - scanner de document par photo (navigateur ET Node, aucune dépendance, hors ligne).
   Les images sont des objets « ImageData » : { width, height, data: Uint8ClampedArray RGBA }.

   const s = Scanner.scanner(photo, { mode: 'couleur'|'gris'|'nb', largeurMax: 1800 })
     -> { image, coins: [hautGauche, hautDroite, basDroite, basGauche], confiance: 0..1, largeur, hauteur }
   Scanner.detecter(photo)              -> { coins, confiance }        (pour afficher le cadre et le laisser ajuster)
   Scanner.redresser(photo, coins, o)   -> image redressée (perspective corrigée)
   Scanner.nettoyer(image, mode)        -> image « scannée » (fond blanc, encre nette)
   Navigateur : Scanner.depuisImage(<img|canvas|bitmap>) -> ImageData ; Scanner.versCanvas(image) -> <canvas> ;
                Scanner.versFeuille(resultat) -> { dataUrl, largeur, hauteur, ratio, coins }  (pour poser la feuille sur le bureau) */
(function () {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  const MAX_PIXELS = 40e6; // garde-fou : 40 mégapixels au plus

  function verifier(img) {
    if (!img || !(img.width > 0) || !(img.height > 0) || !img.data || img.data.length < img.width * img.height * 4) throw new Error('image invalide');
    if (img.width * img.height > MAX_PIXELS) throw new Error('image trop grande');
  }
  const nouvelle = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

  // ---------- petite image en gris (moyenne par blocs) ----------
  function reduireGris(img, cote) {
    const k = Math.max(1, Math.max(img.width, img.height) / cote);
    const w = Math.max(8, Math.round(img.width / k)), h = Math.max(8, Math.round(img.height / k));
    const g = new Float32Array(w * h), n = new Float32Array(w * h), d = img.data;
    const pas = Math.max(1, Math.floor(k / 3)); // échantillonne quelques pixels par bloc (rapide)
    for (let y = 0; y < img.height; y += pas) {
      const yy = Math.min(h - 1, Math.floor(y / img.height * h));
      for (let x = 0; x < img.width; x += pas) {
        const xx = Math.min(w - 1, Math.floor(x / img.width * w)), o = (y * img.width + x) * 4;
        g[yy * w + xx] += 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]; n[yy * w + xx]++;
      }
    }
    for (let i = 0; i < g.length; i++) g[i] = n[i] ? g[i] / n[i] : 0;
    return { g, w, h, kx: img.width / w, ky: img.height / h };
  }
  function flou(g, w, h, r) { // flou boîte séparable
    const t = new Float32Array(g.length), o = new Float32Array(g.length);
    for (let y = 0; y < h; y++) { let s = 0, c = 0; for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) { s += g[y * w + x + r]; c++; } if (x - r - 1 >= 0) { s -= g[y * w + x - r - 1]; c--; } if (x >= 0 && x < w) t[y * w + x] = s / c; } }
    for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) { s += t[(y + r) * w + x]; c++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * w + x]; c--; } if (y >= 0 && y < h) o[y * w + x] = s / c; } }
    return o;
  }
  function otsu(g) {
    const hist = new Float64Array(256); for (const v of g) hist[Math.max(0, Math.min(255, v | 0))]++;
    let tot = g.length, sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, seuil = 128;
    for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; seuil = i; } }
    return seuil;
  }

  // ---------- géométrie ----------
  function enveloppe(pts) { // enveloppe convexe (chaîne monotone)
    const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y); if (p.length < 3) return p;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  const aireTri = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  const airePoly = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; };
  function quadMax(H) { // quadrilatère d'aire max inscrit dans l'enveloppe (O(n^3), n réduit)
    let h = H; if (h.length > 80) { const k = h.length / 80; h = Array.from({ length: 80 }, (_, i) => H[Math.floor(i * k)]); }
    const n = h.length; if (n < 4) return null; let best = -1, Q = null;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      let a1 = -1, k1 = -1, a2 = -1, k2 = -1;
      for (let k = i + 1; k < j; k++) { const a = aireTri(h[i], h[k], h[j]); if (a > a1) { a1 = a; k1 = k; } }
      for (let k = j + 1; k < n + i; k++) { const a = aireTri(h[i], h[k % n], h[j]); if (a > a2) { a2 = a; k2 = k % n; } }
      if (k1 >= 0 && k2 >= 0 && a1 + a2 > best) { best = a1 + a2; Q = [h[i], h[k1], h[j], h[k2]]; }
    }
    return Q;
  }
  function ordonner(Q) { // haut-gauche, haut-droite, bas-droite, bas-gauche
    const c = { x: Q.reduce((s, p) => s + p.x, 0) / 4, y: Q.reduce((s, p) => s + p.y, 0) / 4 };
    const t = Q.slice().sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x)); // sens horaire (y vers le bas)
    let i0 = 0, m = Infinity; t.forEach((p, i) => { if (p.x + p.y < m) { m = p.x + p.y; i0 = i; } });
    return [0, 1, 2, 3].map(k => t[(i0 + k) % 4]);
  }
  function droite(pts) { // ajustement total (moindres carrés orthogonaux) : point + direction
    const n = pts.length; let mx = 0, my = 0; for (const p of pts) { mx += p.x; my += p.y; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { x: mx, y: my, dx: Math.cos(a), dy: Math.sin(a) };
  }
  function inter(L1, L2) {
    const d = L1.dx * L2.dy - L1.dy * L2.dx; if (Math.abs(d) < 1e-9) return null;
    const t = ((L2.x - L1.x) * L2.dy - (L2.y - L1.y) * L2.dx) / d; return { x: L1.x + t * L1.dx, y: L1.y + t * L1.dy };
  }
  function distSeg(p, a, b) { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)); return { d: Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy), t }; }

  // ---------- détection du document ----------
  function detecter(img, o = {}) {
    verifier(img);
    const R = reduireGris(img, o.cote || 420); const { w, h } = R;
    const g = flou(R.g, w, h, 1);
    const tout = { coins: [{ x: 0, y: 0 }, { x: img.width, y: 0 }, { x: img.width, y: img.height }, { x: 0, y: img.height }], confiance: 0 };
    // essais : seuil global d'Otsu, puis seuils plus ou moins hauts (papier sur fond clair, ombres)
    // 1) croissance de région depuis le centre (suit un éclairage inégal), 2) seuils globaux (Otsu et voisins)
    const masques = [3, 5, 8].map(t => croissance(g, w, h, t));
    const s0 = otsu(g); [s0, s0 + 18, s0 - 18, s0 + 36].forEach(seuil => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = g[i] > seuil ? 1 : 0; masques.push(m); });
    // 3) même chose sur l'image « aplanie » : l'éclairage lent (lampe, pénombre) est retiré, le papier ressort même sur fond clair
    const ga = aplanir(g, w, h), sa = otsu(ga);
    masques.push(...[3, 5].map(t => croissance(ga, w, h, t)));
    [sa, sa + 12, sa - 12].forEach(seuil => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = ga[i] > seuil ? 1 : 0; masques.push(m); });
    if (o.debug) Object.assign(o.debug, { masques, w, h, g: ga });
    let meilleur = null;
    for (const m of masques) {
      const cand = composante(m, w, h, g); if (!cand) continue;
      if (!meilleur || cand.note > meilleur.note) meilleur = cand;
    }
    if (!meilleur || meilleur.note < 0.35) return tout;
    let coins = meilleur.coins.map(p => ({ x: (p.x + 0.5) * R.kx, y: (p.y + 0.5) * R.ky }));
    try { coins = affiner(img, coins, 2.5 * Math.max(R.kx, R.ky)); } catch (e) { /* garde les coins grossiers */ }
    return { coins, confiance: +Math.min(1, meilleur.note).toFixed(2) };
  }
  // éclairage lent : surface quadratique ajustée sur log(luminosité), retirée (image ramenée autour de 128)
  function aplanir(g, w, h) {
    const N = 6, A = Array.from({ length: N }, () => new Float64Array(N + 1));
    const base = (x, y) => [1, x, y, x * x, x * y, y * y];
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const b = base(x / w - 0.5, y / h - 0.5), v = Math.log(Math.max(4, g[y * w + x]));
      for (let i = 0; i < N; i++) { for (let j = 0; j < N; j++) A[i][j] += b[i] * b[j]; A[i][N] += b[i] * v; }
    }
    for (let i = 0; i < N; i++) { // élimination de Gauss avec pivot
      let p = i; for (let r = i + 1; r < N; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]];
      const d = A[i][i] || 1e-12; for (let r = 0; r < N; r++) if (r !== i) { const f = A[r][i] / d; for (let c = i; c <= N; c++) A[r][c] -= f * A[i][c]; }
    }
    const coef = A.map((r, i) => r[N] / (r[i] || 1e-12));
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const b = base(x / w - 0.5, y / h - 0.5); let s = 0; for (let i = 0; i < N; i++) s += coef[i] * b[i];
      o[y * w + x] = Math.max(0, Math.min(255, 128 * g[y * w + x] / Math.exp(s)));
    }
    return o;
  }
  // région connexe autour du centre : on avance tant que la luminosité varie peu d'un pixel au voisin
  function croissance(g, w, h, tol) {
    const m = new Uint8Array(w * h), pile = new Int32Array(w * h); let sp = 0;
    // graine : le pixel le plus clair (médian local) près du centre
    let gi = ((h >> 1) * w + (w >> 1)), gv = -1;
    for (let y = Math.round(h * 0.4); y < h * 0.6; y += 2) for (let x = Math.round(w * 0.4); x < w * 0.6; x += 2) { const v = g[y * w + x]; if (v > gv) { gv = v; gi = y * w + x; } }
    m[gi] = 1; pile[sp++] = gi;
    while (sp) {
      const p = pile[--sp], x = p % w, v = g[p];
      const voisin = (q) => { if (!m[q] && Math.abs(g[q] - v) < tol && g[q] > gv * 0.45) { m[q] = 1; pile[sp++] = q; } };
      if (x > 0) voisin(p - 1); if (x < w - 1) voisin(p + 1); if (p >= w) voisin(p - w); if (p < w * (h - 1)) voisin(p + w);
    }
    return m;
  }
  // affinage à pleine résolution : sur chaque côté, on cherche le saut de luminosité le long de la normale puis on ajuste une droite
  function affiner(img, coins, rayon) {
    const W = img.width, H = img.height, d = img.data;
    const lum = (x, y) => { x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y)); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0; const L = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const o = (y0 * W + x0) * 4; return (L(o) * (1 - fx) + L(o + 4) * fx) * (1 - fy) + (L(o + W * 4) * (1 - fx) + L(o + W * 4 + 4) * fx) * fy; };
    const c = { x: coins.reduce((s, p) => s + p.x, 0) / 4, y: coins.reduce((s, p) => s + p.y, 0) / 4 };
    const cotes = [0, 1, 2, 3].map(k => {
      const a = coins[k], b = coins[(k + 1) % 4], L = Math.hypot(b.x - a.x, b.y - a.y), tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
      let nx = -ty, ny = tx; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; if ((mx - c.x) * nx + (my - c.y) * ny < 0) { nx = -nx; ny = -ny; } // normale vers l'extérieur
      const pts = [];
      for (let i = 1; i < 48; i++) {
        const t = 0.08 + 0.84 * i / 48, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        let best = 0, bs = 0;
        for (let s = -rayon; s <= rayon; s += 0.5) {
          const v = lum(px + nx * (s - 1.5), py + ny * (s - 1.5)) - lum(px + nx * (s + 1.5), py + ny * (s + 1.5)); // dedans clair - dehors
          if (v > best) { best = v; bs = s; }
        }
        if (best > 12) pts.push({ x: px + nx * bs, y: py + ny * bs });
      }
      if (pts.length < 10) return { x: a.x, y: a.y, dx: tx, dy: ty };
      let D = droite(pts);
      const ecartD = (p) => Math.abs((p.x - D.x) * D.dy - (p.y - D.y) * D.dx);
      const garde = pts.slice().sort((p, q) => ecartD(p) - ecartD(q)).slice(0, Math.ceil(pts.length * 0.7)); D = droite(garde);
      return D;
    });
    const Q = [0, 1, 2, 3].map(k => inter(cotes[(k + 3) % 4], cotes[k]));
    if (!Q.every((p, i) => p && Math.hypot(p.x - coins[i].x, p.y - coins[i].y) < rayon * 4)) return coins;
    return Q;
  }
  // plus grande zone claire proche du centre -> quadrilatère
  function composante(m, w, h, g) {
    const lab = new Int32Array(w * h).fill(-1), comps = []; const pile = new Int32Array(w * h);
    for (let i = 0; i < m.length; i++) {
      if (!m[i] || lab[i] >= 0) continue;
      let sp = 0, aire = 0, sx = 0, sy = 0, bord = 0; pile[sp++] = i; lab[i] = comps.length;
      while (sp) {
        const p = pile[--sp]; const x = p % w, y = (p / w) | 0; aire++; sx += x; sy += y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) bord++;
        if (x > 0 && m[p - 1] && lab[p - 1] < 0) { lab[p - 1] = comps.length; pile[sp++] = p - 1; }
        if (x < w - 1 && m[p + 1] && lab[p + 1] < 0) { lab[p + 1] = comps.length; pile[sp++] = p + 1; }
        if (y > 0 && m[p - w] && lab[p - w] < 0) { lab[p - w] = comps.length; pile[sp++] = p - w; }
        if (y < h - 1 && m[p + w] && lab[p + w] < 0) { lab[p + w] = comps.length; pile[sp++] = p + w; }
      }
      comps.push({ aire, cx: sx / aire, cy: sy / aire, bord });
    }
    let best = -1, bi = -1;
    comps.forEach((c, i) => {
      if (c.aire < 0.08 * w * h) return;
      const dc = Math.hypot(c.cx / w - 0.5, c.cy / h - 0.5);
      const v = c.aire * (1.2 - dc);
      if (v > best) { best = v; bi = i; }
    });
    if (bi < 0) return null;
    // points de contour de la composante
    const contour = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (lab[p] !== bi) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[p - 1] !== bi || lab[p + 1] !== bi || lab[p - w] !== bi || lab[p + w] !== bi) contour.push({ x, y });
    }
    const H = enveloppe(contour); const Q0 = quadMax(H); if (!Q0) return null;
    let Q = ordonner(Q0);
    // affinage : une droite par côté avec les points de contour proches de ce côté (coins arrondis, bords écornés)
    const cotes = [0, 1, 2, 3].map(k => {
      const a = Q[k], b = Q[(k + 1) % 4], L = Math.hypot(b.x - a.x, b.y - a.y);
      const pts = contour.filter(p => { const r = distSeg(p, a, b); return r.d < Math.max(2, L * 0.03) && r.t > 0.12 && r.t < 0.88; });
      return pts.length > 6 ? droite(pts) : { x: a.x, y: a.y, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L };
    });
    const Q2 = [0, 1, 2, 3].map(k => inter(cotes[(k + 3) % 4], cotes[k]));
    if (Q2.every(p => p && p.x > -0.1 * w && p.x < 1.1 * w && p.y > -0.1 * h && p.y < 1.1 * h)) Q = Q2;
    const aireC = lab.reduce((s, v) => s + (v === bi ? 1 : 0), 0), aireQ = airePoly(Q);
    // note : la zone remplit bien le quadrilatère, elle est assez grande, les angles sont plausibles
    const rempli = Math.min(aireC, aireQ) / Math.max(aireC, aireQ);
    const taille = Math.min(1, aireQ / (0.2 * w * h));
    const touche = comps[bi].bord / (2 * (w + h)); // part du cadre de la photo touchée : un fond qui déborde partout n'est pas une feuille
    const pasBord = touche > 0.08 ? Math.max(0.05, 1 - touche * 4) : 1;
    let angles = 1; for (let k = 0; k < 4; k++) { const a = Q[(k + 3) % 4], b = Q[k], c = Q[(k + 1) % 4]; const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y }; const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)); if (Math.abs(cos) > 0.75) angles *= 0.4; }
    // netteté : un vrai bord de feuille est un saut de luminosité (dedans plus clair) tout le long des 4 côtés ;
    // une limite d'éclairage (pénombre, lampe) n'en a pas
    const lire = (x, y) => g[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))];
    const cx = Q.reduce((s, p) => s + p.x, 0) / 4, cy = Q.reduce((s, p) => s + p.y, 0) / 4;
    let nette = 1;
    for (let k = 0; k < 4; k++) {
      const a = Q[k], b = Q[(k + 1) % 4], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
      let bons = 0, n = 0;
      for (let i = 1; i < 30; i++) { const t = 0.1 + 0.8 * i / 30, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t; if (px < 3 || py < 3 || px > w - 4 || py > h - 4) continue; n++; if (lire(px - nx * 3, py - ny * 3) - lire(px + nx * 3, py + ny * 3) > 10) bons++; }
      if (n > 5) nette = Math.min(nette, bons / n);
    }
    nette = 0.25 + 0.75 * Math.min(1, nette / 0.7);
    return { coins: Q, note: rempli * taille * angles * pasBord * nette, debug: [rempli, taille, angles, pasBord, nette].map(v => +v.toFixed(2)).join(" ") };
  }

  // ---------- redressement ----------
  function homographie(src, dst) { // H tel que dst ~ H * src (8 inconnues)
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) { // Gauss avec pivot partiel
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) throw new Error('coins dégénérés');
      for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    return [...b.map((v, i) => v / A[i][i]), 1];
  }
  function tailleSortie(c, largeurMax) {
    const d = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    let L = Math.max(d(c[0], c[1]), d(c[3], c[2])), H = Math.max(d(c[0], c[3]), d(c[1], c[2]));
    const r = H / L; // proche du format A4 (1,414) : on le respecte
    if (Math.abs(r - Math.SQRT2) < 0.12) H = L * Math.SQRT2; else if (Math.abs(1 / r - Math.SQRT2) < 0.12) L = H * Math.SQRT2;
    const k = Math.min(1, largeurMax / Math.max(L, H)); return { l: Math.max(16, Math.round(L * k)), h: Math.max(16, Math.round(H * k)) };
  }
  function redresser(img, coins, o = {}) {
    verifier(img); if (!Array.isArray(coins) || coins.length !== 4 || !coins.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('coins invalides');
    const t = o.largeur && o.hauteur ? { l: Math.min(8000, o.largeur | 0), h: Math.min(8000, o.hauteur | 0) } : tailleSortie(coins, o.largeurMax || 1800);
    const out = nouvelle(t.l, t.h);
    const M = homographie([{ x: 0, y: 0 }, { x: t.l, y: 0 }, { x: t.l, y: t.h }, { x: 0, y: t.h }], coins);
    const W = img.width, Hh = img.height, s = img.data, d = out.data;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.l; x++) {
      const X = x + 0.5, Y = y + 0.5, z = M[6] * X + M[7] * Y + M[8];
      let u = (M[0] * X + M[1] * Y + M[2]) / z - 0.5, v = (M[3] * X + M[4] * Y + M[5]) / z - 0.5;
      u = Math.max(0, Math.min(W - 1.001, u)); v = Math.max(0, Math.min(Hh - 1.001, v));
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, o0 = (y0 * W + x0) * 4, o1 = o0 + W * 4, oo = (y * t.l + x) * 4;
      for (let c = 0; c < 3; c++) d[oo + c] = (s[o0 + c] * (1 - fx) + s[o0 + 4 + c] * fx) * (1 - fy) + (s[o1 + c] * (1 - fx) + s[o1 + 4 + c] * fx) * fy;
      d[oo + 3] = 255;
    }
    return out;
  }

  // ---------- nettoyage « scan » ----------
  // fond estimé par un « max puis flou » à grande échelle, puis division : le papier devient blanc, les ombres disparaissent
  function nettoyer(img, mode = 'couleur') {
    verifier(img);
    const { width: w, height: h, data: s } = img; const out = nouvelle(w, h), d = out.data;
    const k = Math.max(4, Math.round(Math.max(w, h) / 90)); // cellule du fond
    const bw = Math.ceil(w / k), bh = Math.ceil(h / k);
    const fond = [0, 1, 2].map(() => new Float32Array(bw * bh));
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const vals = [[], [], []];
      for (let y = by * k; y < Math.min(h, by * k + k); y += 2) for (let x = bx * k; x < Math.min(w, bx * k + k); x += 2) { const o = (y * w + x) * 4; vals[0].push(s[o]); vals[1].push(s[o + 1]); vals[2].push(s[o + 2]); }
      for (let c = 0; c < 3; c++) { const v = vals[c].sort((a, b) => a - b); fond[c][by * bw + bx] = v[Math.floor(v.length * 0.9)] || 255; } // 90e centile = papier
    }
    // dilatation (l'encre épaisse ne doit pas assombrir le fond) puis lissage
    const lisse = fond.map(f => { let a = f; for (let it = 0; it < 2; it++) { const b = new Float32Array(a.length); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) m = Math.max(m, a[yy * bw + xx]); } b[y * bw + x] = m; } a = b; } return flou(a, bw, bh, 2); });
    const echant = (f, x, y) => { const u = Math.max(0, Math.min(bw - 1.001, x / k - 0.5)), v = Math.max(0, Math.min(bh - 1.001, y / k - 0.5)); const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0; return (f[y0 * bw + x0] * (1 - fx) + f[y0 * bw + x0 + 1] * fx) * (1 - fy) + (f[(y0 + 1) * bw + x0] * (1 - fx) + f[(y0 + 1) * bw + x0 + 1] * fx) * fy; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; const r = [0, 1, 2].map(c => Math.min(1.2, s[o + c] / Math.max(30, echant(lisse[c], x, y))));
      if (mode === 'couleur') {
        for (let c = 0; c < 3; c++) { let v = r[c]; v = v > 0.92 ? 1 : Math.pow(Math.max(0, (v - 0.06) / 0.86), 1.6); d[o + c] = 255 * v; } // blanc franc, encre plus dense
      } else {
        const l = 0.299 * r[0] + 0.587 * r[1] + 0.114 * r[2];
        let v = mode === 'nb' ? (l > 0.78 ? 1 : 0) : (l > 0.9 ? 1 : Math.pow(Math.max(0, (l - 0.06) / 0.84), 1.7));
        d[o] = d[o + 1] = d[o + 2] = 255 * v;
      }
      d[o + 3] = 255;
    }
    if (mode === 'nb') lisserNb(out);
    return out;
  }
  function lisserNb(img) { // enlève les points noirs isolés (poussière, bruit du capteur)
    const { width: w, height: h, data: d } = img; const copie = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) copie[i] = d[i * 4] < 128 ? 1 : 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!copie[i]) continue; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += copie[i + dy * w + dx]; if (n <= 2) { const o = i * 4; d[o] = d[o + 1] = d[o + 2] = 255; } }
  }

  function scanner(img, o = {}) {
    const det = o.coins ? { coins: o.coins, confiance: 1 } : detecter(img, o);
    const r = redresser(img, det.coins, o);
    const image = o.mode === 'brut' ? r : nettoyer(r, o.mode || 'couleur');
    return { image, coins: det.coins, confiance: det.confiance, largeur: image.width, hauteur: image.height };
  }

  // ---------- aides navigateur ----------
  function depuisImage(source, cote = 3000) {
    const w0 = source.naturalWidth || source.videoWidth || source.width, h0 = source.naturalHeight || source.videoHeight || source.height;
    const k = Math.min(1, cote / Math.max(w0, h0)); const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(source, 0, 0, c.width, c.height); return x.getImageData(0, 0, c.width, c.height);
  }
  function versCanvas(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0); return c;
  }
  function versFeuille(res, type = 'image/jpeg', qualite = 0.92) {
    const dataUrl = versCanvas(res.image).toDataURL(type, qualite);
    return { dataUrl, largeur: res.largeur, hauteur: res.hauteur, ratio: res.hauteur / res.largeur, coins: res.coins };
  }

  const Scanner = { scanner, detecter, redresser, nettoyer, homographie, depuisImage, versCanvas, versFeuille };
  G.Scanner = Scanner;
  if (typeof module === 'object' && module.exports) module.exports = Scanner;
})();
