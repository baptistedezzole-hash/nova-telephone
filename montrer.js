// Nova sur le téléphone : « MONTRE-LE-MOI » (2026-11-13). Nova montre ici une page HTML du PC (jouable au toucher) ou
// une image : telephone.py montrer <chemin> [titre] [--paysage]. Un panneau étoilé s'ouvre tout seul quand l'appli est
// ouverte ; croix pour fermer, ✦ dans l'en-tête = « déjà montré », ✎ = écrire à Nova sans quitter la page. Toucher = clic ; bouton R si la page écoute le clavier.
// Chargé par index.html via /api/montrer/script (servi par le PC), sinon montrer.js (adresse fixe).
// Côté PC : outils\telephone_montrer.py. La page montrée vit dans une iframe SANDBOXÉE (origine opaque, CSP du PC) :
// elle ne voit ni le jeton ni les réglages de l'appli ; ses fichiers passent par un ticket lié à cet appareil.
(() => {
  "use strict";
  if (window.NovaMontrer) return;
  const $ = id => document.getElementById(id);
  const NA = window.NovaAppli || {};
  const RECENT = 6 * 3600 * 1000;   // ouverture automatique : seulement ce qui a été montré il y a moins de 6 h
  const css = `
#btnMontre { display:none; width:34px; height:34px; padding:0; border-radius:50%; place-items:center; color:#e9d6a8; border:1px solid rgba(233,214,168,.32); background:rgba(233,214,168,.07); font-size:15px; line-height:1; }
#btnMontre.vu { display:grid; }
#btnMontre:active { transform:scale(.94); }
#montre { position:fixed; inset:0; z-index:2147483400; display:none; color:rgba(226,232,246,.92); font-family:var(--sans,system-ui,sans-serif);
  background:radial-gradient(1px 1px at 12% 18%,rgba(255,255,255,.7),transparent 60%),radial-gradient(1px 1px at 73% 9%,rgba(255,255,255,.55),transparent 60%),
  radial-gradient(1.5px 1.5px at 88% 64%,rgba(233,214,168,.7),transparent 60%),radial-gradient(1px 1px at 31% 82%,rgba(255,255,255,.5),transparent 60%),
  radial-gradient(1px 1px at 52% 41%,rgba(169,200,255,.55),transparent 60%),radial-gradient(1px 1px at 6% 61%,rgba(255,255,255,.45),transparent 60%),
  radial-gradient(1px 1px at 64% 93%,rgba(255,255,255,.4),transparent 60%),radial-gradient(120% 90% at 50% 110%,rgba(233,214,168,.10),transparent 60%),#02030a;
  opacity:0; transition:opacity .35s; overscroll-behavior:none; }
#montre.vu { display:block; }
#montre.on { opacity:1; }
#montre .scene { position:absolute; left:calc(env(safe-area-inset-left,0px) + 4px); right:calc(env(safe-area-inset-right,0px) + 4px);
  top:calc(env(safe-area-inset-top,0px) + 50px); bottom:calc(env(safe-area-inset-bottom,0px) + 4px); overflow:hidden; }
#montre.plein .scene { top:env(safe-area-inset-top,0px); bottom:env(safe-area-inset-bottom,0px); left:env(safe-area-inset-left,0px); right:env(safe-area-inset-right,0px); }
#montre iframe, #montre img.vue { position:absolute; left:50%; top:50%; border:0; background:#000; transform-origin:50% 50%;
  box-shadow:0 0 0 1px rgba(233,214,168,.22),0 0 40px rgba(233,214,168,.08); border-radius:6px; }
#montre img.vue { background:transparent; }
#montre .barre { position:absolute; z-index:2; top:0; left:0; right:0; display:flex; align-items:center; gap:7px;
  padding:calc(7px + env(safe-area-inset-top,0px)) calc(9px + env(safe-area-inset-right,0px)) 7px calc(12px + env(safe-area-inset-left,0px));
  background:linear-gradient(rgba(2,3,10,.9),rgba(2,3,10,0)); transition:opacity .3s, transform .3s; }
#montre.plein .barre { opacity:0; transform:translateY(-100%); pointer-events:none; }
#montre .titre { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font:600 13.5px/1.2 var(--sans,system-ui,sans-serif); color:#e9d6a8; letter-spacing:.02em; }
#montre .titre small { display:block; font:500 10px/1.3 var(--mono,ui-monospace,monospace); letter-spacing:.12em; text-transform:uppercase; color:rgba(226,232,246,.45); }
#montre .barre button { flex:none; height:34px; min-width:34px; padding:0 10px; border-radius:999px; border:1px solid rgba(255,255,255,.14);
  background:rgba(10,14,30,.75); color:inherit; font:600 12.5px/1 var(--sans,system-ui,sans-serif); display:flex; align-items:center; justify-content:center; gap:5px; }
#montre .barre button.or { border-color:rgba(233,214,168,.5); color:#e9d6a8; background:rgba(233,214,168,.12); }
#montre .barre button:active { transform:scale(.94); }
#montre .barre .fermer { width:36px; height:36px; padding:0; font-size:17px; }
#montre .barre .r { display:none; } #montre.clavier .barre .r { display:flex; }
#montre .poignee { position:absolute; z-index:2; top:calc(3px + env(safe-area-inset-top,0px)); right:calc(8px + env(safe-area-inset-right,0px)); display:none;
  width:34px; height:34px; border-radius:50%; border:1px solid rgba(233,214,168,.35); background:rgba(10,14,30,.6); color:#e9d6a8; font-size:15px; }
#montre.plein .poignee { display:grid; place-items:center; }
#montre .liste { position:absolute; z-index:3; top:calc(env(safe-area-inset-top,0px) + 50px); right:calc(10px + env(safe-area-inset-right,0px));
  width:min(84vw,320px); max-height:62vh; overflow:auto; padding:8px; border-radius:16px; background:rgba(10,13,26,.94); border:1px solid rgba(214,224,255,.12);
  box-shadow:0 12px 40px rgba(0,0,0,.55); display:none; }
#montre.liste-on .liste { display:block; }
#montre .liste h4 { margin:4px 8px 8px; font:500 10px/1.2 var(--mono,ui-monospace,monospace); letter-spacing:.16em; text-transform:uppercase; color:rgba(226,232,246,.45); }
#montre .liste button { display:block; width:100%; text-align:left; padding:10px 12px; border-radius:11px; border:1px solid transparent; background:none; color:inherit; font:500 14px/1.3 var(--sans,system-ui,sans-serif); }
#montre .liste button.ici { border-color:rgba(233,214,168,.35); background:rgba(233,214,168,.08); color:#e9d6a8; }
#montre .liste button small { display:block; color:rgba(226,232,246,.45); font-size:11.5px; margin-top:2px; }
#montre .msg { position:absolute; z-index:1; left:50%; top:50%; transform:translate(-50%,-50%); max-width:min(84vw,380px); padding:14px 18px; border-radius:14px;
  background:rgba(10,14,30,.88); border:1px solid rgba(255,255,255,.12); font-size:14px; line-height:1.4; text-align:center; display:none; }
#montre .msg.vu { display:block; }
#montre .mot { position:absolute; z-index:3; top:calc(env(safe-area-inset-top,0px) + 50px); right:calc(10px + env(safe-area-inset-right,0px));
  width:min(calc(100vw - 32px),340px); padding:10px; border-radius:16px; background:rgba(10,13,26,.95); border:1px solid rgba(233,214,168,.22);
  box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 30px rgba(233,214,168,.06); display:none; box-sizing:border-box; }
#montre.mot-on .mot { display:block; animation:motVient .22s ease-out; }
@keyframes motVient { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
#montre .mot h4 { margin:2px 4px 8px; font:500 10px/1.3 var(--mono,ui-monospace,monospace); letter-spacing:.16em; text-transform:uppercase; color:rgba(226,232,246,.45);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#montre .mot h4 b { color:#e9d6a8; font-weight:500; }
#montre .mot textarea { display:block; width:100%; box-sizing:border-box; min-height:76px; max-height:32vh; resize:none; padding:10px 12px; border-radius:12px;
  border:1px solid rgba(255,255,255,.12); background:rgba(2,3,10,.7); color:rgba(226,232,246,.95); font:400 15px/1.4 var(--sans,system-ui,sans-serif); outline:none; }
#montre .mot textarea:focus { border-color:rgba(233,214,168,.45); }
#montre .mot .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
#montre .mot .actions button { height:34px; padding:0 14px; border-radius:999px; border:1px solid rgba(255,255,255,.14); background:rgba(10,14,30,.75); color:inherit;
  font:600 12.5px/1 var(--sans,system-ui,sans-serif); }
#montre .mot .actions .partir { border-color:rgba(233,214,168,.5); color:#e9d6a8; background:rgba(233,214,168,.12); }
#montre .mot .actions .partir:disabled { opacity:.4; }
#montre .mot .actions button:active { transform:scale(.94); }
#montre .pastille { position:absolute; z-index:4; left:50%; top:calc(env(safe-area-inset-top,0px) + 54px); transform:translate(-50%,-6px); max-width:calc(100vw - 48px);
  padding:7px 14px; border-radius:999px; background:rgba(10,14,30,.92); border:1px solid rgba(233,214,168,.3); color:#e9d6a8;
  font:500 12.5px/1.3 var(--sans,system-ui,sans-serif); opacity:0; pointer-events:none; transition:opacity .25s, transform .25s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#montre .pastille.vu { opacity:1; transform:translate(-50%,0); }
`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const P = document.createElement("div");
  P.id = "montre"; P.setAttribute("role", "dialog"); P.setAttribute("aria-label", "Nova te montre");
  P.innerHTML = `<div class="barre"><div class="titre"><small>✦ Nova te montre</small><span></span></div>
<button class="r or" aria-label="Recommencer (touche R)">↻ R</button>
<button class="tourner" aria-label="Pivoter">⟳</button>
<button class="agrandir" aria-label="Plein écran">⤢</button>
<button class="histo" aria-label="Déjà montré">✦</button>
<button class="ecrire" aria-label="Écrire à Nova">✎</button>
<button class="fermer" aria-label="Fermer">✕</button></div>
<button class="poignee" aria-label="Montrer les boutons">✦</button>
<div class="scene"><div class="msg"></div></div>
<div class="liste"><h4>Déjà montré</h4><div class="items"></div></div>
<div class="mot"><h4>Écrire à Nova · <b></b></h4><textarea rows="3" maxlength="8000" placeholder="Ton message…" aria-label="Message pour Nova"></textarea>
<div class="actions"><button class="laisser" type="button">Plus tard</button><button class="partir" type="button" disabled>Envoyer ➤</button></div></div>
<div class="pastille" role="status" aria-live="polite"></div>`;
  document.body.appendChild(P);
  const scene = P.querySelector(".scene"), msg = P.querySelector(".msg"), items = P.querySelector(".items");

  let partages = [], ouvert = null, vue = null, rot = null, ticket = 0;
  // 2026-11-17 bouton ✦ : « vu » et « dernier ouvert » gardés sur le PC par appareil (srv, renvoyés par /api/montrer/liste,
  // notés par /api/montrer/ouvrir) ET ici en secours (localStorage). Le PC fait foi quand il les donne.
  let srv = { vus: [], dernier: null, connu: false }, frais = null;   // frais = ouverture toute fraîche, pas encore relue du PC
  const lireVus = () => { try { return JSON.parse(localStorage.getItem("nova-montre-vus") || "[]"); } catch (x) { return []; } };
  const lireDernier = () => { try { return localStorage.getItem("nova-montre-dernier") || null; } catch (x) { return null; } };
  const vusTous = () => { const v = lireVus(); for (const x of srv.vus) if (!v.includes(x)) v.push(x); return v; };
  const noterVu = id => {
    try { const v = lireVus().filter(x => x !== id); v.push(id); localStorage.setItem("nova-montre-vus", JSON.stringify(v.slice(-40))); } catch (x) {}
    try { localStorage.setItem("nova-montre-dernier", id); } catch (x) {}
    srv.vus = srv.vus.filter(x => x !== id).concat(id); srv.dernier = id;
    frais = { id, t: Date.now() };
  };
  // Le bouton ✦ : la plus récente pas encore vue (= nouvelle, montrée il y a moins de 6 h), sinon la dernière qu'il a
  // lui-même ouverte (même plus ancienne dans la liste), sinon la plus récente. partages = du plus récent au plus ancien.
  function choisirBouton(partages, vus, dernier, maintenant) {
    const neuves = partages.filter(p => !vus.includes(p.id) && maintenant - p.t * 1000 < RECENT).sort((x, y) => y.t - x.t);
    if (neuves.length) return neuves[0];
    return partages.find(p => p.id === dernier) || partages[0] || null;
  }
  const dire = t => { msg.textContent = t || ""; msg.classList.toggle("vu", !!t); };
  const heure = t => { try { return new Date(t * 1000).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" }); } catch (x) { return ""; } };

  function poserBouton() {
    if ($("btnMontre")) return;
    const ref = $("btnReglages");
    if (!ref || !ref.parentNode) return;
    const b = document.createElement("button");
    b.id = "btnMontre"; b.type = "button"; b.setAttribute("aria-label", "Ce que Nova m'a montré"); b.textContent = "✦";
    b.onclick = () => { const p = choisirBouton(partages, vusTous(), (srv.connu && srv.dernier) || lireDernier(), Date.now()); if (p) ouvrir(p, true); };
    ref.parentNode.insertBefore(b, ref);
  }

  function disposer() {
    if (!vue) return;
    const r = scene.getBoundingClientRect();
    const aw = Math.max(50, r.width), ah = Math.max(50, r.height);
    const paysageEcran = aw >= ah;
    const veutPaysage = ouvert && (ouvert.paysage || (ouvert.taille && ouvert.taille[0] > ouvert.taille[1]));
    const tourne = rot === null ? (!!veutPaysage && !paysageEcran) : rot;
    if (vue.tagName === "IFRAME") {
      let w, h;
      if (ouvert.taille) { [w, h] = ouvert.taille; }
      else { w = tourne ? ah : aw; h = tourne ? aw : ah; }
      const s = ouvert.taille ? (tourne ? Math.min(aw / h, ah / w) : Math.min(aw / w, ah / h)) : 1;
      const cle = w + "x" + h + "/" + tourne + "/" + s;   // 17/11 : rien ne change = on ne touche pas l'iframe (pas de relayout de la vidéo)
      if (vue.dataset.pose === cle) return;
      vue.dataset.pose = cle;
      vue.style.width = w + "px"; vue.style.height = h + "px";
      vue.style.transform = `translate(-50%,-50%) rotate(${tourne ? 90 : 0}deg) scale(${s})`;
    } else {
      const nw = vue.naturalWidth || 1, nh = vue.naturalHeight || 1;
      const s = tourne ? Math.min(aw / nh, ah / nw) : Math.min(aw / nw, ah / nh);
      vue.style.width = nw * s + "px"; vue.style.height = nh * s + "px";
      vue.style.transform = `translate(-50%,-50%) rotate(${tourne ? 90 : 0}deg)`;
    }
  }

  function fermerVue() {
    ticket++;
    if (vue) { try { vue.src = "about:blank"; } catch (x) {} vue.remove(); vue = null; }
    P.classList.remove("clavier");
    if (verrouPose) orienter(false, 0);
  }

  // 17/11 : la page montrée (cadre protégé) n'a pas le droit de verrouiller l'écran elle-même ; elle le demande ici.
  // Vrai paysage = le clavier du téléphone tourne aussi, et écrire ne remet plus en portrait.
  let verrouPose = false;
  function orienter(paysage, n) {
    let p = Promise.resolve(false);
    try {
      const o = screen.orientation;
      if (paysage && o && o.lock) p = o.lock("landscape").then(() => { verrouPose = true; return true; }, () => false);
      else if (!paysage) { verrouPose = false; if (o && o.unlock) o.unlock(); }
    } catch (x) {}
    p.then(ok => { if (n && vue && vue.contentWindow) { try { vue.contentWindow.postMessage({ nova: "montre-orientation", n, ok }, "*"); } catch (x) {} } });
  }

  async function ouvrir(p, main) {
    if (!p) return;
    const n = ++ticket;
    fermerVue(); ticket = n;
    ouvert = p; rot = null; noterVu(p.id);
    P.querySelector(".titre span").textContent = p.titre || "Nova te montre";
    P.classList.remove("liste-on", "plein", "mot-on");
    P.classList.add("vu"); requestAnimationFrame(() => P.classList.add("on"));
    rendreListe(); dire("Ça arrive…");
    let d = null;
    try {
      const r = await fetch("/api/montrer/ouvrir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
      d = r.ok ? await r.json() : null;
      if (!r.ok) return n === ticket && dire(r.status === 401 ? "Reconnecte l'appli au PC (scanne le QR code), puis réessaie." :
        r.status === 404 ? "Ce n'est plus sur le PC." : "Le PC ne répond pas.");
    } catch (x) { return n === ticket && dire("Le PC ne répond pas."); }
    if (n !== ticket || !d || typeof d.url !== "string" || !/^\/montre\/[A-Za-z0-9_-]{43}\//.test(d.url)) return;
    ouvert = Object.assign({}, p, { taille: Array.isArray(d.taille) ? d.taille : null, paysage: !!d.paysage, type: d.type });
    const src = (NA.base || "") + d.url;
    if (d.type === "image") {
      vue = document.createElement("img"); vue.className = "vue"; vue.alt = p.titre || "";
      vue.onload = () => { dire(""); disposer(); };
      vue.onerror = () => dire("L'image n'arrive pas.");
      vue.referrerPolicy = "no-referrer";
      vue.src = src;
    } else {
      vue = document.createElement("iframe");
      vue.setAttribute("sandbox", "allow-scripts allow-pointer-lock");
      vue.setAttribute("allow", "autoplay; fullscreen");
      vue.referrerPolicy = "no-referrer";
      vue.title = p.titre || "Page";
      vue.onload = () => { if (n === ticket) dire(""); };
      vue.src = src;
    }
    scene.appendChild(vue);
    disposer();
    if (main && P.requestFullscreen && false) P.requestFullscreen().catch(() => {});
  }

  function fermer() {
    fermerVue(); ouvert = null;
    P.classList.remove("on", "liste-on", "mot-on");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => { if (!ouvert) P.classList.remove("vu"); suivant(); }, 380);
  }

  function rendreListe() {
    items.innerHTML = "";
    if (!partages.length) { items.innerHTML = '<div style="padding:8px 12px;color:rgba(226,232,246,.5)">Rien pour l\'instant.</div>'; return; }
    for (const p of partages) {
      const b = document.createElement("button");
      if (ouvert && ouvert.id === p.id) b.className = "ici";
      b.textContent = p.titre || "Sans titre";
      const s = document.createElement("small"); s.textContent = (p.type === "image" ? "Image · " : "Page · ") + heure(p.t); b.appendChild(s);
      b.onclick = () => ouvrir(p, true);
      items.appendChild(b);
    }
  }

  function suivant() {   // le plus ancien pas encore vu (et récent) : Ambre, puis Myrtille…
    if (ouvert || P.classList.contains("vu")) return;
    if (document.visibilityState !== "visible") return;
    const bur = $("bur"); if (bur && bur.classList.contains("vu")) return;   // la prise en main du PC passe avant
    const vus = vusTous();
    const a = partages.filter(p => !vus.includes(p.id) && Date.now() - p.t * 1000 < RECENT).sort((x, y) => x.t - y.t)[0];
    if (a) ouvrir(a, false);
  }

  let pause = 0, enCours = false;
  async function sonder() {
    if (enCours || Date.now() < pause || document.visibilityState !== "visible") return;
    enCours = true;
    try {
      const r = await fetch("/api/montrer/liste", { cache: "no-store" });
      if (r.status === 404) { pause = Date.now() + 60000; return; }   // PC pas encore à jour : on se tait
      if (!r.ok) return;
      const d = await r.json();
      partages = Array.isArray(d.partages) ? d.partages.filter(p => p && typeof p.id === "string") : [];
      if (Array.isArray(d.vus)) {   // PC à jour : son état fait foi (sans écraser une ouverture toute fraîche pas encore notée)
        srv = { vus: d.vus.filter(x => typeof x === "string"), dernier: typeof d.dernier === "string" ? d.dernier : null, connu: true };
        if (frais && Date.now() - frais.t < 15000) { srv.vus = srv.vus.filter(x => x !== frais.id).concat(frais.id); srv.dernier = frais.id; }
      }
      poserBouton();
      const b = $("btnMontre"); if (b) b.classList.toggle("vu", partages.length > 0);
      if (P.classList.contains("liste-on")) rendreListe();
      suivant();
    } catch (x) {} finally { enCours = false; }
  }

  P.querySelector(".fermer").onclick = fermer;
  P.querySelector(".histo").onclick = () => { rendreListe(); P.classList.remove("mot-on"); P.classList.toggle("liste-on"); };
  P.querySelector(".tourner").onclick = () => {
    const r = scene.getBoundingClientRect();
    const veut = ouvert && (ouvert.paysage || (ouvert.taille && ouvert.taille[0] > ouvert.taille[1]));
    const actuel = rot === null ? (!!veut && r.width < r.height) : rot;
    rot = !actuel; disposer();
  };
  P.querySelector(".agrandir").onclick = () => {
    P.classList.add("plein"); P.classList.remove("liste-on", "mot-on");
    try { if (P.requestFullscreen && !document.fullscreenElement) P.requestFullscreen().then(() => { try { screen.orientation.lock("landscape").catch(() => {}); } catch (x) {} }).catch(() => {}); } catch (x) {}
    setTimeout(disposer, 60); setTimeout(disposer, 400);
  };
  P.querySelector(".poignee").onclick = () => { P.classList.remove("plein"); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); setTimeout(disposer, 60); setTimeout(disposer, 400); };
  P.querySelector(".r").onclick = () => { try { vue && vue.contentWindow && vue.contentWindow.postMessage({ nova: "touche", key: "r", code: "KeyR" }, "*"); } catch (x) {} };
  scene.addEventListener("click", e => { if (e.target === scene) { P.classList.remove("liste-on"); if (!zone.value.trim()) P.classList.remove("mot-on"); } });
  addEventListener("message", e => {
    if (!vue || vue.tagName !== "IFRAME" || e.source !== vue.contentWindow) return;
    const d = e.data || {};
    if (d.nova === "montre" && typeof d.orientation === "string") return orienter(d.orientation === "paysage", typeof d.n === "number" ? d.n : 0);
    if (d.nova === "montre" && d.clavier === true) P.classList.add("clavier");
  });
  addEventListener("resize", () => { disposer(); setTimeout(disposer, 250); });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) P.classList.remove("plein"); setTimeout(disposer, 60); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pause = 0; sonder(); } });

  // 2026-11-17 bouton ✎ « Écrire à Nova » (dans la barre, à côté de la croix) : un message GÉNÉRAL, sans quitter la page.
  // Il part par la même file que les messages écrits de l'appli (Sortie d'index.html : gardé dans IndexedDB, renvoyé tout
  // seul tant que le PC ne répond pas, sans doublon grâce au mid), conv « nova », avec le nom de la page en tête.
  // Secours si la file de l'appli manque : petite file locale (localStorage) renvoyée de la même façon vers /api/message.
  const mot = P.querySelector(".mot"), zone = mot.querySelector("textarea"), partir = mot.querySelector(".partir"), pastille = P.querySelector(".pastille");
  const composer = (texte, titre) => `[Écrit sur le téléphone depuis la page « ${titre || "Nova te montre"} »] ${texte}`;
  let pastT = 0;
  const annoncer = (t, ms = 2600) => { pastille.textContent = t; pastille.classList.add("vu"); clearTimeout(pastT); pastT = setTimeout(() => pastille.classList.remove("vu"), ms); };
  const garderBrouillon = t => { try { t ? localStorage.setItem("nova-montre-mot", t) : localStorage.removeItem("nova-montre-mot"); } catch (x) {} };
  const ajusterZone = () => { zone.style.height = "auto"; zone.style.height = Math.min(zone.scrollHeight + 2, innerHeight * 0.32) + "px"; partir.disabled = !zone.value.trim(); };
  function ouvrirMot() {
    mot.querySelector("h4 b").textContent = (ouvert && ouvert.titre) || "Nova te montre";
    if (!zone.value) { try { zone.value = localStorage.getItem("nova-montre-mot") || ""; } catch (x) {} }
    P.classList.remove("liste-on"); P.classList.add("mot-on"); ajusterZone();
    setTimeout(() => { try { zone.focus(); } catch (x) {} }, 40);
  }
  function fermerMot() { P.classList.remove("mot-on"); try { zone.blur(); } catch (x) {} }

  const FILE = "nova-montre-mots";   // secours seulement
  const lireFile = () => { try { return JSON.parse(localStorage.getItem(FILE) || "[]"); } catch (x) { return []; } };
  const ecrireFile = l => { try { localStorage.setItem(FILE, JSON.stringify(l.slice(-30))); } catch (x) {} };
  let videEnCours = false;
  async function viderFile() {
    if (videEnCours) return; videEnCours = true;
    try {
      for (const it of lireFile()) {
        let ok = false, net = false;
        try {
          const h = { "Content-Type": "application/json" }; if (NA.jeton) h["X-Nova-Jeton"] = NA.jeton;
          const r = await fetch("/api/message", { method: "POST", headers: h, credentials: "same-origin", body: JSON.stringify({ texte: it.texte, conv: "nova", mid: it.mid }) });
          const d = r.ok ? await r.json().catch(() => null) : null;
          ok = !!(d && d.ok);
        } catch (x) { net = true; }
        const l = lireFile(), i = l.findIndex(x => x.mid === it.mid);
        if (i < 0) continue;
        if (ok) l.splice(i, 1);
        else { l[i].essais = (l[i].essais || 0) + 1; if (l[i].essais >= 40) { l[i].perdu = true; l.splice(i, 1); } }
        ecrireFile(l);
        if (!ok && net) break;   // pas de réseau : on retentera tout plus tard, dans l'ordre
      }
    } finally { videEnCours = false; }
  }
  async function deposer(texte) {
    if (typeof Sortie !== "undefined" && Sortie && typeof Sortie.ajouter === "function") {
      try { if (sessionSeq === Infinity) sessionSeq = seq; } catch (x) {}   // comme envoyer() de l'appli : la réponse sera lue ici aussi
      const it = await Sortie.ajouter({ kind: "texte", texte, conv: "nova" });
      Sortie.vider();
      return () => !Sortie._mem.has(it.mid) && !it.annule && !((it.essais || 0) >= 20);
    }
    const mid = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    ecrireFile(lireFile().concat({ mid, texte, t: Date.now() }));
    viderFile();
    return () => !lireFile().some(x => x.mid === mid);
  }
  async function envoyerMot() {
    const texte = zone.value.trim(); if (!texte) return;
    const corps = composer(texte, ouvert && ouvert.titre);
    zone.value = ""; garderBrouillon(""); ajusterZone(); fermerMot();
    try { navigator.vibrate && navigator.vibrate(8); } catch (x) {}
    annoncer("Envoi à Nova…", 9000);
    let recu;
    try { recu = await deposer(corps); } catch (x) { zone.value = texte; garderBrouillon(texte); return annoncer("Pas pu garder le message : réessaie.", 4000); }
    const debut = Date.now(); let prevenu = false;
    const t = setInterval(() => {
      if (recu()) { clearInterval(t); return annoncer("✓ Reçu par Nova", 2400); }
      if (!prevenu && Date.now() - debut > 6000) { prevenu = true; annoncer("Le PC ne répond pas encore : ton message est gardé, il partira tout seul.", 5000); }
      if (Date.now() - debut > 15 * 60000) clearInterval(t);
    }, 600);
  }
  P.querySelector(".ecrire").onclick = () => P.classList.contains("mot-on") ? fermerMot() : ouvrirMot();
  mot.querySelector(".laisser").onclick = fermerMot;
  partir.onclick = envoyerMot;
  zone.addEventListener("input", () => { ajusterZone(); garderBrouillon(zone.value); });
  zone.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); envoyerMot(); } else if (e.key === "Escape") fermerMot(); });
  setInterval(() => { if (lireFile().length && document.visibilityState === "visible") viderFile(); }, 8000);
  addEventListener("online", () => setTimeout(viderFile, 1200));
  if (lireFile().length) setTimeout(viderFile, 4000);

  window.NovaMontrer = { ouvrir: id => ouvrir(partages.find(p => p.id === id), true), ouvrirPartage: p => ouvrir(p, true), fermer, sonder, _etat: () => ({ partages, ouvert, rot, srv }), _choisir: choisirBouton,
    ecrire: ouvrirMot, _composer: composer, _fileMots: lireFile };
  poserBouton();
  setTimeout(sonder, 1500);
  setInterval(sonder, 4000);
})();
