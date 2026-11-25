// Cartable, interface : petits outils communs (ressorts, boucle d'animation unique, vitesse du doigt, mesure des images par seconde).
"use strict";
window.Cartable = window.Cartable || {};
(function (C) {
  const U = C.U = {};
  U.borne = (v, a, b) => Math.max(a, Math.min(b, v));
  U.melange = (a, b, t) => a + (b - a) * t;
  U.id = (p) => (p || "c") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  U.el = (balise, classe, parent) => { const e = document.createElement(balise); if (classe) e.className = classe; if (parent) parent.appendChild(e); return e; };
  U.toile = (l, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(l)); c.height = Math.max(1, Math.round(h)); return c; };
  U.tactile = () => matchMedia("(pointer: coarse)").matches;

  // Courbes
  U.douce = (t) => 1 - Math.pow(1 - t, 3);
  U.douce2 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.rebond = (t) => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  // ---- Horloge : réelle, ou manuelle pour les essais (captures d'animation image par image) ----
  let manuel = false, tempsManuel = 0;
  U.maintenant = () => (manuel ? tempsManuel : performance.now());

  // ---- Ressort (amorti), stable même si une image saute ----
  U.Ressort = class {
    constructor(v, raideur, amorti) { this.v = v; this.c = v; this.vit = 0; this.k = raideur || 220; this.a = amorti || 24; }
    pas(dt) {
      let reste = dt;
      while (reste > 1e-6) {
        const d = Math.min(reste, 0.006); reste -= d;
        this.vit += (-this.k * (this.v - this.c) - this.a * this.vit) * d;
        this.v += this.vit * d;
      }
      return this.v;
    }
    repos(eps) { eps = eps || 0.001; return Math.abs(this.v - this.c) < eps && Math.abs(this.vit) < eps * 20; }
    poser(v) { this.v = this.c = v; this.vit = 0; }
  };

  // ---- Une seule boucle d'animation pour toute l'appli ; elle s'arrête toute seule quand rien ne bouge ----
  const actifs = new Set();
  let raf = 0, dernier = 0;
  function tour(dt) { for (const f of Array.from(actifs)) { let r; try { r = f(dt); } catch (e) { console.error(e); r = false; } if (r === false) actifs.delete(f); } }
  function image(t) {
    raf = 0;
    const dt = U.borne((t - dernier) / 1000, 0, 0.05); dernier = t;
    tour(dt);
    if (actifs.size && !manuel) raf = requestAnimationFrame(image);
  }
  U.boucle = {
    ajouter(f) { actifs.add(f); if (!raf && !manuel) { dernier = performance.now(); raf = requestAnimationFrame(image); } return f; },
    retirer(f) { actifs.delete(f); },
    actifs: () => actifs.size,
    manuel(oui) { manuel = !!oui; tempsManuel = performance.now(); if (!manuel && actifs.size && !raf) { dernier = performance.now(); raf = requestAnimationFrame(image); } },
    estManuel: () => manuel,
    // essais : avance le temps de « ms » millisecondes, par pas de 1/120 s
    avancer(ms) { let r = ms; while (r > 0.01) { const d = Math.min(r, 1000 / 120); r -= d; tempsManuel += d; tour(d / 1000); } },
  };

  // Animation à durée fixe : f(t entre 0 et 1), puis fin()
  U.anim = function (duree, f, fin) {
    let t = 0, arrete = false;
    const pas = (dt) => {
      if (arrete) return false;
      t += dt * 1000 / duree;
      if (t >= 1) { f(1); if (fin) fin(); return false; }
      f(t);
    };
    f(0); U.boucle.ajouter(pas);
    return { arreter() { arrete = true; } };
  };
  U.attendre = (ms) => new Promise((r) => { let t = 0; U.boucle.ajouter((dt) => { t += dt * 1000; if (t >= ms) { r(); return false; } }); });

  // ---- Vitesse d'un pointeur (moyenne sur les 90 dernières millisecondes) ----
  U.Vitesse = class {
    constructor() { this.p = []; }
    noter(x, y) { const t = U.maintenant(); this.p.push(t, x, y); while (this.p.length > 3 && t - this.p[0] > 90) this.p.splice(0, 3); }
    lire() {
      const p = this.p, n = p.length;
      if (n < 6) return { x: 0, y: 0 };
      if (U.maintenant() - p[n - 3] > 80) return { x: 0, y: 0 };      // doigt arrêté avant de lâcher : pas d'élan
      const dt = (p[n - 3] - p[0]) / 1000;
      if (dt < 0.004) return { x: 0, y: 0 };
      return { x: (p[n - 2] - p[1]) / dt, y: (p[n - 1] - p[2]) / dt };
    }
  };

  // ---- Mesure de la fluidité (images par seconde, pire image) ----
  let mes = null;
  function mesure(t, m) {
    if (!mes || mes !== m) return;
    if (mes.dernier) mes.d.push(t - mes.dernier);
    mes.dernier = t;
    if (mes.badge && mes.d.length % 20 === 0) { const r = U.fps.lire(60); mes.badge.textContent = r.moyenne.toFixed(0) + " i/s · pire " + r.pire.toFixed(1) + " ms"; }
    requestAnimationFrame((t2) => mesure(t2, m));
  }
  U.fps = {
    demarrer(badge) { mes = { d: [], dernier: 0, badge: badge || null }; const m = mes; requestAnimationFrame((t) => mesure(t, m)); },
    lire(derniers) {
      if (!mes || !mes.d.length) return { moyenne: 0, bas1: 0, pire: 0, images: 0, mediane: 0 };
      const d = derniers ? mes.d.slice(-derniers) : mes.d.slice();
      const somme = d.reduce((a, b) => a + b, 0), tri = d.slice().sort((a, b) => a - b);
      const haut = tri.slice(Math.floor(tri.length * 0.99));
      return {
        images: d.length, moyenne: 1000 * d.length / somme, mediane: 1000 / tri[Math.floor(tri.length / 2)],
        bas1: 1000 / (haut.reduce((a, b) => a + b, 0) / haut.length), pire: tri[tri.length - 1],
        lentes: d.filter((x) => x > 1000 / 50).length,
      };
    },
    arreter() { const r = U.fps.lire(); mes = null; return r; },
    actif: () => !!mes,
  };
})(window.Cartable);
