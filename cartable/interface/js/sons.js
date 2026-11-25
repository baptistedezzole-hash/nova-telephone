// Cartable, interface : sons discrets, fabriqués à la volée (aucun fichier). Éteints par défaut (mode cours).
"use strict";
(function (C) {
  const S = C.sons = {};
  let ctx = null, actif = false, tampon = null;
  try { actif = localStorage.getItem("cartable-sons") === "1"; } catch (e) { /* rien */ }
  S.actif = () => actif;
  S.regler = (oui) => { actif = !!oui; try { localStorage.setItem("cartable-sons", actif ? "1" : "0"); } catch (e) { /* rien */ } if (actif) S.jouer("pose"); };

  function pret() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return false;
      ctx = new A();
      tampon = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = tampon.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }
  // un souffle de bruit filtré : (fréquence de départ, d'arrivée, durée, volume, largeur du filtre)
  function souffle(f0, f1, duree, vol, q, type) {
    const t = ctx.currentTime, src = ctx.createBufferSource(), fil = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = tampon; src.loop = true;
    fil.type = type || "bandpass"; fil.Q.value = q || 0.8;
    fil.frequency.setValueAtTime(f0, t); fil.frequency.exponentialRampToValueAtTime(f1, t + duree);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, duree * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    src.connect(fil); fil.connect(g); g.connect(ctx.destination);
    src.start(t, Math.random() * 0.5); src.stop(t + duree + 0.02);
  }
  S.jouer = function (nom, force) {
    if (!actif) return;
    try {
      if (!pret()) return;
      const v = force === undefined ? 1 : force;
      if (nom === "pose") { souffle(380, 120, 0.09, 0.07 * v, 0.7, "lowpass"); souffle(2600, 900, 0.07, 0.025 * v, 0.6); }
      else if (nom === "prise") souffle(1800, 3400, 0.06, 0.02 * v, 0.7);
      else if (nom === "page") { souffle(900, 4200, 0.2, 0.03 * v, 0.6); setTimeout(() => S.jouer("pose", 0.5), 230); }
      else if (nom === "feuille") souffle(3000, 1100, 0.22, 0.035 * v, 0.5);
      else if (nom === "classeur") { souffle(240, 90, 0.12, 0.1 * v, 0.8, "lowpass"); }
      else if (nom === "range") { souffle(2400, 700, 0.16, 0.035 * v, 0.6); setTimeout(() => S.jouer("classeur", 0.6), 120); }
      else if (nom === "magie") { souffle(2000, 7000, 0.45, 0.02 * v, 2.5); }
    } catch (e) { /* le son n'est jamais bloquant */ }
  };
})(window.Cartable);
