// 2026-11-07 gemini vidéo : le mode « Vidéo » de Nova sur le téléphone (Gemini Live API).
// Caméra arrière + micro -> WebSocket Live (jeton ÉPHÉMÈRE donné par le PC, jamais la clé) -> voix de Gemini.
// Outil envoyer_au_pc(message) : le message part sur /api/gemini-envoi (PC), préfixé « [Depuis Gemini vidéo] ».
// Format des messages : doc Google du 2026-11-07 (setup, realtimeInput.audio/video, serverContent, toolCall, toolResponse).
(function () {
  "use strict";
  if (window.NovaVideo) return;
  const $ = id => document.getElementById(id);
  const INSTRUCTIONS =
    "Tu es Nova, l'assistant vocal de l'utilisateur. Tu vois sa caméra en direct et tu l'entends. " +
    "Parle toujours en français, naturel, très court : une ou deux phrases, jamais de listes. " +
    "Quand il te montre un objet (un appareil, un vidéoprojecteur, une étiquette), décris ce que tu vois vraiment, lis les inscriptions " +
    "et étiquettes visibles, cherche la marque et le modèle exacts, et dis ton niveau de certitude. Si tu n'es pas sûre, demande-lui de " +
    "rapprocher la caméra, d'éclairer ou de montrer l'étiquette. N'invente jamais un modèle. " +
    "Quand il dit « envoie au gros PC », « envoie ça au PC » ou équivalent, appelle l'outil envoyer_au_pc avec un message complet et " +
    "autonome (ce que c'est, marque, modèle exact, détails utiles, ce qu'il demande), puis confirme en quelques mots.";
  const OUTILS = [{ functionDeclarations: [{
    name: "envoyer_au_pc",
    description: "Envoie un message à la Nova du gros PC de l'utilisateur (qui peut agir). À utiliser quand il demande d'envoyer ou de transmettre quelque chose au PC.",
    parameters: { type: "OBJECT", properties: { message: { type: "STRING", description: "Le message complet et autonome pour la Nova du PC, en français." } }, required: ["message"] },
  }] }];

  const S = { phase: "repos", ws: null, flux: null, ctxIn: null, ctxOut: null, noeud: null, gain: null, ana: null, minuterie: 0,
    tNext: 0, sources: new Set(), nvMic: 0, nvVoix: 0, tentative: 0, pret: false, stats: { images: 0, audio: 0, recu: 0, outils: 0, envois: 0 },
    toi: "", nova: "", dernierEtat: "", raf: 0, erreur: "" };

  // ---------- l'habillage : bouton + écran ----------
  const css = document.createElement("style");
  css.textContent = `
#btnVideo { display:flex; align-items:center; gap:6px; padding:7px 12px 7px 9px; border-radius:999px; font-size:13px; color:var(--txt2,#aab); border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); }
#btnVideo svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
#btnVideo:active { transform:scale(.96); }
#vid { position:fixed; inset:0; z-index:2147483500; display:none; flex-direction:column; background:#02030a; color:var(--txt,#dfe6f6); font-family:var(--sans,system-ui,sans-serif); }
#vid.vu { display:flex; }
#vid video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:.5; filter:saturate(.85); }
#vid .voile { position:absolute; inset:0; background:radial-gradient(90% 60% at 50% 38%, rgba(2,3,10,.15), rgba(2,3,10,.82) 80%); }
#vid .haut { position:relative; z-index:2; display:flex; align-items:center; gap:10px; padding:calc(14px + env(safe-area-inset-top,0px)) 18px 0; }
#vid .lbl { font:500 10.5px/1.2 var(--mono,ui-monospace,monospace); letter-spacing:.24em; text-transform:uppercase; color:rgba(226,232,246,.6); }
#vid .point { width:8px; height:8px; border-radius:50%; background:#e9d6a8; box-shadow:0 0 10px #e9d6a8; }
#vid.parle .point { background:#f3a6d0; box-shadow:0 0 10px #f3a6d0; }
#vid.err .point { background:#ff8f86; box-shadow:0 0 10px #ff8f86; }
#vid .centre { position:relative; z-index:2; flex:1; display:grid; place-items:center; min-height:0; }
#vid canvas { width:min(64vw,42vh,300px); height:min(64vw,42vh,300px); }
#vid .textes { position:relative; z-index:2; padding:0 24px 8px; min-height:104px; text-align:center; }
#vidToi { font-size:13px; color:rgba(226,232,246,.5); margin-bottom:6px; min-height:17px; }
#vidNova { font-size:18px; line-height:1.35; color:#f4ecd8; min-height:50px; }
#vid .bas { position:relative; z-index:2; display:flex; justify-content:center; align-items:center; gap:14px; padding:6px 24px calc(30px + env(safe-area-inset-bottom,0px)); }
#vidStop { padding:15px 34px; border-radius:999px; font-size:15px; color:#02030a; background:#e9d6a8; box-shadow:0 0 28px rgba(233,214,168,.3); }
#vidPC { padding:14px 18px; border-radius:999px; font-size:14px; color:rgba(226,232,246,.85); border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); }
`;
  document.head.appendChild(css);

  function monter() {
    if ($("btnVideo")) return;
    const b = document.createElement("button");
    b.id = "btnVideo"; b.setAttribute("aria-label", "Mode vidéo avec Gemini");
    b.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5l5-2.7v8.4l-5-2.7"/></svg><span>Vidéo</span>';
    const ref = $("btnLibre"), tete = document.querySelector("header");
    if (ref && ref.parentNode) ref.parentNode.insertBefore(b, ref); else if (tete) tete.appendChild(b); else document.body.appendChild(b);
    b.onclick = () => demarrer();
    const o = document.createElement("div");
    o.id = "vid"; o.setAttribute("role", "dialog"); o.setAttribute("aria-label", "Nova vidéo");
    o.innerHTML = '<video id="vidCam" playsinline muted autoplay></video><div class="voile"></div>' +
      '<div class="haut"><i class="point"></i><span class="lbl" id="vidEtat">Vidéo</span></div>' +
      '<div class="centre"><canvas id="vidOrbe" width="600" height="600"></canvas></div>' +
      '<div class="textes"><div id="vidToi"></div><div id="vidNova"></div></div>' +
      '<div class="bas"><button id="vidPC">Envoyer au PC</button><button id="vidStop">Couper</button></div>';
    document.body.appendChild(o);
    $("vidStop").onclick = () => arreter();
    $("vidPC").onclick = () => envoyerAuPC("Résume au PC ce que tu as vu et trouvé jusqu'ici.", true);
  }

  function etat(t, classe) {
    S.dernierEtat = t; const e = $("vidEtat"); if (e) e.textContent = t;
    const o = $("vid"); if (o) { o.classList.toggle("parle", classe === "parle"); o.classList.toggle("err", classe === "err"); }
  }
  function sousTitres() { const a = $("vidToi"), b = $("vidNova"); if (a) a.textContent = S.toi.slice(-140); if (b) b.textContent = S.nova.slice(-220); }
  const toast = t => { try { if (typeof window.toast === "function") window.toast(t); } catch (x) {} };

  // ---------- l'orbe (canvas) : or quand il écoute, rose quand Nova parle ----------
  function dessiner() {
    const cv = $("vidOrbe"); if (!cv) return;
    const x = cv.getContext("2d"), w = cv.width, c = w / 2;
    S.nvMic *= 0.88; S.nvVoix *= 0.9;
    if (S.ana) { const d = new Uint8Array(S.ana.fftSize); S.ana.getByteTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); S.nvVoix = Math.max(S.nvVoix, m / 90); }
    const parle = S.nvVoix > 0.05, n = Math.min(1, parle ? S.nvVoix : S.nvMic * 4), t = performance.now() / 1000;
    const [r, g, b] = parle ? [243, 166, 208] : [233, 214, 168];
    x.clearRect(0, 0, w, w);
    const R = w * (0.2 + n * 0.07 + Math.sin(t * 1.6) * 0.008);
    const halo = x.createRadialGradient(c, c, R * 0.5, c, c, w * 0.5);
    halo.addColorStop(0, `rgba(${r},${g},${b},${0.22 + n * 0.3})`); halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = halo; x.fillRect(0, 0, w, w);
    const cor = x.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R);
    cor.addColorStop(0, "rgba(255,255,255,.95)"); cor.addColorStop(0.35, `rgba(${r},${g},${b},.85)`); cor.addColorStop(1, `rgba(${r},${g},${b},.12)`);
    x.fillStyle = cor; x.beginPath(); x.arc(c, c, R, 0, 7); x.fill();
    x.strokeStyle = `rgba(${r},${g},${b},.4)`; x.lineWidth = 2;
    for (let i = 0; i < 2; i++) { x.beginPath(); x.arc(c, c, R * (1.35 + i * 0.28) + n * 18 * (i + 1) + Math.sin(t * 2 + i) * 4, 0, 7); x.globalAlpha = 0.5 - i * 0.2; x.stroke(); }
    x.globalAlpha = 1;
    S.raf = requestAnimationFrame(dessiner);
  }

  // ---------- outils ----------
  const b64 = buf => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const deB64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const entetes = () => { const h = { "Content-Type": "application/json" }; try { if (window.NovaAppli && NovaAppli.jeton) h["X-Nova-Jeton"] = NovaAppli.jeton; } catch (x) {} return h; };
  async function appeler(chemin, corps) {
    const r = await fetch(chemin, { method: corps === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", headers: entetes(), body: corps === undefined ? undefined : JSON.stringify(corps) });
    let d = {}; try { d = await r.json(); } catch (x) {}
    if (!r.ok) throw new Error(d.erreur || ("Erreur " + r.status));
    return d;
  }

  async function envoyerAuPC(message, depuisBouton) {
    S.stats.envois++;
    if (depuisBouton && S.ws && S.ws.readyState === 1) {   // le bouton demande à Gemini de formuler le message (il appelle l'outil)
      S.ws.send(JSON.stringify({ realtimeInput: { text: "Envoie au gros PC un résumé de ce que tu as vu et trouvé." } }));
      return { ok: true };
    }
    return appeler("/api/gemini-envoi", { message: String(message || "").slice(0, 3500) });
  }

  // ---------- la voix de Gemini : PCM 24 kHz ----------
  function jouer(b64pcm) {
    if (!S.ctxOut) return;
    const i16 = new Int16Array(deB64(b64pcm)), f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    const buf = S.ctxOut.createBuffer(1, f.length, 24000); buf.copyToChannel(f, 0);
    const src = S.ctxOut.createBufferSource(); src.buffer = buf; src.connect(S.gain);
    const t = Math.max(S.ctxOut.currentTime + 0.03, S.tNext); src.start(t); S.tNext = t + buf.duration;
    S.sources.add(src); src.onended = () => { S.sources.delete(src); if (!S.sources.size && S.phase === "actif") etat("Je te vois et je t'écoute"); };
    etat("Nova parle", "parle"); S.stats.recu++;
  }
  function couperVoix() { for (const s of S.sources) { try { s.stop(); } catch (x) {} } S.sources.clear(); S.tNext = 0; }

  // ---------- le micro : AudioWorklet -> PCM 16 kHz ----------
  const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.pos=0;this.acc=0;this.cnt=0;this.o=new Int16Array(1600);this.k=0;}
process(i){const c=i[0]&&i[0][0];if(!c)return true;let s=0;for(let j=0;j<c.length;j++){const x=c[j];s+=x*x;this.acc+=x;this.cnt++;this.pos+=1;
if(this.pos>=this.r){const v=Math.max(-1,Math.min(1,this.acc/this.cnt));this.o[this.k++]=v<0?v*32768:v*32767;this.pos-=this.r;this.acc=0;this.cnt=0;
if(this.k===1600){const b=this.o.buffer.slice(0);this.port.postMessage({pcm:b,nv:Math.sqrt(s/c.length)},[b]);this.k=0;}}}return true;}}
registerProcessor("nova-pcm",P);`;
  async function brancherMicro() {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await S.ctxIn.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const src = S.ctxIn.createMediaStreamSource(new MediaStream(S.flux.getAudioTracks()));
    S.noeud = new AudioWorkletNode(S.ctxIn, "nova-pcm");
    S.noeud.port.onmessage = e => {
      S.nvMic = Math.max(S.nvMic, e.data.nv || 0);
      if (!S.pret || !S.ws || S.ws.readyState !== 1) return;
      S.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(e.data.pcm), mimeType: "audio/pcm;rate=16000" } } })); S.stats.audio++;
    };
    src.connect(S.noeud);   // pas relié à la sortie : on ne s'entend pas
  }

  // ---------- la caméra : une image JPEG par seconde au plus ----------
  function envoyerImage() {
    const v = $("vidCam"); if (!S.pret || !S.ws || S.ws.readyState !== 1 || !v || !v.videoWidth) return;
    if (S.ws.bufferedAmount > 400000) return;
    const k = Math.min(1, 768 / v.videoWidth), cv = S.cvImg || (S.cvImg = document.createElement("canvas"));
    cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
    cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
    cv.toBlob(bl => {
      if (!bl || !S.ws || S.ws.readyState !== 1) return;
      bl.arrayBuffer().then(ab => { if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify({ realtimeInput: { video: { data: b64(ab), mimeType: "image/jpeg" } } })); S.stats.images++; } });
    }, "image/jpeg", 0.7);
  }

  // ---------- la session Live ----------
  function setup(modele, variante) {
    const base = { model: "models/" + String(modele).replace(/^models\//, ""),
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] }, tools: OUTILS, inputAudioTranscription: {}, outputAudioTranscription: {} };
    if (variante === 0) base.generationConfig = { responseModalities: ["AUDIO"] };   // forme « classique » de la référence
    else base.responseModalities = ["AUDIO"];                                         // forme à plat montrée par le guide WebSocket
    return { setup: base };
  }

  async function ouvrirSession(variante) {
    etat("Connexion…");
    const j = await appeler("/api/gemini-jeton", {});
    return new Promise((ok, ko) => {
      let vu = false;
      const ws = new WebSocket(j.url + (j.url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(j.token));
      S.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(setup(j.modele, variante)));
      ws.onmessage = async ev => {
        let t = ev.data; if (t instanceof Blob) t = await t.text(); else if (t instanceof ArrayBuffer) t = new TextDecoder().decode(t);
        let m; try { m = JSON.parse(t); } catch (x) { return; }
        if (m.setupComplete !== undefined && !vu) { vu = true; S.pret = true; ok(); }
        recevoir(m);
      };
      ws.onerror = () => {};
      ws.onclose = ev => {
        S.pret = false;
        if (!vu) ko(Object.assign(new Error("La session Gemini s'est fermée (" + ev.code + ") " + (ev.reason || "").slice(0, 120)), { ferme: true }));
        else if (S.phase === "actif") { S.erreur = ev.reason || ""; etat("Session terminée", "err"); toast("La session Gemini est terminée."); setTimeout(() => arreter(), 1800); }
      };
    });
  }

  function recevoir(m) {
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) couperVoix();
      if (sc.modelTurn && sc.modelTurn.parts) for (const p of sc.modelTurn.parts) if (p.inlineData && p.inlineData.data) jouer(p.inlineData.data);
      if (sc.inputTranscription && sc.inputTranscription.text) { if (S.finTour) { S.toi = ""; S.nova = ""; S.finTour = false; } S.toi += sc.inputTranscription.text; sousTitres(); }
      if (sc.outputTranscription && sc.outputTranscription.text) { if (S.finTour) { S.toi = ""; S.nova = ""; S.finTour = false; } S.nova += sc.outputTranscription.text; sousTitres(); }
      if (sc.turnComplete) S.finTour = true;
    }
    if (m.toolCall && m.toolCall.functionCalls) {
      for (const fc of m.toolCall.functionCalls) {
        S.stats.outils++;
        const rep = r => S.ws && S.ws.readyState === 1 && S.ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: fc.id, name: fc.name, response: r }] } }));
        if (fc.name !== "envoyer_au_pc") { rep({ error: "outil inconnu" }); continue; }
        appeler("/api/gemini-envoi", { message: String((fc.args && fc.args.message) || "").slice(0, 3500) })
          .then(r => { if (r.ok) { rep({ result: "Message transmis à la Nova du PC." }); toast("Envoyé au PC."); } else rep({ error: r.erreur || "échec" }); })
          .catch(e => rep({ error: String(e.message || e) }));
      }
    }
    if (m.goAway) toast("Gemini va couper la session bientôt.");
  }

  async function demarrer() {
    if (S.phase !== "repos") return;
    S.phase = "demarrage"; S.erreur = ""; S.toi = ""; S.nova = ""; S.finTour = false; S.stats = { images: 0, audio: 0, recu: 0, outils: 0, envois: 0 };
    monter(); $("vid").classList.add("vu"); sousTitres(); etat("Connexion…");
    try {   // une seule écoute du micro à la fois : on coupe les mains libres de la page
      const l = $("btnLibre"); if (l && l.getAttribute("aria-pressed") === "true") l.click();
    } catch (x) {}
    const AC = window.AudioContext || window.webkitAudioContext;
    S.ctxIn = new AC(); S.ctxOut = new AC({ sampleRate: 24000 });   // créés dans le geste de l'utilisateur
    S.gain = S.ctxOut.createGain(); S.ana = S.ctxOut.createAnalyser(); S.ana.fftSize = 512;
    S.gain.connect(S.ana); S.ana.connect(S.ctxOut.destination);
    try { await S.ctxIn.resume(); await S.ctxOut.resume(); } catch (x) {}
    try { if (window.NovaAppli && NovaAppli.garderEcran) NovaAppli.garderEcran(true); } catch (x) {}
    try {
      S.flux = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const v = $("vidCam"); v.srcObject = S.flux; try { await v.play(); } catch (x) {}
      await brancherMicro();
      try { await ouvrirSession(0); }
      catch (e) { if (!e.ferme || S.phase !== "demarrage") throw e; await ouvrirSession(1); }   // 2e forme du setup avec un nouveau jeton
      S.phase = "actif"; etat("Je te vois et je t'écoute");
      S.minuterie = setInterval(envoyerImage, 1000); envoyerImage();
      cancelAnimationFrame(S.raf); dessiner();
    } catch (e) {
      const msg = e && e.name === "NotAllowedError" ? "Caméra ou micro refusés : autorise-les dans Chrome." : (e && e.message) || "Erreur";
      S.erreur = msg; etat(msg.slice(0, 80), "err"); toast(msg, 6000);
      S.phase = "echec"; setTimeout(() => { if (S.phase === "echec") arreter(); }, 4500);
    }
    if (S.phase === "actif" || S.phase === "echec") { cancelAnimationFrame(S.raf); dessiner(); }
  }

  function arreter() {
    clearInterval(S.minuterie); cancelAnimationFrame(S.raf); couperVoix();
    try { if (S.ws) { S.ws.onclose = null; S.ws.close(); } } catch (x) {}
    try { if (S.flux) S.flux.getTracks().forEach(t => t.stop()); } catch (x) {}
    try { if (S.noeud) S.noeud.disconnect(); } catch (x) {}
    try { S.ctxIn && S.ctxIn.close(); S.ctxOut && S.ctxOut.close(); } catch (x) {}
    try { if (window.NovaAppli && NovaAppli.garderEcran) NovaAppli.garderEcran(false); } catch (x) {}
    const v = $("vidCam"); if (v) v.srcObject = null;
    const o = $("vid"); if (o) o.classList.remove("vu");
    S.ws = S.flux = S.ctxIn = S.ctxOut = S.noeud = S.ana = S.gain = null; S.pret = false; S.phase = "repos";
  }

  window.NovaVideo = { demarrer, arreter, etat: () => JSON.parse(JSON.stringify({ phase: S.phase, etat: S.dernierEtat, toi: S.toi, nova: S.nova, stats: S.stats, erreur: S.erreur })) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", monter); else monter();
})();
