// 2026-11-25 (5) APPLIS : le tiroir des applis de Nova sur le téléphone.
// Glisser vers la droite (n'importe où sur l'écran principal, le tiroir suit le doigt) ou bouton ▦ de l'en-tête.
//  - Hors ligne (dans l'appli, gardées par le service worker) : Cartable, Lecture de notes -> cadre plein écran, même origine.
//  - Depuis le PC : la liste vient de GET /api/montrer/applis (clés + titres seulement, jamais un chemin) ; un appui
//    POST /api/montrer/appli {cle} -> partage « montrer » ouvert dans le panneau de Nova (NovaMontrer.ouvrirPartage).
//  - Raccourcis : À voir, écran du PC, vidéo Gemini, déjà montré.
// Retour d'Android : ferme l'appli ouverte, puis le tiroir (window.NovaRetour, montrer.js).
(() => {
  "use strict";
  if (window.NovaApplis) return;
  const $ = id => document.getElementById(id);
  const NA = window.NovaAppli || {};
  const RACINE = new URL("./", location.href).href;

  const IC = {
    cartable: '<path d="M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M4 12h16M11 12v2h2v-2"/>',
    lecture: '<path d="M3 7h18M3 10.5h18M3 14h18M3 17.5h18"/><ellipse cx="9" cy="17.4" rx="2.2" ry="1.6" transform="rotate(-20 9 17.4)" fill="currentColor"/><path d="M11 17V6.5"/><ellipse cx="15.5" cy="10.4" rx="2.2" ry="1.6" transform="rotate(-20 15.5 10.4)" fill="currentColor"/><path d="M17.5 10V3.5"/>',
    yuno: '<path d="M4 15v-6M8 18V6M12 20V4M16 17V7M20 14v-4"/>',
    clip: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>',
    plan: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 15.5h8M8 8.5h4"/>',
    daisy: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="7.5" cy="9.5" r="1.2"/><circle cx="12" cy="9.5" r="1.2"/><circle cx="16.5" cy="9.5" r="1.2"/><circle cx="7.5" cy="14.5" r="1.2"/><circle cx="12" cy="14.5" r="1.2"/><circle cx="16.5" cy="14.5" r="1.2"/>',
    expose: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M7 12l3-3 2.5 2.5L17 7"/>',
    tickets: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    avoir: '<path d="M12 3l2.4 5.6 6 .5-4.6 4 1.4 5.9L12 16l-5.2 3 1.4-5.9-4.6-4 6-.5z"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    video: '<circle cx="12" cy="12" r="3.2"/><path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    montre: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"/>',
    labo: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/><circle cx="15.5" cy="15" r="1.1" fill="currentColor"/><circle cx="8" cy="9.5" r="1" fill="currentColor"/>',
    grille: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  };
  // Applis gardées DANS l'appli (GitHub Pages + service worker) : marchent sans réseau.
  const LOCALES = [
    { cle: "cartable", titre: "Cartable", ic: "cartable", teinte: "#e7a35c", url: "cartable/interface/index.html", hl: true },
    { cle: "lecture", titre: "Lecture de notes", ic: "lecture", teinte: "#8fd8ff", url: "lecture.html", hl: true, micro: true },
    { cle: "labo", titre: "Labo Netrunner", ic: "labo", teinte: "#3df2e0", url: "labo.html", hl: true },   // 26/11 : mesures servies par le PC
  ];
  // 26/11 : Labo Netrunner autonome = appli Android (le téléphone scanne lui-même, sans le PC), publiée avec l'appli.
  const APK_LABO = "https://baptistedezzole-hash.github.io/nova-telephone/labo-netrunner-tel.apk";
  // Applis du PC (le PC dit lesquelles existent) : icônes et couleurs seulement ici.
  const PC = {
    "atelier-yuno": { titre: "Atelier Yuno musique", court: "Atelier musique", ic: "yuno", teinte: "#ff4fd8" },
    "atelier-clip": { titre: "Atelier vidéo Yuno", court: "Atelier vidéo", ic: "clip", teinte: "#b26bff" },
    "hello-world": { titre: "Plan Hello World", court: "Hello World", ic: "plan", teinte: "#ffd84a" },
    "daisy-apc": { titre: "Plan Daisy APC", court: "Daisy APC", ic: "daisy", teinte: "#5cff9d" },
    "expose": { titre: "Dernier exposé", court: "Exposé", ic: "expose", teinte: "#a9c8ff" },
    "tickets": { titre: "Notes de frais", court: "Notes de frais", ic: "tickets", teinte: "#ffb03a" },
  };
  const RACCOURCIS = [
    { cle: "avoir", titre: "À voir", ic: "avoir", teinte: "#e9d6a8", ok: () => !!(window.NovaAVoir && NovaAVoir.ouvrirListe), go: () => NovaAVoir.ouvrirListe() },
    { cle: "montre", titre: "Déjà montré", ic: "montre", teinte: "#e9d6a8", ok: () => !!$("btnMontre"), go: () => $("btnMontre").click() },
    { cle: "pc", titre: "Écran du PC", ic: "pc", teinte: "#9fb4ff", reseau: true, ok: () => !!(window.NovaBureau && NovaBureau.demarrer), go: () => NovaBureau.demarrer() },
    { cle: "video", titre: "Vidéo Gemini", ic: "video", teinte: "#7fe3c4", reseau: true, ok: () => !!(window.NovaVideo && NovaVideo.demarrer), go: () => NovaVideo.demarrer() },
  ];
  const CACHE_LISTE = "nova-applis-pc";

  const css = `
#btnApplis { width:34px; height:34px; padding:0; border-radius:50%; display:grid; place-items:center; color:#e9d6a8;
  border:1px solid rgba(233,214,168,.32); background:rgba(233,214,168,.07); flex:none; }
#btnApplis svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linejoin:round; }
#btnApplis:active { transform:scale(.94); }
#applisVoile { position:fixed; inset:0; z-index:2147483000; background:rgba(2,3,10,.62); opacity:0; pointer-events:none; transition:opacity .32s;
  -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); }
#applisVoile.vu { pointer-events:auto; }
#applis { position:fixed; z-index:2147483001; top:0; bottom:0; left:0; width:min(88vw,400px); display:flex; flex-direction:column;
  transform:translateX(-104%); transition:transform .38s cubic-bezier(.22,.8,.24,1); will-change:transform; touch-action:pan-y;
  color:rgba(226,232,246,.94); font-family:var(--sans,system-ui,sans-serif);
  background:radial-gradient(1px 1px at 18% 12%,rgba(255,255,255,.7),transparent 60%),radial-gradient(1px 1px at 76% 22%,rgba(255,255,255,.5),transparent 60%),
    radial-gradient(1.5px 1.5px at 62% 71%,rgba(233,214,168,.7),transparent 60%),radial-gradient(1px 1px at 28% 88%,rgba(169,200,255,.55),transparent 60%),
    radial-gradient(1px 1px at 90% 52%,rgba(255,255,255,.45),transparent 60%),radial-gradient(130% 70% at 0% 0%,rgba(124,77,255,.16),transparent 60%),
    radial-gradient(120% 60% at 100% 100%,rgba(233,214,168,.10),transparent 60%),linear-gradient(160deg,#0a0820,#04040d 70%);
  box-shadow:1px 0 0 rgba(233,214,168,.22),24px 0 60px rgba(0,0,0,.55); border-radius:0 26px 26px 0; overflow:hidden; }
#applis.vu { transform:none; }
#applis.glisse, #applisVoile.glisse { transition:none; }
#applis .tete { flex:none; padding:calc(env(safe-area-inset-top,0px) + 22px) 22px 6px calc(env(safe-area-inset-left,0px) + 24px); }
#applis .tete .lbl { font:500 11px/1 var(--sans,system-ui); letter-spacing:.32em; text-transform:uppercase; color:rgba(233,214,168,.78); }
#applis .tete h2 { margin:8px 0 0; font:300 30px/1.05 var(--sans,system-ui); letter-spacing:.02em; color:#f4efff; }
#applis .etatPc { margin-top:10px; display:flex; align-items:center; gap:8px; font-size:12.5px; color:rgba(214,224,255,.66); }
#applis .etatPc i { width:7px; height:7px; border-radius:50%; background:#5a5f73; box-shadow:0 0 0 3px rgba(90,95,115,.18); }
#applis .etatPc.ok i { background:#5cff9d; box-shadow:0 0 10px rgba(92,255,157,.7); }
#applis .corps { flex:1; overflow-y:auto; overscroll-behavior:contain; padding:8px 18px calc(env(safe-area-inset-bottom,0px) + 26px) calc(env(safe-area-inset-left,0px) + 18px); }
#applis h3 { margin:20px 6px 12px; display:flex; align-items:center; gap:10px; font:500 11px/1 var(--sans,system-ui); letter-spacing:.24em;
  text-transform:uppercase; color:rgba(214,224,255,.55); }
#applis h3::after { content:""; flex:1; height:1px; background:linear-gradient(90deg,rgba(233,214,168,.28),transparent); }
#applis .grille { display:grid; grid-template-columns:repeat(3,1fr); gap:16px 8px; }
#applis .app { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding:4px 0 2px; border:0; background:none;
  color:inherit; font:inherit; cursor:pointer; -webkit-tap-highlight-color:transparent; opacity:0; transform:translateY(8px) scale(.96);
  transition:opacity .35s, transform .35s; }
#applis.vu .app { opacity:1; transform:none; }
#applis .app .ic { position:relative; width:64px; height:64px; border-radius:20px; display:grid; place-items:center; color:var(--t);
  background:radial-gradient(90% 90% at 30% 20%,color-mix(in srgb,var(--t) 26%,transparent),transparent 70%),linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.02));
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--t) 40%,transparent),inset 0 1px 0 rgba(255,255,255,.14),0 8px 24px rgba(0,0,0,.4),0 0 22px color-mix(in srgb,var(--t) 16%,transparent);
  transition:transform .18s, box-shadow .18s; }
#applis .app .ic svg { width:30px; height:30px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round;
  filter:drop-shadow(0 0 6px color-mix(in srgb,var(--t) 55%,transparent)); }
#applis .app:active .ic { transform:scale(.92); }
#applis .app .nom { max-width:100%; padding:0 2px; font-size:12.5px; line-height:1.2; text-align:center; color:rgba(240,236,255,.92);
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
#applis .app .pas { position:absolute; top:-3px; right:calc(50% - 40px); padding:3px 6px; border-radius:9px; font:600 8.5px/1 var(--sans,system-ui);
  letter-spacing:.08em; text-transform:uppercase; color:#06140c; background:#5cff9d; box-shadow:0 0 10px rgba(92,255,157,.5); }
#applis .app .pas.pc { color:#0b0a18; background:#c9b6ff; box-shadow:0 0 10px rgba(201,182,255,.45); }
#applis .app.eteinte { filter:saturate(.25); opacity:.42 !important; }
#applis .app.charge .ic::after { content:""; position:absolute; inset:-4px; border-radius:23px; border:2px solid transparent;
  border-top-color:var(--t); animation:applisTourne .9s linear infinite; }
@keyframes applisTourne { to { transform:rotate(360deg); } }
#applis .autonome { margin:14px 4px 0; display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:16px; text-decoration:none;
  color:#3df2e0; font:500 13px/1.3 var(--sans,system-ui); background:linear-gradient(160deg,rgba(61,242,224,.10),rgba(61,242,224,.03));
  box-shadow:inset 0 0 0 1px rgba(61,242,224,.32); -webkit-tap-highlight-color:transparent; }
#applis .autonome svg { flex:none; width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
#applis .autonome small { display:block; color:rgba(214,224,255,.5); font-size:11px; }
#applis .autonome:active { transform:scale(.98); }
#applis .note { margin:22px 6px 0; font-size:12px; line-height:1.45; color:rgba(214,224,255,.45); }
#applisMot { position:fixed; z-index:2147483600; left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 28px); transform:translate(-50%,20px);
  max-width:calc(100vw - 40px); padding:12px 18px; border-radius:16px; font:500 14px/1.35 var(--sans,system-ui); color:#f4efff; opacity:0;
  background:rgba(14,12,34,.94); box-shadow:0 0 0 1px rgba(233,214,168,.3),0 12px 40px rgba(0,0,0,.5); pointer-events:none; transition:opacity .25s, transform .25s; }
#applisMot.vu { opacity:1; transform:translate(-50%,0); }
#appliVue { position:fixed; inset:0; z-index:2147483200; display:none; flex-direction:column; background:#02030a; opacity:0; transform:scale(.97);
  transition:opacity .3s, transform .3s cubic-bezier(.22,.8,.24,1); }
#appliVue.vu { display:flex; }
#appliVue.on { opacity:1; transform:none; }
#appliVue .barre { flex:none; display:flex; align-items:center; gap:10px; padding:calc(env(safe-area-inset-top,0px) + 7px) 12px 7px calc(env(safe-area-inset-left,0px) + 8px);
  background:linear-gradient(rgba(10,8,32,.98),rgba(4,4,13,.96)); box-shadow:0 1px 0 rgba(233,214,168,.18); }
#appliVue .retour { display:flex; align-items:center; gap:4px; height:34px; padding:0 12px 0 8px; border-radius:17px; border:1px solid rgba(233,214,168,.32);
  background:rgba(233,214,168,.07); color:#e9d6a8; font:500 13.5px/1 var(--sans,system-ui); }
#appliVue .retour svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
#appliVue .titre { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font:600 13.5px/1.2 var(--sans,system-ui); color:#e9d6a8; letter-spacing:.02em; }
#appliVue .hl { font:600 9px/1 var(--sans,system-ui); letter-spacing:.1em; text-transform:uppercase; color:#5cff9d; }
#appliVue iframe { flex:1; width:100%; border:0; background:#02030a; }
`;

  // ---------- construction ----------
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k] || IC.grille}</svg>`;
  const voile = document.createElement("div"); voile.id = "applisVoile";
  const T = document.createElement("aside"); T.id = "applis"; T.setAttribute("aria-label", "Applis"); T.setAttribute("aria-hidden", "true");
  T.innerHTML = `<div class="tete"><div class="lbl">Nova</div><h2>Applis</h2><div class="etatPc"><i></i><span>…</span></div></div>
