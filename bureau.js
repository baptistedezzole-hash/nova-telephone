// Nova sur le téléphone : PRISE EN MAIN du PC (2026-11-12, « stream le gros PC », comme Steam Remote Play).
// Bouton « PC » dans l'en-tête : l'écran du PC s'affiche, le tactile pilote la souris, le clavier du téléphone écrit sur
// le PC, la manette (à l'écran ou vraie manette Bluetooth/USB par l'API Gamepad) joue.
// Chargé par index.html via /api/bureau/script (servi par l'API : marche aussi depuis une ancienne adresse d'appli).
// Côté PC : outils\telephone_bureau.py. La prise en main est INTERDITE tant que le PC ne l'a pas autorisée
// (telephone.py prise-en-main oui) et exige le jeton d'appareil ; elle est éteinte à chaque ouverture de l'appli.
// Gestes (mode Direct) : toucher = clic là ; glisser = déplacer la souris ; toucher puis retoucher et glisser = glisser-déposer ;
// appui long = clic droit ; deux doigts = molette ; pincer = zoom (deux doigts pour déplacer la vue).
// Mode Pavé : comme un pavé tactile (glisser = déplacer, toucher = clic, toucher à deux doigts = clic droit).
(() => {
  "use strict";
  if (window.NovaBureau) return;
  const $ = id => document.getElementById(id);
  const NA = window.NovaAppli || {};
  const css = `
#btnBureau { display:flex; align-items:center; gap:6px; padding:7px 11px 7px 9px; border-radius:999px; font-size:13px; color:var(--txt2,#aab); border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); }
#btnBureau svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
#btnBureau.on { color:#ffb3ad; border-color:rgba(255,143,134,.5); background:rgba(255,143,134,.1); }
#btnBureau:active { transform:scale(.96); }
#bur { position:fixed; inset:0; z-index:2147483500; display:none; background:#02030a; color:var(--txt,#dfe6f6); font-family:var(--sans,system-ui,sans-serif); touch-action:none; user-select:none; -webkit-user-select:none; overscroll-behavior:none; }
#bur.vu { display:block; }
#bur canvas { position:absolute; inset:0; width:100%; height:100%; touch-action:none; }
#bur .barre { position:absolute; z-index:3; top:0; left:0; right:0; display:flex; align-items:center; gap:6px; padding:calc(6px + env(safe-area-inset-top,0px)) calc(8px + env(safe-area-inset-right,0px)) 6px calc(8px + env(safe-area-inset-left,0px)); background:linear-gradient(rgba(2,3,10,.82),rgba(2,3,10,0)); transition:opacity .25s, transform .25s; }
#bur.cache .barre { opacity:0; transform:translateY(-100%); pointer-events:none; }
#bur .barre button, #bur .touches button { min-width:38px; height:34px; padding:0 9px; border-radius:10px; border:1px solid rgba(255,255,255,.14); background:rgba(10,14,30,.72); color:inherit; font:500 12.5px/1 var(--sans,system-ui,sans-serif); display:flex; align-items:center; justify-content:center; gap:5px; }
#bur .barre button.on, #bur .touches button.on { border-color:rgba(233,214,168,.6); color:#e9d6a8; background:rgba(233,214,168,.14); }
#bur .barre svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
#bur .stats { flex:1; min-width:0; font:500 10.5px/1.2 var(--mono,ui-monospace,monospace); letter-spacing:.06em; color:rgba(226,232,246,.55); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:center; }
#bur .poignee { position:absolute; z-index:3; top:calc(2px + env(safe-area-inset-top,0px)); left:50%; width:54px; height:20px; margin-left:-27px; border-radius:0 0 12px 12px; background:rgba(10,14,30,.55); display:none; }
#bur.cache .poignee { display:block; }
#bur .poignee::after { content:""; position:absolute; left:17px; right:17px; top:8px; height:3px; border-radius:2px; background:rgba(255,255,255,.45); }
#bur .msg { position:absolute; z-index:4; left:50%; top:50%; transform:translate(-50%,-50%); max-width:min(86vw,420px); padding:14px 18px; border-radius:14px; background:rgba(10,14,30,.88); border:1px solid rgba(255,255,255,.12); font-size:14px; line-height:1.4; text-align:center; display:none; }
#bur .msg.vu { display:block; }
#bur .touches { position:absolute; z-index:3; left:0; right:0; bottom:0; display:none; gap:5px; padding:6px calc(6px + env(safe-area-inset-right,0px)) calc(6px + env(safe-area-inset-bottom,0px)) calc(6px + env(safe-area-inset-left,0px)); overflow-x:auto; background:rgba(2,3,10,.78); scrollbar-width:none; }
#bur.clavier .touches { display:flex; }
#bur .touches button { flex:none; }
#bur textarea { position:fixed; left:0; bottom:0; width:2px; height:2px; opacity:0; font-size:16px; border:0; padding:0; resize:none; background:transparent; color:transparent; caret-color:transparent; }
#bur .pad { position:absolute; inset:0; z-index:2; display:none; pointer-events:none; }
#bur.manette .pad { display:block; }
#bur .pad > * { position:absolute; pointer-events:auto; touch-action:none; }
#bur .pad .stick { width:128px; height:128px; border-radius:50%; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.16); }
#bur .pad .stick i { position:absolute; left:50%; top:50%; width:52px; height:52px; margin:-26px 0 0 -26px; border-radius:50%; background:rgba(233,214,168,.28); border:1px solid rgba(233,214,168,.55); }
#bur .pad .bt { width:52px; height:52px; border-radius:50%; display:grid; place-items:center; font:600 15px/1 var(--sans,system-ui,sans-serif); color:rgba(255,255,255,.85); background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.2); }
#bur .pad .bt.p { width:62px; height:34px; border-radius:12px; font-size:12px; }
#bur .pad .bt.c { width:42px; height:42px; border-radius:10px; font-size:14px; }
#bur .pad .bt.on { background:rgba(233,214,168,.35); border-color:#e9d6a8; color:#fff; }
/* 12/11 : gros bouton « Piloter le PC » dans la barre du pouce (miroir du bouton photo), bien visible, DA or pâle */
#btnPilote { position:absolute; right:86px; top:50%; margin-top:-26px; width:52px; height:52px; z-index:2; padding:0; border-radius:50%;
  display:grid; place-items:center; color:#e9d6a8; border:1px solid rgba(233,214,168,.5);
  background:radial-gradient(circle at 50% 38%, rgba(233,214,168,.2), rgba(233,214,168,.05) 62%, rgba(2,3,10,.4));
  box-shadow:0 0 18px rgba(233,214,168,.22), inset 0 0 10px rgba(233,214,168,.12); transition:transform .15s, box-shadow .3s; }
#btnPilote svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
#btnPilote::before { content:""; position:absolute; inset:-5px; border-radius:50%; border:1px solid rgba(233,214,168,.28); animation:piloteHalo 3.2s ease-in-out infinite; pointer-events:none; }
#btnPilote::after { content:""; position:absolute; top:3px; right:5px; width:5px; height:5px; border-radius:50%; background:#fff6dc; box-shadow:0 0 6px 1px rgba(255,240,200,.9); animation:piloteEtoile 2.6s ease-in-out infinite; pointer-events:none; }
#btnPilote:active { transform:scale(.92); }
#btnPilote.on { color:#ffb3ad; border-color:rgba(255,143,134,.55); box-shadow:0 0 18px rgba(255,143,134,.3); }
@keyframes piloteHalo { 0%,100% { opacity:.25; transform:scale(.96); } 50% { opacity:.9; transform:scale(1.06); } }
@keyframes piloteEtoile { 0%,100% { opacity:.35; transform:scale(.7); } 50% { opacity:1; transform:scale(1.15); } }
@media (prefers-reduced-motion: reduce) { #btnPilote::before, #btnPilote::after { animation:none; } }
@media (orientation: landscape) and (max-height: 560px) { #btnPilote { right:106px; } }
/* l'en-tête débordait sur les téléphones étroits (réglages poussés hors écran) : en portrait, le gros bouton remplace la pilule « PC » */
@media (orientation: portrait) and (max-width: 440px) { html.piloteBas #btnBureau { display:none; } }
`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  const IC = {
    pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    kb: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    plein: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    haut: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>'
  };

  // ---------- l'écran ----------
  const ov = document.createElement("div");
  ov.id = "bur";
  ov.innerHTML = `<canvas></canvas>
<div class="poignee"></div>
<div class="barre">
  <button data-a="fermer" aria-label="Fermer">${IC.x}</button>
  <button data-a="mode">Direct</button>
  <button data-a="qualite">Auto</button>
  <button data-a="ecran" style="display:none">Écran 1</button>
  <div class="stats">connexion…</div>
  <button data-a="clavier" aria-label="Clavier">${IC.kb}</button>
  <button data-a="micro" aria-label="Parler à Nova">${IC.mic}</button>
  <button data-a="plein" aria-label="Plein écran">${IC.plein}</button>
  <button data-a="cacher" aria-label="Cacher la barre">${IC.haut}</button>
</div>
<div class="pad"></div>
<div class="touches"></div>
<div class="msg"></div>
<textarea autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="enter" aria-label="Clavier du PC"></textarea>`;
  document.body.appendChild(ov);
  const cv = ov.querySelector("canvas"), ctx = cv.getContext("2d", { alpha: false });
  const ta = ov.querySelector("textarea"), msgEl = ov.querySelector(".msg"), statsEl = ov.querySelector(".stats");
  const btn = a => ov.querySelector(`[data-a="${a}"]`);

  let actif = false;          // la prise en main est allumée (OFF à chaque ouverture de l'appli)
  let ws = null, essais = 0, finDefinitive = false, vivantT = 0;
  let mode = "direct", preset = "auto", ecrans = [], ecranI = 0;
  let img = null, iw = 0, ih = 0, curseur = null;
  let z = 1, cxn = 0.5, cyn = 0.5;          // la vue : zoom (1 = tout l'écran) et centre (0..1)
  let decodage = false, enAttente = null;
  let manetteMode = "clavier";
  const mods = new Set();

  function message(t, duree) {
    msgEl.textContent = t || "";
    msgEl.classList.toggle("vu", !!t);
    clearTimeout(message.t);
    if (t && duree) message.t = setTimeout(() => msgEl.classList.remove("vu"), duree);
  }
  function avis(t) {   // 12/11 : le bandeau #avis de la page (la fonction avis de index.html n'est pas sur window : jamais d'alert())
    const a = $("avis");
    if (!a) { if (typeof window.avis === "function") window.avis(t); return; }
    a.textContent = t || "";
    a.classList.toggle("vu", !!t);
    clearTimeout(avis.t);
    if (t) avis.t = setTimeout(() => { if (a.textContent === t) a.classList.remove("vu"); }, 6000);
  }
  function envoyer(d) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(d)); return true; } return false; }
  function vib(n) { try { navigator.vibrate && navigator.vibrate(n); } catch (x) {} }

  // ---------- dessin ----------
  let dpr = 1, cw = 0, ch = 0;
  function tailler() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cw = ov.clientWidth; ch = ov.clientHeight;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    dessiner();
  }
  function vue() {   // -> { s : pixels CSS par pixel d'image, ox, oy }
    if (!iw) return { s: 1, ox: 0, oy: 0 };
    const s = Math.min(cw / iw, ch / ih) * z;
    const lw = iw * s, lh = ih * s;
    let ox = cw / 2 - cxn * lw, oy = ch / 2 - cyn * lh;
    ox = lw <= cw ? (cw - lw) / 2 : Math.min(0, Math.max(cw - lw, ox));
    oy = lh <= ch ? (ch - lh) / 2 : Math.min(0, Math.max(ch - lh, oy));
    return { s, ox, oy };
  }
  function versImage(px, py) {   // point de l'écran du téléphone -> point de l'écran du PC (0..1)
    const v = vue();
    return { x: Math.max(0, Math.min(0.9999, (px - v.ox) / (iw * v.s))), y: Math.max(0, Math.min(0.9999, (py - v.oy) / (ih * v.s))) };
  }
  function recentrer(nx, ny, px, py) {   // le point (nx, ny) de l'image sous le point (px, py) du téléphone
    const s = Math.min(cw / iw, ch / ih) * z;
    cxn = (cw / 2 - px) / (iw * s) + nx; cyn = (ch / 2 - py) / (ih * s) + ny;
    const v = vue();   // ramène le centre dans les bornes
    cxn = (cw / 2 - v.ox) / (iw * v.s); cyn = (ch / 2 - v.oy) / (ih * v.s);
  }
  function dessiner() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#02030a"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!img) return;
    const v = vue();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = z > 1.6 ? "low" : "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(img, v.ox, v.oy, iw * v.s, ih * v.s);
  }
  addEventListener("resize", () => { if (actif) setTimeout(tailler, 60); });

  async function image(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 16 || dv.getUint8(0) !== 78 || dv.getUint8(1) !== 66) return;
    const seq = dv.getUint32(4, true), w = dv.getUint16(8, true), h = dv.getUint16(10, true);
    const cx = dv.getUint16(12, true), cy = dv.getUint16(14, true);
    if (decodage) {   // le téléphone ne suit pas : on garde la plus récente, l'autre est accusée tout de suite
      if (enAttente) envoyer({ t: "ack", s: enAttente.seq });
      enAttente = { buf, seq };
      return;
    }
    decodage = true;
    try {
      const bm = await createImageBitmap(new Blob([new Uint8Array(buf, 16)], { type: "image/jpeg" }));
      if (img && img.close) img.close();
      img = bm; iw = w; ih = h;
      curseur = cx === 0xFFFF ? null : { x: cx / 65535, y: cy / 65535 };
      if (mode === "pave" && z > 1 && curseur) suivreCurseur();
      dessiner();
    } catch (x) {}
    envoyer({ t: "ack", s: seq });
    decodage = false;
    if (enAttente) { const e = enAttente; enAttente = null; image(e.buf); }
  }
  function suivreCurseur() {   // pavé zoomé : la vue suit la souris du PC
    const v = vue(), px = v.ox + curseur.x * iw * v.s, py = v.oy + curseur.y * ih * v.s, m = 0.2;
    if (px < cw * m || px > cw * (1 - m) || py < ch * m || py > ch * (1 - m)) { cxn = curseur.x; cyn = curseur.y; recentrer(cxn, cyn, cw / 2, ch / 2); }
  }

  // ---------- la connexion ----------
  async function ticket(demande) {
    const r = await fetch("/api/bureau/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demande: demande || 0 }), cache: "no-store" });
    let d = {};
    try { d = await r.json(); } catch (x) {}
    if (!r.ok) throw Object.assign(new Error(d.message || ("refus " + r.status)), { definitif: r.status !== 429 && r.status < 500, code: d.erreur });
    return d;
  }
  async function connecter(demande) {
    message("Connexion au PC…");
    let d;
    try { d = await ticket(demande); }
    catch (x) {
      if (x.code === "appareil") return arreter("Connecte d'abord l'appli au PC (scanne le QR code), puis réessaie.");
      return x.definitif || essais >= 3 ? arreter(x.message) : reessayer();
    }
    if (!actif) return;
    const base = (NA.base || location.origin).replace(/\/$/, "");
    const w = new WebSocket(base.replace(/^http/, "ws") + d.chemin);
    w.binaryType = "arraybuffer";
    ws = w;
    w.onopen = () => { essais = 0; message(""); vivantT = Date.now(); envoyer({ t: "q", preset }); };
    w.onmessage = e => {
      vivantT = Date.now();
      if (typeof e.data !== "string") return image(e.data);
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === "bonjour") {
        ecrans = m.ecrans || []; ecranI = m.ecran || 0; manetteMode = m.manette || "clavier";
        const b = btn("ecran"); b.style.display = ecrans.length > 1 ? "" : "none"; b.textContent = "Écran " + (ecranI + 1);
      } else if (m.t === "stats") {
        statsEl.textContent = `${Math.round(m.fps)} i/s · ${m.kbps >= 1000 ? (m.kbps / 8000).toFixed(1) + " Mo/s" : Math.round(m.kbps / 8) + " ko/s"} · ${m.rtt} ms · ${m.largeur}p`;
      } else if (m.t === "info") {
        if (m.m === "ecran-indisponible") message("L'écran du PC est verrouillé ou protégé (UAC) : rien à afficher pour l'instant.");
        else if (m.m === "ecran-revenu") message("");
        else if (m.m === "champ" && !ov.classList.contains("clavier")) ouvrirClavier(true);
      } else if (m.t === "fin") {
        finDefinitive = !!m.definitif;
        if (m.definitif) arreter("Prise en main terminée : " + (m.raison || "fin") + ".");
      }
    };
    w.onclose = () => {
      if (ws !== w) return;
      ws = null;
      if (actif && !finDefinitive) reessayer();
    };
    w.onerror = () => {};
  }
  function reessayer() {
    if (!actif) return;
    if (++essais > 3) return arreter("Le PC ne répond plus. Réessaie dans un moment.");
    message("Reconnexion… (" + essais + "/3)");
    setTimeout(() => { if (actif && !ws) connecter(); }, 1200 * essais);
  }

  function demarrer(demande) {
    if (actif) return;
    actif = true; essais = 0; finDefinitive = false; img = null; iw = ih = 0; z = 1; cxn = cyn = 0.5;
    ov.classList.add("vu"); ov.classList.remove("cache", "clavier");
    $("btnBureau") && $("btnBureau").classList.add("on");
    $("btnPilote") && $("btnPilote").classList.add("on");
    tailler();
    try { NA.garderEcran && NA.garderEcran(true); } catch (x) {}
    connecter(demande);
  }
  function arreter(raison) {
    const etait = actif;
    actif = false;
    if (ws) { try { envoyer({ t: "fin", raison: "fermée sur le téléphone" }); ws.close(1000); } catch (x) {} ws = null; }
    padReset();
    ov.classList.remove("vu", "clavier");
    $("btnBureau") && $("btnBureau").classList.remove("on");
    $("btnPilote") && $("btnPilote").classList.remove("on");
    try { ta.blur(); } catch (x) {}
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (x) {}
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (x) {}
    if (img && img.close) img.close();
    img = null;
    message("");
    if (raison && etait) avis(raison);
  }
  // l'appli passe en arrière-plan : la prise en main s'arrête (rien ne reste ouvert dans la poche)
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible" && actif) arreter(""); });
  // la mise à jour automatique de l'appli attend la fin de la prise en main
  const calmeOrig = window.novaCalme;
  window.novaCalme = () => !actif && (typeof calmeOrig === "function" ? calmeOrig() : true);
  setInterval(() => {
    if (!actif || !ws) return;
    envoyer({ t: "vivant" });
    if (Date.now() - vivantT > 20000) { try { ws.close(); } catch (x) {} }
  }, 8000);

  // ---------- la barre ----------
  ov.querySelector(".barre").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    vib(8);
    const a = b.dataset.a;
    if (a === "fermer") arreter("");
    else if (a === "mode") { mode = { direct: "pave", pave: "manette", manette: "direct" }[mode]; b.textContent = { direct: "Direct", pave: "Pavé", manette: "Manette" }[mode]; ov.classList.toggle("manette", mode === "manette"); padReset(); if (mode === "manette" && manetteMode === "clavier") message("Manette sans pilote : les boutons deviennent des touches du clavier (ZQSD, Espace…) et le stick droit la souris.", 3500); }
    else if (a === "qualite") { preset = { auto: "fluide", fluide: "net", net: "auto" }[preset]; b.textContent = { auto: "Auto", fluide: "Fluide", net: "Net" }[preset]; envoyer({ t: "q", preset }); }
    else if (a === "ecran") { if (ecrans.length > 1) envoyer({ t: "ecran", i: (ecranI + 1) % ecrans.length }); }
    else if (a === "clavier") { ov.classList.contains("clavier") ? fermerClavier() : ouvrirClavier(); }
    else if (a === "micro" && window.NovaMicro && NovaMicro.coupe()) { if (!msgEl.classList.contains("vu")) message("Micro coupé : rallume-le avec le petit micro barré, à gauche du gros micro de Nova.", 3500); }   // 2026-11-13
    else if (a === "micro") { try { if (typeof window.toucheSimple === "function") window.toucheSimple(); } catch (x) {} b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 600); }
    else if (a === "plein") pleinEcran();
    else if (a === "cacher") ov.classList.add("cache");
  });
  ov.querySelector(".poignee").addEventListener("pointerdown", e => { e.stopPropagation(); ov.classList.remove("cache"); });
  function pleinEcran() {
    try {
      const p = ov.requestFullscreen ? ov.requestFullscreen({ navigationUI: "hide" }) : null;
      if (p && p.then) p.then(() => { try { screen.orientation.lock("landscape").catch(() => {}); } catch (x) {} }).catch(() => {});
    } catch (x) {}
    ov.classList.add("cache");
  }

  // ---------- le clavier ----------
  const SENT = "  ";
  let avant = SENT, compose = false;
  const TOUCHES = [["Ctrl", "m:ctrl"], ["Alt", "m:alt"], ["Maj", "m:maj"], ["Échap", "Escape"], ["Tab", "Tab"], ["←", "ArrowLeft"], ["↑", "ArrowUp"], ["↓", "ArrowDown"], ["→", "ArrowRight"],
    ["Suppr", "Delete"], ["⌫", "Backspace"], ["Entrée", "Enter"], ["Début", "Home"], ["Fin", "End"], ["Pg↑", "PageUp"], ["Pg↓", "PageDown"], ["F5", "F5"], ["F11", "F11"]];
  const bar = ov.querySelector(".touches");
  bar.innerHTML = TOUCHES.map(([l, k]) => `<button data-k="${k}">${l}</button>`).join("");
  bar.addEventListener("pointerdown", e => e.preventDefault());   // garder le clavier du téléphone ouvert
  bar.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    vib(6);
    const k = b.dataset.k;
    if (k.startsWith("m:")) { const m = k.slice(2); mods.has(m) ? mods.delete(m) : mods.add(m); b.classList.toggle("on", mods.has(m)); return; }
    touche(k);
  });
  function majMods() { for (const b of bar.querySelectorAll('[data-k^="m:"]')) b.classList.toggle("on", mods.has(b.dataset.k.slice(2))); }
  function touche(k) {
    envoyer({ t: "k", k, mods: [...mods] });
    if (mods.size) { mods.clear(); majMods(); }   // un modificateur ne vaut que pour la touche suivante
  }
  function texte(s) {
    if (!s) return;
    if (mods.size) {   // Ctrl+C, Alt+Tab… : la lettre devient une touche
      for (const c of s) touche(c === " " ? "Space" : c === "\n" ? "Enter" : c.toLowerCase());
      return;
    }
    for (let i = 0; i < s.length; i += 180) envoyer({ t: "txt", s: s.slice(i, i + 180) });
  }
  function ouvrirClavier(auto) {
    ov.classList.add("clavier");
    avant = SENT; ta.value = SENT;
    try { ta.focus({ preventScroll: true }); ta.setSelectionRange(SENT.length, SENT.length); } catch (x) {}
    btn("clavier").classList.add("on");
    if (auto && document.activeElement !== ta) message("Touche le bouton clavier pour écrire.", 2000);
  }
  function fermerClavier() { ov.classList.remove("clavier"); btn("clavier").classList.remove("on"); try { ta.blur(); } catch (x) {} }
  function diff() {
    const v = ta.value;
    let p = 0;
    while (p < avant.length && p < v.length && avant[p] === v[p]) p++;
    const effaces = avant.length - p, ajoute = v.slice(p);
    for (let i = 0; i < effaces; i++) touche("Backspace");
    texte(ajoute);
    avant = v;
    if (!compose && (v.length > 40 || v.length < SENT.length || v.indexOf(SENT) !== 0)) { avant = SENT; ta.value = SENT; try { ta.setSelectionRange(SENT.length, SENT.length); } catch (x) {} }
  }
  ta.addEventListener("compositionstart", () => { compose = true; });
  ta.addEventListener("compositionend", () => { compose = false; diff(); });
  ta.addEventListener("input", diff);
  ta.addEventListener("keydown", e => {   // clavier Bluetooth branché sur le téléphone
    const k = e.key;
    if (["Escape", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Home", "End", "PageUp", "PageDown"].includes(k) || /^F\d{1,2}$/.test(k)
        || ((e.ctrlKey || e.altKey) && k.length === 1)) {
      e.preventDefault();
      const m = []; if (e.ctrlKey) m.push("ctrl"); if (e.altKey) m.push("alt"); if (e.shiftKey && k.length !== 1) m.push("maj");
      envoyer({ t: "k", k: k.length === 1 ? k.toLowerCase() : k, mods: m });
    } else if (k === "Backspace" && ta.value === SENT.slice(0, 0)) { e.preventDefault(); touche("Backspace"); }
  });
  ta.addEventListener("blur", () => { if (actif && ov.classList.contains("clavier")) setTimeout(() => { if (document.activeElement !== ta) fermerClavier(); }, 250); });

  // ---------- les gestes ----------
  const doigts = new Map();
  let geste = null, dernierTap = { t: 0, x: 0, y: 0 }, rafM = 0, mEnAttente = null, resteMolette = 0, resteR = [0, 0];
  const SEUIL = 9;
  function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function bouger(p) {   // la souris suit le doigt (une fois par image)
    mEnAttente = versImage(p.x, p.y);
    if (!rafM) rafM = requestAnimationFrame(() => { rafM = 0; if (mEnAttente) envoyer({ t: "m", x: mEnAttente.x, y: mEnAttente.y }); mEnAttente = null; });
  }
  cv.addEventListener("touchstart", e => e.preventDefault(), { passive: false });   // ni zoom de la page, ni perte du clavier
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("pointerdown", e => {
    if (!actif || mode === "manette") return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    const p = pos(e);
    doigts.set(e.pointerId, p);
    if (doigts.size === 1) {
      const dbl = Date.now() - dernierTap.t < 320 && Math.hypot(p.x - dernierTap.x, p.y - dernierTap.y) < 40;
      geste = { type: "un", debut: p, dernier: p, t: Date.now(), bouge: false, glisser: dbl, long: false };
      geste.minuteur = setTimeout(() => {
        if (geste && geste.type === "un" && !geste.bouge && !geste.glisser) {
          geste.long = true; vib(20);
          if (mode === "direct") envoyer(Object.assign({ t: "b", b: "d", e: "clic", mods: [...mods] }, versImage(p.x, p.y)));
          else envoyer({ t: "b", b: "d", e: "clic" });
        }
      }, 550);
    } else if (doigts.size === 2) {
      if (geste) { clearTimeout(geste.minuteur); if (geste.enfonce) envoyer({ t: "b", b: "g", e: "haut" }); }
      const [a, b] = [...doigts.values()];
      geste = { type: "deux", d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mPrec: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        z0: z, n0: null, zoom: false, t: Date.now(), bouge: false };
      geste.n0 = versImage(geste.m0.x, geste.m0.y);
    }
  });
  cv.addEventListener("pointermove", e => {
    if (!actif || !doigts.has(e.pointerId) || !geste) return;
    const p = pos(e), prec = doigts.get(e.pointerId);
    doigts.set(e.pointerId, p);
    if (geste.type === "un") {
      if (!geste.bouge && Math.hypot(p.x - geste.debut.x, p.y - geste.debut.y) > SEUIL) {
        geste.bouge = true; clearTimeout(geste.minuteur);
        if (geste.glisser) {   // toucher, retoucher et glisser : glisser-déposer
          if (mode === "direct") envoyer(Object.assign({ t: "b", b: "g", e: "bas" }, versImage(geste.debut.x, geste.debut.y)));
          else envoyer({ t: "b", b: "g", e: "bas" });
          geste.enfonce = true;
        }
      }
      if (!geste.bouge || geste.long) return;
      if (mode === "direct") bouger(p);
      else {   // pavé : déplacement relatif, accéléré
        const dx = p.x - prec.x, dy = p.y - prec.y, v = Math.hypot(dx, dy), k = 1.6 + Math.min(2.4, v / 9);
        resteR[0] += dx * k; resteR[1] += dy * k;
        const rx = Math.trunc(resteR[0]), ry = Math.trunc(resteR[1]);
        if (rx || ry) { resteR[0] -= rx; resteR[1] -= ry; envoyer({ t: "r", dx: rx, dy: ry }); }
      }
    } else if (geste.type === "deux" && doigts.size >= 2) {
      const [a, b] = [...doigts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.hypot(m.x - geste.m0.x, m.y - geste.m0.y) > SEUIL || Math.abs(d / geste.d0 - 1) > 0.05) geste.bouge = true;
      if (!geste.zoom && Math.abs(d / geste.d0 - 1) > 0.12 && iw) geste.zoom = true;
      if (geste.zoom || z > 1.01) {   // zoom et déplacement de la vue (sur le téléphone seulement)
        if (geste.zoom) z = Math.max(1, Math.min(6, geste.z0 * d / geste.d0));
        if (z <= 1.01 && !geste.zoom) return;
        recentrer(geste.n0.x, geste.n0.y, m.x, m.y);
        dessiner();
      } else {   // molette
        resteMolette += -(m.y - geste.mPrec.y) * 2.6;
        const n = Math.trunc(resteMolette / 40) * 40;
        if (n) { resteMolette -= n; envoyer({ t: "w", dy: n }); }
      }
      geste.mPrec = m;
    }
  });
  function fin(e) {
    if (!doigts.has(e.pointerId)) return;
    doigts.delete(e.pointerId);
    if (!geste) return;
    const g = geste;
    if (g.type === "un") {
      clearTimeout(g.minuteur);
      if (g.enfonce) envoyer({ t: "b", b: "g", e: "haut" });
      else if (!g.bouge && !g.long && Date.now() - g.t < 550) {   // un toucher = un clic
        const p = g.debut;
        if (mode === "direct") envoyer(Object.assign({ t: "b", b: "g", e: "clic", mods: [...mods] }, versImage(p.x, p.y)));
        else envoyer({ t: "b", b: "g", e: "clic", mods: [...mods] });
        if (mods.size) { mods.clear(); majMods(); }
        dernierTap = { t: Date.now(), x: p.x, y: p.y };
        vib(5);
      }
      geste = null;
    } else if (g.type === "deux") {
      if (doigts.size === 0) {
        if (!g.bouge && Date.now() - g.t < 300) { envoyer(mode === "direct" ? Object.assign({ t: "b", b: "d", e: "clic" }, versImage(g.m0.x, g.m0.y)) : { t: "b", b: "d", e: "clic" }); vib(12); }
        if (z <= 1.02) { z = 1; cxn = cyn = 0.5; dessiner(); }
        geste = null;
      }
    }
  }
  cv.addEventListener("pointerup", fin);
  cv.addEventListener("pointercancel", fin);
  cv.addEventListener("dblclick", e => e.preventDefault());

  // ---------- la manette ----------
  const pad = ov.querySelector(".pad");
  const padEtat = { b: 0, ax: [0, 0, 0, 0], lt: 0, rt: 0 };
  let padEcranB = 0, padEcranAx = [0, 0, 0, 0], padEcranLt = 0, padEcranRt = 0, padEnvoiT = 0, padSig = "";
  const BT = [   // [libellé, bit (ou "lt"/"rt"), position CSS]
    ["A", 0, "right:calc(84px + env(safe-area-inset-right,0px));bottom:150px"], ["B", 1, "right:calc(26px + env(safe-area-inset-right,0px));bottom:206px"],
    ["X", 2, "right:calc(142px + env(safe-area-inset-right,0px));bottom:206px"], ["Y", 3, "right:calc(84px + env(safe-area-inset-right,0px));bottom:262px"],
    ["LB", 4, "left:calc(16px + env(safe-area-inset-left,0px));top:96px", "p"], ["RB", 5, "right:calc(16px + env(safe-area-inset-right,0px));top:96px", "p"],
    ["LT", "lt", "left:calc(16px + env(safe-area-inset-left,0px));top:52px", "p"], ["RT", "rt", "right:calc(16px + env(safe-area-inset-right,0px));top:52px", "p"],
    ["⧉", 8, "left:calc(50% - 56px);bottom:22px", "c"], ["≡", 9, "left:calc(50% + 14px);bottom:22px", "c"],
    ["↑", 12, "left:calc(70px + env(safe-area-inset-left,0px));bottom:270px", "c"], ["↓", 13, "left:calc(70px + env(safe-area-inset-left,0px));bottom:178px", "c"],
    ["←", 14, "left:calc(24px + env(safe-area-inset-left,0px));bottom:224px", "c"], ["→", 15, "left:calc(116px + env(safe-area-inset-left,0px));bottom:224px", "c"]];
  pad.innerHTML = BT.map(([l, bit, s, c]) => `<div class="bt ${c || ""}" data-bit="${bit}" style="${s}">${l}</div>`).join("")
    + `<div class="stick" data-s="0" style="left:calc(22px + env(safe-area-inset-left,0px));bottom:26px"><i></i></div>`
    + `<div class="stick" data-s="1" style="right:calc(170px + env(safe-area-inset-right,0px));bottom:22px"><i></i></div>`;
  for (const el of pad.querySelectorAll(".bt")) {
    const bit = el.dataset.bit;
    const regler = on => {
      el.classList.toggle("on", on);
      if (bit === "lt") padEcranLt = on ? 1 : 0; else if (bit === "rt") padEcranRt = on ? 1 : 0;
      else padEcranB = on ? padEcranB | (1 << +bit) : padEcranB & ~(1 << +bit);
      if (on) vib(6);
      padEnvoyer(true);
    };
    el.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (x) {} regler(true); });
    el.addEventListener("pointerup", () => regler(false));
    el.addEventListener("pointercancel", () => regler(false));
  }
  for (const el of pad.querySelectorAll(".stick")) {
    const i = +el.dataset.s * 2, bouton = el.querySelector("i");
    let id = null, c = null, tapT = 0;
    const maj = e => {
      const r = 50, dx = e.clientX - c.x, dy = e.clientY - c.y, d = Math.hypot(dx, dy), k = d > r ? r / d : 1;
      padEcranAx[i] = dx * k / r; padEcranAx[i + 1] = dy * k / r;
      bouton.style.transform = `translate(${dx * k}px,${dy * k}px)`;
      padEnvoyer(false);
    };
    el.addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation(); id = e.pointerId;
      try { el.setPointerCapture(id); } catch (x) {}
      const r = el.getBoundingClientRect(); c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (Date.now() - tapT < 280) { padEcranB |= 1 << (10 + i / 2); padEnvoyer(true); }   // double toucher = L3 / R3
      tapT = Date.now();
      maj(e);
    });
    el.addEventListener("pointermove", e => { if (e.pointerId === id) maj(e); });
    const lacher = e => {
      if (e.pointerId !== id) return;
      id = null; padEcranAx[i] = padEcranAx[i + 1] = 0; bouton.style.transform = "";
      padEcranB &= ~(1 << (10 + i / 2));
      padEnvoyer(true);
    };
    el.addEventListener("pointerup", lacher);
    el.addEventListener("pointercancel", lacher);
  }
  function padLire() {   // l'écran + une vraie manette (API Gamepad, mappage standard)
    let b = mode === "manette" ? padEcranB : 0, ax = mode === "manette" ? padEcranAx.slice() : [0, 0, 0, 0];
    let lt = mode === "manette" ? padEcranLt : 0, rt = mode === "manette" ? padEcranRt : 0;
    let vraie = false;
    try {
      for (const g of (navigator.getGamepads ? navigator.getGamepads() : [])) {
        if (!g || !g.connected) continue;
        vraie = true;
        g.buttons.forEach((x, k) => { if (k < 17 && k !== 16 && (x.pressed || x.value > 0.5)) b |= 1 << k; });
        if (g.buttons[6]) lt = Math.max(lt, g.buttons[6].value || (g.buttons[6].pressed ? 1 : 0));
        if (g.buttons[7]) rt = Math.max(rt, g.buttons[7].value || (g.buttons[7].pressed ? 1 : 0));
        for (let k = 0; k < 4; k++) if (Math.abs(g.axes[k] || 0) > Math.abs(ax[k])) ax[k] = g.axes[k];
        break;
      }
    } catch (x) {}
    b &= ~((1 << 6) | (1 << 7));
    return { b, ax: ax.map(v => Math.round(v * 100) / 100), lt: Math.round(lt * 100) / 100, rt: Math.round(rt * 100) / 100, vraie };
  }
  function padEnvoyer(force) {
    if (!actif) return;
    const e = padLire(), sig = JSON.stringify([e.b, e.ax, e.lt, e.rt]), actifPad = e.b || e.lt || e.rt || e.ax.some(v => Math.abs(v) > 0.05);
    const now = Date.now();
    if (sig !== padSig || (actifPad && now - padEnvoiT > 400) || (force && sig !== padSig)) {
      if (!force && sig !== padSig && now - padEnvoiT < 16) return;
      padSig = sig; padEnvoiT = now;
      envoyer({ t: "pad", b: e.b, ax: e.ax, lt: e.lt, rt: e.rt });
    }
  }
  function padReset() {
    padEcranB = 0; padEcranAx = [0, 0, 0, 0]; padEcranLt = padEcranRt = 0;
    for (const el of pad.querySelectorAll(".on")) el.classList.remove("on");
    for (const el of pad.querySelectorAll(".stick i")) el.style.transform = "";
    if (padSig && padSig !== JSON.stringify([0, [0, 0, 0, 0], 0, 0])) envoyer({ t: "pad", b: 0, ax: [0, 0, 0, 0], lt: 0, rt: 0 });
    padSig = "";
  }
  let manetteVue = false;
  (function boucleManette() {
    if (actif) padEnvoyer(false);
    requestAnimationFrame(boucleManette);
  })();
  addEventListener("gamepadconnected", () => { if (actif && !manetteVue) { manetteVue = true; message("Manette reconnue : elle pilote le PC.", 2200); } });

  // ---------- le bouton de l'en-tête et « stream le gros PC » ----------
  async function etat() {
    try { const r = await fetch("/api/bureau/etat", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (x) { return null; }
  }
  async function basculer() {
    vib(10);
    if (actif) return arreter("");
    const d = await etat();
    if (!d) return avis("Le PC ne répond pas.");
    if (!d.appareil) return avis("Connecte d'abord l'appli au PC (scanne le QR code).");
    if (!d.autorise) return avis("La prise en main est interdite sur le PC. Dis à Nova « autorise la prise en main ».");
    if (d.pilote && !d.par_moi) return avis("Un autre téléphone pilote déjà le PC.");
    demarrer();
  }
  function poserBouton() {
    if ($("btnBureau")) return;
    const ref = $("btnLibre");
    if (!ref || !ref.parentNode) return;
    const b = document.createElement("button");
    b.id = "btnBureau"; b.setAttribute("aria-label", "Piloter le PC");
    b.innerHTML = IC.pc + "<span>PC</span>";
    b.onclick = basculer;
    ref.parentNode.insertBefore(b, ref);
  }
  function poserGrosBouton() {   // 12/11 : le bouton bien visible, dans la barre du bas (même action que la pilule « PC »)
    if ($("btnPilote")) return;
    const pouce = $("pouce");
    if (!pouce) return;
    const b = document.createElement("button");
    b.id = "btnPilote"; b.type = "button"; b.setAttribute("aria-label", "Piloter le PC depuis le téléphone");
    b.innerHTML = IC.pc;
    b.onclick = basculer;
    pouce.appendChild(b);
    document.documentElement.classList.add("piloteBas");
  }
  try { poserBouton(); } catch (x) {}
  try { poserGrosBouton(); } catch (x) {}
  let pasAppareil = 0;
  setInterval(async () => {   // « stream le gros PC » dit à Nova : l'appli ouverte affiche le PC
    if (actif || document.visibilityState !== "visible" || Date.now() < pasAppareil) return;
    const d = await etat();
    if (!d || !d.appareil) { pasAppareil = Date.now() + 60000; return; }
    if (d.demande && d.autorise && !actif) demarrer(d.demande);
  }, 5000);

  window.NovaBureau = { demarrer, arreter, get actif() { return actif; } };
})();
