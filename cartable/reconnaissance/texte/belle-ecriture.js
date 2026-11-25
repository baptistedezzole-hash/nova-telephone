// Belle écriture : le texte reconnu (texte.js) est réécrit au même endroit, dans une jolie police manuscrite
// (Caveat ou Dancing Script, hors ligne, polices/), à la taille de l'écriture d'origine, posé sur les lignes du papier.
// UMD : page (window.BelleEcriture) ou Node (require). Aucune dépendance.
//
//   await BelleEcriture.chargerPolices('../reconnaissance/polices/')   // une fois, dans la page
//   const mp = BelleEcriture.mettreEnPage(resultat.lignes, { police: 'caveat', lignesPapier: { y0: 120, pas: 34 } })
//   BelleEcriture.dessiner(ctx, mp, { couleur: '#1c2a6b' })
//
// mettreEnPage est pur (testable sans canvas) : [{ texte, x, yBase, taille, police, largeurMax }].
(function (racine, fabrique) {
  const M = fabrique();
  if (typeof module === 'object' && module.exports) module.exports = M; else racine.BelleEcriture = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const POLICES = {
    caveat: { famille: 'Cartable Caveat', fichier: 'Caveat.ttf', corps: 1.25, base: 0.80 },          // corps = taille / hauteur de la ligne écrite
    dancing: { famille: 'Cartable Dancing', fichier: 'DancingScript.ttf', corps: 1.15, base: 0.80 },
  };
  const nombre = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  async function chargerPolices(base) {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    base = String(base || '').replace(/\/?$/, '/');
    await Promise.all(Object.values(POLICES).map(async (p) => {
      if ([...document.fonts].some(f => f.family.replace(/"/g, '') === p.famille)) return;
      const f = new FontFace(p.famille, `url("${base}${p.fichier}")`); await f.load(); document.fonts.add(f);
    }));
    return true;
  }

  // lignes : [{ texte, x, y, l, h, mots? }] (repère de la feuille). opts : police, lignesPapier {y0, pas}, tailleMin, tailleMax
  function mettreEnPage(lignes, opts = {}) {
    const P = POLICES[opts.police] || POLICES.caveat;
    const lp = opts.lignesPapier && nombre(opts.lignesPapier.pas, 0) > 0 ? opts.lignesPapier : null;
    const sortie = [];
    for (const L of Array.isArray(lignes) ? lignes : []) {
      if (!L || typeof L.texte !== 'string' || !L.texte.trim()) continue;
      const x = nombre(L.x, 0), y = nombre(L.y, 0), l = Math.max(1, nombre(L.l, 1)), h = Math.max(1, nombre(L.h, 1));
      // hauteur utile : la boîte d'une ligne inclut hampes et jambages ; on prend le corps médian des mots si possible
      const hs = (L.mots || []).map(m => nombre(m.h, 0)).filter(v => v > 0).sort((a, b) => a - b);
      const hRef = hs.length ? hs[hs.length >> 1] : h;
      let taille = hRef * P.corps;
      if (lp) taille = Math.min(taille, lp.pas * 1.1);
      taille = Math.max(nombre(opts.tailleMin, 6), Math.min(nombre(opts.tailleMax, 400), taille));
      let yBase = y + h * P.base;
      if (lp) { // pose sur la ligne du papier la plus proche du pied des lettres
        const k = Math.round((yBase - lp.y0) / lp.pas); const yl = lp.y0 + k * lp.pas;
        if (Math.abs(yl - yBase) < lp.pas * 0.5) yBase = yl - Math.max(1, lp.pas * 0.08);
      }
      sortie.push({ texte: L.texte, x, yBase, taille, police: P.famille, largeurMax: l * 1.25 });
    }
    return sortie;
  }

  function dessiner(ctx, mp, opts = {}) {
    ctx.save(); ctx.fillStyle = opts.couleur || '#1c2a6b'; ctx.textBaseline = 'alphabetic';
    for (const e of mp) {
      let t = e.taille; ctx.font = `${t}px "${e.police}"`;
      const w = ctx.measureText(e.texte).width;
      if (w > e.largeurMax) { t *= e.largeurMax / w; ctx.font = `${t}px "${e.police}"`; } // ne déborde pas de l'écriture d'origine
      ctx.fillText(e.texte, e.x, e.yBase);
    }
    ctx.restore();
  }

  return { POLICES, chargerPolices, mettreEnPage, dessiner };
});