<div class="corps"><h3>Sur le téléphone</h3><div class="grille" data-g="locales"></div>
<a class="autonome" href="${APK_LABO}" target="_blank" rel="noopener" data-cle="labo-appli"><svg viewBox="0 0 24 24" aria-hidden="true">${IC.labo}</svg><span>Labo Netrunner : version autonome (appli)<small>Le téléphone scanne lui-même, sans le PC</small></span></a>
<h3>Depuis le PC</h3><div class="grille" data-g="pc"></div>
<h3>Raccourcis</h3><div class="grille" data-g="raccourcis"></div>
<p class="note">Glisse vers la droite pour revenir ici. « Hors ligne » marche sans réseau ; « PC » demande le PC allumé.</p></div>`;
  const V = document.createElement("div"); V.id = "appliVue";
  V.innerHTML = `<div class="barre"><button class="retour" type="button" aria-label="Revenir aux applis"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Applis</button><span class="titre"></span><span class="hl"></span></div>`;
  const mot = document.createElement("div"); mot.id = "applisMot"; mot.setAttribute("role", "status");
  document.body.append(voile, T, V, mot);

  const btn = document.createElement("button"); btn.id = "btnApplis"; btn.type = "button"; btn.setAttribute("aria-label", "Applis"); btn.innerHTML = svg("grille");
  function poserBouton() {
    const h = document.querySelector("#app > header"); if (!h || $("btnApplis")) return;
    const avant = $("btnLibre") || $("btnReglages"); h.insertBefore(btn, avant && avant.parentNode === h ? avant : null);
  }
  poserBouton();

  let motT = 0;
  function dire(t, ms = 3200) { mot.textContent = t; mot.classList.add("vu"); clearTimeout(motT); motT = setTimeout(() => mot.classList.remove("vu"), ms); }

  let listePc = null, pcOk = null;
  try { const l = JSON.parse(localStorage.getItem(CACHE_LISTE) || "null"); if (Array.isArray(l)) listePc = l; } catch (x) {}

  function tuile(o, badge, eteinte, action, i) {
    const b = document.createElement("button"); b.type = "button"; b.className = "app" + (eteinte ? " eteinte" : ""); b.dataset.cle = o.cle;
    b.style.setProperty("--t", o.teinte || "#e9d6a8"); b.style.transitionDelay = (40 + i * 28) + "ms";
    b.innerHTML = `<span class="ic">${svg(o.ic)}</span>${badge ? `<span class="pas${badge === "PC" ? " pc" : ""}">${badge}</span>` : ""}<span class="nom"></span>`;
    b.querySelector(".nom").textContent = o.court || o.titre;
    b.setAttribute("aria-label", o.titre + (badge ? " (" + badge.toLowerCase() + ")" : ""));
    b.onclick = () => action(b);
    return b;
  }
  function dessiner() {
    const g = n => T.querySelector(`[data-g="${n}"]`);
    let i = 0;
    g("locales").replaceChildren(...LOCALES.map(o => tuile(o, "hors ligne", false, () => ouvrirLocale(o), i++)));
    const cles = (listePc || Object.keys(PC).map(cle => ({ cle }))).filter(a => PC[a.cle]);
    g("pc").replaceChildren(...cles.map(a => tuile({ cle: a.cle, ...PC[a.cle] }, "PC", pcOk === false || !navigator.onLine, b => ouvrirPc(a.cle, b), i++)));
    g("raccourcis").replaceChildren(...RACCOURCIS.filter(r => r.ok()).map(r => tuile(r, "", r.reseau && !navigator.onLine, () => {
      if (r.reseau && !navigator.onLine) { dire("Besoin du réseau pour " + r.titre + "."); return; }
      fermer(true); setTimeout(() => { try { r.go(); } catch (x) { dire("Pas disponible pour l'instant."); } }, 260); }, i++)));
    const e = T.querySelector(".etatPc");
    e.classList.toggle("ok", pcOk === true);
    e.querySelector("span").textContent = !navigator.onLine ? "Hors ligne : les applis « hors ligne » marchent quand même"
      : pcOk === true ? "PC connecté" : pcOk === false ? "PC éteint ou injoignable" : "Recherche du PC…";
  }

  async function rafraichirPc() {
    if (!navigator.onLine) { pcOk = false; dessiner(); return; }
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch("/api/montrer/applis", { cache: "no-store", signal: ctl.signal }); clearTimeout(t);
      if (!r.ok) throw new Error("http " + r.status);
      const d = await r.json();
      listePc = (Array.isArray(d.applis) ? d.applis : []).filter(a => a && typeof a.cle === "string" && PC[a.cle]).map(a => ({ cle: a.cle }));
      try { localStorage.setItem(CACHE_LISTE, JSON.stringify(listePc)); } catch (x) {}
      pcOk = true;
    } catch (x) { pcOk = false; }
    if (T.classList.contains("vu")) dessiner();
  }

  // ---------- historique (retour d'Android) ----------
  // history.back() est asynchrone : retirer une entrée puis en poser une autre tout de suite les mélange
  // (le retour suivant sortait de l'appli). Toutes les opérations passent donc par une file, dans l'ordre.
  let file = Promise.resolve();
  const histo = fn => { file = file.then(fn).catch(() => null); };
  const retirer = nom => new Promise(ok => {
    const R = window.NovaRetour;
    if (!R || !R._pile || !R._pile().includes(nom)) return ok();
    const fin = () => { removeEventListener("popstate", fin); clearTimeout(t); ok(); };
    const t = setTimeout(fin, 600);
    addEventListener("popstate", fin);
    try { R.fermer(nom); } catch (x) { fin(); }
  });
  const pousser = (nom, cb) => { try { if (window.NovaRetour) NovaRetour.ouvrir(nom, cb); } catch (x) {} };

  // ---------- ouvrir ----------
  let ouverte = null;
  function ouvrirLocale(o) {
    let f = V.querySelector("iframe");
    if (f) f.remove();
    f = document.createElement("iframe");
    f.title = o.titre;
    if (o.micro) f.allow = "microphone; autoplay";
    f.src = new URL(o.url, RACINE).href;
    V.appendChild(f);
    V.querySelector(".titre").textContent = o.titre;
    V.querySelector(".hl").textContent = o.hl ? "hors ligne" : "";
    V.classList.add("vu"); requestAnimationFrame(() => requestAnimationFrame(() => V.classList.add("on")));
    ouverte = o.cle;
    fermer(true);
    const cle = o.cle;
    histo(() => { if (ouverte === cle) pousser("appli", () => fermerAppli(true)); });
  }
  function fermerAppli(parRetour) {
    if (!ouverte) return;
    ouverte = null;
    V.classList.remove("on");
    setTimeout(() => { if (!ouverte) { V.classList.remove("vu"); const f = V.querySelector("iframe"); if (f) f.remove(); } }, 320);
    if (!parRetour) histo(() => retirer("appli"));
    ouvrir();   // retour = la grille des applis
  }
  V.querySelector(".retour").onclick = () => fermerAppli(false);

  let enCours = false;
  async function ouvrirPc(cle, b) {
    if (enCours) return;
    if (!navigator.onLine || pcOk === false) {
      dire("Besoin du PC allumé pour " + (PC[cle] ? PC[cle].titre : "cette appli") + ".");
      if (navigator.onLine) rafraichirPc();
      return;
    }
    enCours = true; if (b) b.classList.add("charge");
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch("/api/montrer/appli", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cle }), signal: ctl.signal });
      clearTimeout(t);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || typeof d.partage !== "string" || !/^[a-z0-9]{10}$/.test(d.partage)) {
        dire(r.status === 404 ? "Cette appli n'est plus sur le PC." : r.status === 413 ? "Trop gros pour le téléphone." : "Besoin du PC allumé.");
        if (r.status === 404) rafraichirPc();
        return;
      }
      if (!(window.NovaMontrer && NovaMontrer.ouvrirPartage)) { dire("Besoin du PC allumé (panneau pas encore chargé)."); return; }
      fermer(true);
      await new Promise(ok => histo(ok));   // l'entrée du tiroir est retirée avant que le panneau pose la sienne
      NovaMontrer.ouvrirPartage({ id: d.partage, titre: d.titre || PC[cle].titre, type: d.type || "html", paysage: !!d.paysage, t: Date.now() / 1000 });
    } catch (x) {
      pcOk = false; dire("Besoin du PC allumé.");
    } finally { enCours = false; if (b) b.classList.remove("charge"); }
  }

  // ---------- tiroir ----------
  const largeur = () => T.getBoundingClientRect().width || Math.min(innerWidth * 0.88, 400);
  function poser(x) {   // x = 0 (fermé) .. 1 (ouvert)
    x = Math.max(0, Math.min(1, x));
    T.style.transform = `translateX(${(x - 1) * 104}%)`; voile.style.opacity = String(x);
  }
  function ouvrir() {
    poserBouton();
    dessiner();
    T.classList.remove("glisse"); voile.classList.remove("glisse"); T.style.transform = ""; voile.style.opacity = "";
    T.classList.add("vu"); voile.classList.add("vu"); voile.style.opacity = "1"; T.setAttribute("aria-hidden", "false");
    histo(() => { if (T.classList.contains("vu")) pousser("applis", () => fermer(false, true)); });
    rafraichirPc();
  }
  function fermer(versAppli, parRetour) {
    if (!T.classList.contains("vu")) return;
    T.classList.remove("glisse", "vu"); voile.classList.remove("glisse", "vu"); T.style.transform = ""; voile.style.opacity = "0";
    T.setAttribute("aria-hidden", "true");
    if (!parRetour) histo(() => retirer("applis"));
  }
  btn.onclick = () => (T.classList.contains("vu") ? fermer() : ouvrir());
  voile.onclick = () => fermer();

  // Glisser : vers la droite sur l'écran principal = ouvre (suit le doigt) ; vers la gauche dans le tiroir = ferme.
  const IGNORER = "#histo, #parler, #perm, #saisie, #histoOuvrir, input, textarea, select, [contenteditable], .feuille, #montre, #appliVue, #applis";
  function bloque() {
    return !!(document.querySelector(".feuille.vu") || ($("montre") && $("montre").classList.contains("vu")) || V.classList.contains("vu")
      || (window.NovaHisto && NovaHisto.ouvert && NovaHisto.ouvert()) || (window.NovaBureau && NovaBureau.actif));
  }
  let g = null;
  function debut(e, mode) {
    if (e.touches && e.touches.length !== 1) { g = null; return; }
    const p = e.touches ? e.touches[0] : e;
    g = { mode, x0: p.clientX, y0: p.clientY, t0: Date.now(), pris: false, x: 0 };
  }
  function bouge(e) {
    if (!g) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if (!g.pris) {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.4 || (g.mode === "ouvrir" ? dx < 0 : dx > 0)) { g = null; return; }
      g.pris = true; T.classList.add("glisse"); voile.classList.add("glisse");
      if (g.mode === "ouvrir") { dessiner(); voile.classList.add("vu"); T.classList.add("vu"); }
    }
    if (e.cancelable) e.preventDefault();
    const w = largeur();
    g.x = g.mode === "ouvrir" ? Math.max(0, dx - 14) / w : 1 + Math.min(0, dx + 14) / w;
    poser(g.x);
  }
  function fin() {
    if (!g) return;
    const s = g; g = null;
    if (!s.pris) return;
    const vite = Date.now() - s.t0 < 260;
    const garder = s.mode === "ouvrir" ? (s.x > 0.33 || (vite && s.x > 0.08)) : (s.x > 0.67 && !(vite && s.x < 0.94));
    if (garder) {
      if (s.mode === "ouvrir") { T.classList.remove("vu"); voile.classList.remove("vu"); ouvrir(); }
      else { T.classList.remove("glisse"); voile.classList.remove("glisse"); T.style.transform = ""; voile.style.opacity = "1"; }
    } else {
      if (s.mode === "ouvrir") { T.classList.remove("glisse", "vu"); voile.classList.remove("glisse", "vu"); T.style.transform = ""; voile.style.opacity = "0"; T.setAttribute("aria-hidden", "true"); }
      else fermer();
    }
  }
  const appli = $("app") || document.body;
  appli.addEventListener("touchstart", e => {
    if (T.classList.contains("vu") || bloque() || (e.target.closest && e.target.closest(IGNORER))) { g = null; return; }
    const p = e.touches[0];
    if (p.clientX > innerWidth * 0.8) { g = null; return; }   // pas depuis le bord droit (rien à tirer de là)
    debut(e, "ouvrir");
  }, { passive: true });
  T.addEventListener("touchstart", e => debut(e, "fermer"), { passive: true });
  voile.addEventListener("touchstart", e => debut(e, "fermer"), { passive: true });
  for (const el of [appli, T, voile]) {
    el.addEventListener("touchmove", bouge, { passive: false });
    el.addEventListener("touchend", fin, { passive: true });
    el.addEventListener("touchcancel", fin, { passive: true });
  }

  addEventListener("online", () => { pcOk = null; if (T.classList.contains("vu")) rafraichirPc(); });
  addEventListener("offline", () => { pcOk = false; if (T.classList.contains("vu")) dessiner(); });
  Promise.resolve(NA.pret).then(() => setTimeout(rafraichirPc, 1500)).catch(() => {});

  window.NovaApplis = { ouvrir, fermer: () => { fermerAppli(false); fermer(); }, lancer: cle => {
    const o = LOCALES.find(x => x.cle === cle); if (o) return ouvrirLocale(o);
    if (PC[cle]) return ouvrirPc(cle, T.querySelector(`.app[data-cle="${cle}"]`));
    const r = RACCOURCIS.find(x => x.cle === cle); if (r && r.ok()) { fermer(true); r.go(); }
  }, _etat: () => ({ ouvert: T.classList.contains("vu"), ouverte, pcOk, listePc }) };
})();
