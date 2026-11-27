// Cartable, interface : la page « Partition » (photo de partition lue automatiquement, rendue proprement, jouée au piano).
// La partition vit dans une feuille photo : feuille.propre.partition = { sha, mime, mesures, notes, confiance, verif, titre }.
// Le MusicXML est un blob du noyau (même synchro que les images). L'original (la photo) reste à un bouton : « Original / Partition ».
// Rendu : Verovio (hors ligne, vendor/verovio). Son : piano à queue Salamander (piano/, 20 notes), lookahead WebAudio.
"use strict";
(function (C) {
  const U = C.U, S = C.sons;
  const P = C.partition = {};
  const SVGNS = "http://www.w3.org/2000/svg";
  const ICONES = {
    lire: '<path d="M8 5.5v13l11-6.5z"/>', pause: '<path d="M8 5.5v13M16 5.5v13"/>', debut: '<path d="M6 5.5v13M18 6l-9 6 9 6z"/>',
    photo: '<path d="M4 7h3l1.5-2h7L17 7h3v12H4zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"/>',
    note: '<path d="M9 17.5V5.5l9-2v12M9 17.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM18 15.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>',
    fermer: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>', moins: '<path d="M5 12h14"/>',
    export: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>', livre: '<path d="M4 5.5C7 4 9.5 4.3 12 6c2.5-1.7 5-2 8-.5v13c-3-1.5-5.5-1.2-8 .5-2.5-1.7-5-2-8-.5z"/><path d="M12 6v13"/>',
    faute: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5v.2"/>', verif: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  const ico = (n) => '<svg viewBox="0 0 24 24">' + (ICONES[n] || "") + "</svg>";

  // ------------------------------------------------------------ la page (construite à la demande)
  let el = null, rendu = null, zoneOriginal = null, imgOriginal = null, feuilleP = null, barre = null, transport = null;
  let cur = null;                         // curseur vertical
  function construire() {
    if (el) return;
    el = U.el("div", "", document.body); el.id = "partition"; el.hidden = true;
    el.innerHTML =
      '<div class="voile"></div>' +
      '<div class="scene"><div class="feuille-p"><div class="rendu"><div class="attente"><i></i><span>Je prépare la partition…</span></div></div>' +
      '<div class="original" hidden><img alt="Photo d\'origine"></div></div></div>' +
      '<div class="bascule" role="group" aria-label="Original ou partition"><i class="glisse"></i>' +
      '<button data-voir="original" aria-pressed="false" title="Voir la photo d\'origine (P)">' + ico("photo") + "<span>Original</span></button>" +
      '<button data-voir="partition" aria-pressed="true" title="Voir la partition (P)">' + ico("note") + "<span>Partition</span></button><kbd>P</kbd></div>" +
      '<div class="haut"><div class="titre"></div><div class="sceau" hidden></div></div>' +
      '<div class="actions">' +
      '<button data-a="apprendre" title="Ouvrir dans l\'appli d\'apprentissage">' + ico("livre") + "<span>Apprendre</span></button>" +
      '<button data-a="musicxml" title="Exporter en MusicXML">' + ico("export") + "<span>MusicXML</span></button>" +
      '<button data-a="midi" title="Exporter en MIDI">' + ico("export") + "<span>MIDI</span></button>" +
      '<button data-a="faute" title="Signaler une faute de lecture">' + ico("faute") + "<span>Une faute ?</span></button></div>" +
      '<button class="fermer" title="Reposer la partition (Échap)">' + ico("fermer") + "</button>" +
      '<div class="transport">' +
      '<button class="gros" data-t="lire" title="Lire (Espace)">' + ico("lire") + "</button>" +
      '<button data-t="debut" title="Depuis le début">' + ico("debut") + "</button>" +
      '<div class="bloc tempo"><button data-t="moins" title="Plus lent">' + ico("moins") + '</button><span class="val" title="Tempo (noires par minute)">♩ = 90</span><button data-t="plus" title="Plus vite">' + ico("plus") + "</button></div>" +
      '<div class="bloc mains" role="group" aria-label="Mains"></div>' +
      '<div class="bloc zoom"><button data-t="zmoins" title="Plus petit"><b>A</b></button><button data-t="zplus" title="Plus grand"><b class="g">A</b></button></div>' +
      '<span class="pos"></span></div>';
    feuilleP = el.querySelector(".feuille-p"); rendu = el.querySelector(".rendu"); zoneOriginal = el.querySelector(".original"); imgOriginal = zoneOriginal.querySelector("img");
    barre = el.querySelector(".bascule"); transport = el.querySelector(".transport");
    el.querySelector(".fermer").addEventListener("click", () => P.fermer("bouton"));
    el.querySelector(".voile").addEventListener("click", () => P.fermer("voile"));
    barre.addEventListener("click", (e) => { const b = e.target.closest("button[data-voir]"); if (b) voir(b.dataset.voir); });
    el.querySelector(".actions").addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (b) action(b.dataset.a); });
    transport.addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) commande(b.dataset.t); });
    rendu.addEventListener("click", cliquerPartition);
    addEventListener("keydown", (e) => {
      if (!ouvert) return;
      if (e.key === "Escape") { e.preventDefault(); P.fermer(); }
      else if (e.key === " ") { e.preventDefault(); commande("lire"); }
      else if ((e.key === "p" || e.key === "P") && !(opt && opt.versions)) voir(mode === "original" ? "partition" : "original");
    });
    addEventListener("resize", () => { if (ouvert && mode === "partition") planifierMiseEnPage(); });
  }

  // ------------------------------------------------------------ Verovio
  let tk = null, chargement = null;
  function chargerVerovio() {
    if (tk) return Promise.resolve(tk);
    if (chargement) return chargement;
    chargement = new Promise((ok, ko) => {
      const fin = () => {
        let essais = 0;
        const t = setInterval(() => {
          try { tk = new window.verovio.toolkit(); clearInterval(t); ok(tk); } catch (e) { if (++essais > 400) { clearInterval(t); chargement = null; ko(new Error("Verovio ne démarre pas")); } }
        }, 25);
      };
      if (window.verovio) return fin();
      const s = document.createElement("script"); s.src = "vendor/verovio/verovio-toolkit-wasm.js"; s.onload = fin;
      s.onerror = () => { chargement = null; ko(new Error("Verovio introuvable")); };
      document.head.appendChild(s);
    });
    return chargement;
  }

  // ------------------------------------------------------------ état d'une page ouverte
  let ouvert = false, page = null, opt = null, xml = "", mode = "partition", echelle = 45, eventsNotes = [], timemap = [], mesuresPos = [];
  let nStaves = 0, mainsActives = new Set(), bpmBase = 90, facteur = 1, miseEnPage = 0, idVersIndex = new Map();
  let aEteOuverte = 0, interpretation = null;
  P.ouvert = () => ouvert;
  P.estPartition = (p) => !!(p && p.propre && p.propre.partition && (p.propre.partition.sha || p.propre.partition.xml));
  P.etat = () => ({ ouvert, mode, notes: eventsNotes.length, mesures: mesuresPos.length, bpm: Math.round(bpmBase * facteur), staves: nStaves, lecture: lecture.etat, echelle });

  async function lireXml(pr) {
    if (typeof pr.xml === "string" && pr.xml) return pr.xml;                        // essais, sans noyau
    const n = window.cartableNoyau;
    if (!n || !pr.sha) return "";
    for (let i = 0; i < 30; i++) {                                                  // l'octet peut arriver de la synchro : on attend un peu
      const b = await n.image(pr.sha);
      if (b && b.octets) return new TextDecoder("utf-8").decode(b.octets);
      await new Promise((r) => setTimeout(r, 300));
    }
    return "";
  }

  // ouvrir(page, rectDe, options) comme Cartable.feuille.ouvrir ; rend true si c'est une partition (et alors la feuille normale ne s'ouvre pas)
  P.ouvrir = function (p, rectDe, options) {
    if (!P.estPartition(p)) return false;
    if (ouvert) return true;
    construire();
    page = p; opt = options || {}; ouvert = true;
    el.classList.toggle("en-versions", !!opt.versions);                       // chanson à plusieurs versions : la pastille des versions remplace Original / Partition
    el.hidden = false; el.classList.remove("la");
    charger(p);
    void el.offsetWidth; el.classList.add("la");
    if (S && S.jouer) S.jouer("feuille");
    return true;
  };
  // une autre partition dans la page déjà ouverte (versions d'une chanson : piano + chant, chant, piano), sans la fermer
  P.changer = function (p, options) {
    if (!P.estPartition(p)) return false;
    if (!ouvert) return P.ouvrir(p, null, options);
    arreterLecture(true);
    page = p; if (options) opt = options;
    el.classList.toggle("en-versions", !!opt.versions);
    charger(p);
    return true;
  };
  function charger(p) {
    mode = "partition"; xml = ""; eventsNotes = []; timemap = []; interpretation = null;
    const pr = p.propre.partition;
    el.querySelector(".titre").textContent = p.titre || pr.titre || "Partition";
    majSceau(pr);
    el.classList.add("charge");
    rendu.innerHTML = '<div class="attente"><i></i><span>Je prépare la partition…</span></div>';
    voir("partition", true);
    if (typeof p.image === "string" && p.image) imgOriginal.src = p.image; else imgOriginal.removeAttribute("src");
    const id = ++aEteOuverte;
    Promise.all([chargerVerovio(), lireXml(pr)]).then(([t, x]) => {
      if (id !== aEteOuverte || !ouvert) return;
      if (!x) { rendu.innerHTML = '<div class="attente erreur"><span>La partition n’est pas encore arrivée sur cet appareil. Réessaie dans un instant.</span></div>'; return; }
      xml = x; feuilleP.scrollTop = 0; mettreEnPage(true);
    }).catch((e) => { rendu.innerHTML = '<div class="attente erreur"><span>Je n’arrive pas à afficher la partition (' + String(e && e.message || e).slice(0, 80) + ").</span></div>"; });
  }
  P.fermer = function (raison) {
    if (!ouvert) return;
    arreterLecture(true);
    ouvert = false; aEteOuverte++;
    el.classList.remove("la");
    const p = page, o = opt;
    setTimeout(() => { if (!ouvert) { el.hidden = true; rendu.innerHTML = ""; } }, 260);
    try { if (o && o.avantRetour) o.avantRetour(p, false); } catch (e) { /* rien */ }
    try { if (o && o.fini) o.fini(p, false, raison || ""); } catch (e) { console.error(e); }
  };

  function majSceau(pr) {
    const s = el.querySelector(".sceau");
    const v = pr.verif || {};
    let t = "", cl = "";
    if (v.etat === "verifie") { t = "Vérifiée" + (v.corrections ? " · " + v.corrections + " correction" + (v.corrections > 1 ? "s" : "") : ""); cl = "bon"; }
    else if (v.etat === "attente") { t = "Vérification en cours"; cl = "att"; }
    else if (v.etat === "sautee") { t = "Lecture automatique"; cl = "auto"; }
    else if (typeof pr.confiance === "number" && pr.confiance < 0.6) { t = "À vérifier"; cl = "att"; }
    s.hidden = !t; s.textContent = t; s.className = "sceau " + cl;
  }

  function voir(quoi, instant) {
    mode = quoi;
    barre.classList.toggle("propre", quoi === "partition");
    for (const b of barre.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.voir === quoi));
    zoneOriginal.hidden = quoi !== "original";
    rendu.hidden = quoi === "original";
    el.classList.toggle("vue-original", quoi === "original");
    if (quoi === "original") { arreterLecture(false); feuilleP.scrollTop = 0; }
    else if (xml && !instant) { feuilleP.scrollTop = 0; }
  }

  // ------------------------------------------------------------ mise en page (Verovio)
  function planifierMiseEnPage() { clearTimeout(miseEnPage); miseEnPage = setTimeout(() => mettreEnPage(false), 220); }
  function mettreEnPage(premiere) {
    if (!tk || !xml || !ouvert) return;
    const sup = feuilleP.scrollTop, hauteurAvant = feuilleP.scrollHeight;
    const L = Math.max(280, feuilleP.clientWidth - 24);                               // largeur utile en pixels
    const pageWidth = Math.round(U.borne(L * 3.1, 1100, 2900));
    tk.setOptions({ pageWidth, pageHeight: 60000, scale: echelle, adjustPageHeight: true, svgViewBox: true, breaks: (page && page.propre && page.propre.partition && page.propre.partition.mode === "exercices") ? "encoded" : "auto", header: "auto", footer: "none",
      pageMarginLeft: 40, pageMarginRight: 40, pageMarginTop: modeExercices() ? 110 : 60, spacingSystem: modeExercices() ? 22 : 12, pageMarginBottom: 50, svgRemoveXlink: true, svgFontFaceInclude: true, mnumInterval: 1, justifyVertically: false });
    try { tk.loadData(xml); } catch (e) { rendu.innerHTML = '<div class="attente erreur"><span>Cette partition est illisible.</span></div>'; return; }
    let svg = "";
    const n = Math.max(1, tk.getPageCount());
    // la police musicale (dièses des accords, note du tempo) une seule fois : sinon ces signes sortent en carrés vides
    for (let i = 1; i <= n; i++) { const p = tk.renderToSVG(i); svg += i === 1 ? p : p.replace(/@font-face\s*\{[^}]*\}/g, ""); }
    rendu.innerHTML = svg;
    rendu.classList.remove("attente");
    cur = U.el("div", "curseur", rendu); cur.hidden = true;
    preparerLecture();
    if (!premiere && hauteurAvant > 0) feuilleP.scrollTop = sup * (feuilleP.scrollHeight / hauteurAvant);
  }

  // ------------------------------------------------------------ extraction des notes (timemap Verovio) et des portées
  function preparerLecture() {
    arreterLecture(true);
    eventsNotes = []; idVersIndex = new Map(); mesuresPos = [];
    try { timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: false }) || []; } catch (e) { timemap = []; }
    const svg = rendu.querySelector("svg");
    const staffDe = new Map(), miDe = new Map();
    let maxStaff = 0;
    if (svg) [...svg.querySelectorAll("g.measure")].forEach((mes, mi) => {
      for (const nt of mes.querySelectorAll("g.note")) miDe.set(nt.id, mi);
      const portees = [...mes.querySelectorAll(":scope > g.staff")];
      portees.forEach((st, k) => { for (const nt of st.querySelectorAll("g.note")) staffDe.set(nt.id, k); maxStaff = Math.max(maxStaff, k); });
    });
    nStaves = maxStaff + 1;
    const ouverts = new Map();
    let mesure = -1;
    for (const e of timemap) {
      if (e.measureOn) { mesure++; mesuresPos.push({ t: e.tstamp, id: e.measureOn }); }
      for (const id of e.off || []) { const o = ouverts.get(id); if (o) { o.fin = e.tstamp; ouverts.delete(id); } }
      for (const id of e.on || []) {
        let pitch = null;
        try { const v = tk.getMIDIValuesForElement(id); pitch = v && typeof v.pitch === "number" ? v.pitch : null; } catch (x) { pitch = null; }
        if (pitch === null) continue;
        const o = { id, t: e.tstamp, fin: e.tstamp + 400, midi: pitch, staff: staffDe.has(id) ? staffDe.get(id) : 0, mesure: Math.max(0, mesure), mi: miDe.has(id) ? miDe.get(id) : 0 };
        ouverts.set(id, o); eventsNotes.push(o);
      }
    }
    eventsNotes.sort((a, b) => a.t - b.t);
    eventsNotes.forEach((o, i) => idVersIndex.set(o.id, i));
    // tempo de base : celui de la partition si elle en donne un, sinon une allure calme et lisible
    const tp = timemap.find((e) => e.tempo);
    bpmBase = tp && tp.tempo ? Math.round(tp.tempo) : 120;
    if (!(pageTempoDonne(timemap))) { facteur = 90 / bpmBase; }                       // sans indication : noire = 90
    interpreter();
    majTempo(); majMains(); majPos(0); poserSections();
  }
  const pageTempoDonne = () => /<sound[^>]*tempo=|<metronome/.test(xml);

  function majMains() {
    const bloc = transport.querySelector(".mains");
    bloc.innerHTML = "";
    mainsActives = new Set(Array.from({ length: nStaves }, (_, i) => i));
    if (nStaves < 2) { bloc.hidden = true; return; }
    bloc.hidden = false;
    const noms = nStaves === 2 ? ["Main droite", "Main gauche"] : Array.from({ length: nStaves }, (_, i) => "Portée " + (i + 1));
    const tout = U.el("button", "chip actif", bloc); tout.textContent = nStaves === 2 ? "Deux mains" : "Toutes"; tout.dataset.m = "tout";
    noms.forEach((n, i) => { const b = U.el("button", "chip", bloc); b.textContent = n; b.dataset.m = String(i); });
    bloc.onclick = (e) => {
      const b = e.target.closest("button[data-m]"); if (!b) return;
      // une main / une portée seule (les autres se taisent), ou « tout » : on entend le reste en lisant la couleur de la barre
      mainsActives = b.dataset.m === "tout" ? new Set(Array.from({ length: nStaves }, (_, i) => i)) : new Set([Number(b.dataset.m)]);
      for (const c of bloc.children) c.classList.toggle("actif", c.dataset.m === "tout" ? mainsActives.size === nStaves : mainsActives.size === 1 && mainsActives.has(Number(c.dataset.m)));
      if (lecture.etat === "lecture") { const t = tempsActuel(); arreterLecture(false); demarrer(t); }
    };
  }
  const bpmAffiche = () => Math.round(bpmBase * facteur);
  function majTempo() { transport.querySelector(".tempo .val").textContent = "♩ = " + bpmAffiche(); }
  function majPos(i) {
    const p = transport.querySelector(".pos");
    const nm = mesuresPos.length;
    const m = eventsNotes.length ? eventsNotes[Math.min(i, eventsNotes.length - 1)].mesure + 1 : 0;
    p.textContent = nm ? "mesure " + m + " / " + nm : "";
  }

  // ------------------------------------------------------------ le jeu : une interprétation, pas une machine
  // Sur le modèle des compos Fable : temps forts appuyés, arc de phrase sur 4 mesures, mélodie au-dessus de
  // l'accompagnement, accords de la main gauche un peu égrenés, micro-décalages corrélés (jamais au hasard pur),
  // ritardando en fin de phrase et de morceau, pédale reprise à chaque changement de basse.
  // Toujours la même pour une partition donnée (hasard à graine) : on peut la réécouter et la mesurer.
  function hasard(graine) {
    let a = (graine >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function interpreter() {
    interpretation = null;
    const evs = eventsNotes;
    if (!evs.length) return;
    let graine = 7; for (const e of evs.slice(0, 96)) graine = (Math.imul(graine, 31) + e.midi * 7 + Math.round(e.t)) >>> 0;
    const r = hasard(graine), gauss = () => (r() + r() + r() + r() - 2) * 1.73;
    const noire = 60000 / bpmBase, PH = 4;
    const mes = mesuresPos.length ? mesuresPos.map((m) => m.t) : [0], nMes = mes.length;
    let finPiece = 0; for (const e of evs) finPiece = Math.max(finPiece, e.fin);
    const durMes = (i) => Math.max(1, ((i + 1 < nMes ? mes[i + 1] : finPiece) - mes[i]) || noire * 4);
    const mesDe = (t) => { let lo = 0, hi = nMes - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (mes[m] <= t + 1) lo = m; else hi = m - 1; } return lo; };
    // le rubato : temps de la partition -> temps joué, un point par temps
    const ptsS = [0], ptsJ = [0];
    let tj = 0;
    for (let i = 0; i < nMes; i++) {
      const dm = durMes(i), pas = Math.max(1, Math.round(dm / noire));
      for (let k = 0; k < pas; k++) {
        const a = mes[i] + dm * k / pas, b = mes[i] + dm * (k + 1) / pas;
        const u = ((i % PH) + (k + 0.5) / pas) / PH;                                        // place dans la phrase
        const fin = i >= nMes - 2 ? ((i - (nMes - 2)) + (k + 0.5) / pas) / 2 : 0;          // les deux dernières mesures
        const s = 1 + 0.075 * Math.pow(Math.max(0, (u - 0.7) / 0.3), 2) - 0.018 * Math.sin(Math.PI * Math.min(1, u / 0.7)) + 0.2 * fin * fin;
        tj += (b - a) * s; ptsS.push(b); ptsJ.push(tj);
      }
    }
    const conv = (xs, ys, x) => {
      if (x <= xs[0]) return ys[0] + (x - xs[0]);
      const n = xs.length - 1; if (x >= xs[n]) return ys[n] + (x - xs[n]);
      let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
      return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1);
    };
    const avant = (t) => conv(ptsS, ptsJ, t), arriere = (t) => conv(ptsJ, ptsS, t);
    // les rôles : portée du haut = mélodie (ou la voix), portée du bas = basse, celles du milieu = accompagnement
    const haut = 0, bas = nStaves >= 2 ? nStaves - 1 : -1;
    const groupes = [];                                                                    // notes attaquées ensemble, par portée
    const ouvertsG = new Map();
    for (const e of evs) {
      const g = ouvertsG.get(e.staff);
      if (g && e.t - g.t < 25) g.notes.push(e); else { const n = { t: e.t, staff: e.staff, notes: [e] }; groupes.push(n); ouvertsG.set(e.staff, n); }
    }
    const melo = groupes.filter((g) => g.staff === haut).map((g) => Math.max(...g.notes.map((n) => n.midi)));
    const moyMelo = melo.length ? melo.reduce((a, b) => a + b, 0) / melo.length : 64;
    // la pédale : reprise à chaque changement de basse (et au début de chaque mesure où la basse bouge)
    const changes = [];
    if (bas >= 0) { let prec = null; for (const g of groupes) if (g.staff === bas) { const b = Math.min(...g.notes.map((n) => n.midi)); if (b !== prec) changes.push(g.t); prec = b; } }
    const prochainChange = (t) => { for (const c of changes) if (c > t + 20) return c; return finPiece + noire; };
    // même touche rejouée : on la relève juste avant
    const suivanteMeme = new Map(), prochaineMeme = new Array(evs.length).fill(Infinity);
    for (let i = evs.length - 1; i >= 0; i--) { const k = evs[i].midi; if (suivanteMeme.has(k)) prochaineMeme[i] = suivanteMeme.get(k); suivanteMeme.set(k, evs[i].t); }
    const indexDe = new Map(evs.map((e, i) => [e, i]));
    let dv = 0, dt = 0;
    for (const g of groupes) {
      dv = 0.72 * dv + gauss() * 1.3; dt = 0.78 * dt + gauss() * 0.0035;
      const m = mesDe(g.t), dm = durMes(m), q = (g.t - mes[m]) / noire, nb = Math.round(dm / noire);
      const appui = q < 0.06 ? 7 : (nb >= 4 && nb % 2 === 0 && Math.abs(q - nb / 2) < 0.06) ? 3.5 : Math.abs(q - Math.round(q)) < 0.06 ? 1.5 : -2;
      const u = ((m % PH) + (g.t - mes[m]) / dm) / PH;
      const arc = 5.5 * Math.sin(Math.PI * Math.min(1, u * 1.15)) - (u > 0.87 ? 2.5 : 0) - (m >= nMes - 1 ? 4 : 0);
      const tri = g.notes.slice().sort((a, b) => a.midi - b.midi), top = tri[tri.length - 1], bass = tri[0];
      const arpege = g.staff !== haut && tri.length >= 3;
      const base = 62 + appui + arc + dv;
      tri.forEach((e, k) => {
        let v, off = dt;
        if (g.staff === haut) {
          if (e === top) { v = base + 8 + U.borne(0.4 * (e.midi - moyMelo), -5, 5); off += 0.004 + Math.abs(gauss()) * 0.006; }
          else { v = base - 4 - 2.5 * (tri.length - 1 - k); off += r() * 0.006; }
        } else if (g.staff === bas) {
          v = e === bass ? base - 4 : base - 11; off += e === bass ? gauss() * 0.004 - 0.004 : 0;
        } else { v = e === top ? base - 6 : base - 10; }
        if (arpege) off += k * (0.011 + r() * 0.006);
        else if (g.staff !== haut && e !== bass) off += r() * 0.006;
        if (nStaves < 2 && g.staff === haut && e !== top && e === bass && tri.length >= 3) off += 0.02;   // une seule portée : la basse d'un gros accord un peu avant
        // la durée : la pédale tient l'accompagnement jusqu'au prochain changement de basse ; la mélodie lie ses notes
        let finS = e.fin, rel = 0.32;
        if (g.staff !== haut && bas >= 0) { const c = prochainChange(e.t); finS = Math.max(e.fin, Math.min(c, mes[m] + dm + noire * 0.5)); rel = 0.75; }
        else { finS = e.fin + noire * 0.06; rel = changes.length ? 0.55 : 0.4; }
        const i = indexDe.get(e);
        if (prochaineMeme[i] < finS + 30) { finS = Math.max(e.t + 40, prochaineMeme[i] - 14); rel = 0.12; }
        const tj0 = avant(e.t) + off * 1000;
        e.vel = Math.round(U.borne(v, 24, 108));
        e.tj = tj0; e.dj = Math.max(60, avant(finS) - tj0); e.rel = rel;
      });
    }
    interpretation = { avant, arriere, graine };
  }

  // ------------------------------------------------------------ le son : piano à queue Salamander, 3 forces de frappe (douce, moyenne, forte), lookahead
  const RACINES = [["A1", 33], ["C2", 36], ["Ds2", 39], ["Fs2", 42], ["A2", 45], ["C3", 48], ["Ds3", 51], ["Fs3", 54], ["A3", 57], ["C4", 60], ["Ds4", 63], ["Fs4", 66], ["A4", 69], ["C5", 72], ["Ds5", 75], ["Fs5", 78], ["A5", 81], ["C6", 84], ["Ds6", 87], ["Fs6", 90]];
  const COUCHES = [[4, 40], [8, 60], [12, 92]];                                      // [couche Salamander, vélocité où elle sonne]
  let ctxA = null, banque = null, banqueCtx = null, chaineA = null;
  function contexte() {
    if (!ctxA) { const A = window.AudioContext || window.webkitAudioContext; if (!A) throw new Error("pas de son sur cet appareil"); ctxA = new A(); }
    if (ctxA.state === "suspended") ctxA.resume();
    return ctxA;
  }
  async function chargerBanque(ctx) {
    if (banque && banqueCtx === ctx.sampleRate) return banque;
    const dec = (typeof OfflineAudioContext !== "undefined") ? new OfflineAudioContext(2, 1, ctx.sampleRate) : ctx;
    let niveaux = {};
    try { const r = await fetch("piano/couches.json"); if (r.ok) for (const n of (await r.json()).notes) niveaux[n.fichier] = n.niveau; } catch (e) { niveaux = {}; }
    const lire = async (nom, v) => {
      const r = await fetch("piano/" + nom + "v" + v + ".mp3"); if (!r.ok) throw new Error("échantillon absent : " + nom + " v" + v);
      return dec.decodeAudioData(await r.arrayBuffer());
    };
    const res = await Promise.all(RACINES.map(async ([nom, midi]) => {
      const bufs = {}, niv = niveaux[nom] || {};
      bufs[8] = await lire(nom, 8);
      await Promise.all(COUCHES.filter((c) => c[0] !== 8).map(async ([v]) => { try { bufs[v] = await lire(nom, v); } catch (e) { /* ancienne banque : la couche moyenne suffit */ } }));
      // chaque couche ramenée au niveau de la moyenne : la force se règle ensuite par la courbe de nuance, le timbre par la couche
      const gain = {}; for (const [v] of COUCHES) gain[v] = (niv[v] !== undefined && niv[8] !== undefined) ? Math.pow(10, (niv[8] - niv[v]) / 20) : 1;
      return { midi, buf: bufs[8], bufs, gain };
    }));
    banque = res; banqueCtx = ctx.sampleRate;
    return banque;
  }
  function chaine(ctx) {
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    const sortie = ctx.createGain(); sortie.gain.value = 0.9;
    // une petite salle : écho diffus fabriqué (aucun fichier), un peu plus ample et plus doux qu'avant
    const conv = ctx.createConvolver(), L = Math.floor(ctx.sampleRate * 2.1), imp = ctx.createBuffer(2, L, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); let lp = 0; for (let i = 0; i < L; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 1.9 * Math.pow(1 - i / L, 3.4) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1); } }
    conv.buffer = imp;
    const sec = ctx.createGain(); sec.gain.value = 1;
    const hum = ctx.createGain(); hum.gain.value = 0.2;
    const bus = ctx.createGain();
    bus.connect(sec); bus.connect(conv); conv.connect(hum); sec.connect(comp); hum.connect(comp); comp.connect(sortie); sortie.connect(ctx.destination);
    return { bus, sortie };
  }
  function racine(midi) { let n = banque[0]; for (const b of banque) if (Math.abs(b.midi - midi) < Math.abs(n.midi - midi)) n = b; return n; }
  // une note jouée : la couche (ou le mélange de deux couches voisines) selon la force, un filtre qui s'ouvre quand on tape fort,
  // une extinction plus longue quand la pédale tient.
  function note(ctx, ch, midi, t, duree, vel, rel) {
    const n = racine(midi), rate = Math.pow(2, (midi - n.midi) / 12);
    const presentes = COUCHES.filter((c) => n.bufs[c[0]]);
    let mel = [];
    if (vel <= presentes[0][1]) mel = [[presentes[0][0], 1]];
    else if (vel >= presentes[presentes.length - 1][1]) mel = [[presentes[presentes.length - 1][0], 1]];
    else for (let i = 1; i < presentes.length; i++) if (vel <= presentes[i][1]) { const a = presentes[i - 1], b = presentes[i], x = (vel - a[1]) / (b[1] - a[1]); mel = [[a[0], Math.cos(x * Math.PI / 2)], [b[0], Math.sin(x * Math.PI / 2)]]; break; }
    const nuance = Math.pow(10, 18 * Math.log10(Math.max(12, vel) / 70) / 20);          // vélocité -> niveau (environ 18 dB entre pp et ff)
    const gain = 0.51 * nuance * Math.pow(10, U.borne((midi - 64) * 0.004, -0.2, 0.2));
    const fin = t + Math.max(0.12, duree), r = rel || 0.4;
    const filtre = ctx.createBiquadFilter(); filtre.type = "lowpass"; filtre.Q.value = 0.5;
    filtre.frequency.value = Math.min(ctx.sampleRate / 2 - 100, 1400 + Math.pow(vel / 127, 2) * 15000);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t); env.gain.setValueAtTime(gain, fin); env.gain.setTargetAtTime(0, fin, r / 3.2);
    filtre.connect(env); env.connect(ch.bus);
    for (const [v, part] of mel) {
      const src = ctx.createBufferSource(); src.buffer = n.bufs[v]; src.playbackRate.value = rate;
      const g = ctx.createGain(); g.gain.value = part * (n.gain[v] || 1);
      src.connect(g); g.connect(filtre); src.start(t); src.stop(fin + r * 1.6 + 0.05);
    }
  }
  // l'ancienne lecture, gardée pour comparer (rendreAudio(…, { mecanique: true })) : une seule couche, force fixe
  function noteMecanique(ctx, ch, midi, t, duree, vel) {
    const n = racine(midi);
    const src = ctx.createBufferSource(); src.buffer = n.buf; src.playbackRate.value = Math.pow(2, (midi - n.midi) / 12);
    const g = ctx.createGain(), force = U.borne(vel / 100, 0.2, 1.1);
    const gain = 0.85 * force * Math.pow(10, U.borne((midi - 64) * 0.004, -0.2, 0.2));
    const fin = t + Math.max(0.12, duree);
    g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, fin); g.gain.exponentialRampToValueAtTime(0.0008, fin + 0.45);
    src.connect(g); g.connect(ch.bus); src.start(t); src.stop(fin + 0.5);
  }
  const joueMs = (t) => (interpretation ? interpretation.avant(t) : t);              // temps de partition -> temps joué
  const partMs = (t) => (interpretation ? interpretation.arriere(t) : t);

  const lecture = { etat: "arret", t0: 0, deb: 0, debJ: 0, prochain: 0, minut: 0, img: 0, ctx: null, vivants: new Set() };
  const tempsActuel = () => (lecture.etat === "arret" ? lecture.deb : partMs(lecture.debJ + (lecture.ctx.currentTime - lecture.t0) * facteur * 1000));
  // Les temps de la timemap sont en ms à bpmBase ; facteur = vitesse relative (1 = tempo de la partition).
  // Le jeu (e.tj, e.dj) est en ms jouées à bpmBase : le rubato y est déjà ; le curseur revient en temps de partition.
  async function demarrer(depuisMs, finMs) {
    if (!eventsNotes.length) return;
    try {
      const ctx = contexte();
      lecture.etat = "charge"; majBoutonLire();
      await chargerBanque(ctx);
      if (!interpretation) interpreter();
      if (!chaineA || chaineA.ctx !== ctx) { chaineA = chaine(ctx); chaineA.ctx = ctx; }
      lecture.ctx = ctx; lecture.deb = depuisMs || 0; lecture.debJ = joueMs(lecture.deb); lecture.t0 = ctx.currentTime + 0.08;
      lecture.prochain = eventsNotes.findIndex((e) => e.t >= lecture.deb - 1);
      if (lecture.prochain < 0) lecture.prochain = eventsNotes.length;
      lecture.fin = finMs || 0; lecture.etat = "lecture"; majBoutonLire();
      lecture.minut = setInterval(planifier, 70); planifier();
      boucle();
    } catch (e) { lecture.etat = "arret"; majBoutonLire(); C.dire && C.dire("Le son ne démarre pas : " + String(e && e.message || e).slice(0, 60)); }
  }
  function planifier() {
    if (lecture.etat !== "lecture") return;
    const ctx = lecture.ctx, horizon = ctx.currentTime + 0.7;
    while (lecture.prochain < eventsNotes.length) {
      const e = eventsNotes[lecture.prochain];
      const tj = e.tj !== undefined ? e.tj : e.t;
      const quand = lecture.t0 + (tj - lecture.debJ) / (1000 * facteur);
      if (quand > horizon) break;
      if (lecture.fin && e.t >= lecture.fin) { lecture.prochain = eventsNotes.length; break; }
      lecture.prochain++;
      if (!mainsActives.has(e.staff)) continue;
      const dj = e.dj !== undefined ? e.dj : (e.fin - e.t) * 0.96;
      note(ctx, chaineA, e.midi, Math.max(quand, ctx.currentTime), dj / (1000 * facteur), e.vel || 70, e.rel);
    }
    const dernier = lecture.fin ? Math.min(lecture.fin, eventsNotes[eventsNotes.length - 1].fin) : eventsNotes[eventsNotes.length - 1].fin;
    if (lecture.prochain >= eventsNotes.length && ctx.currentTime > lecture.t0 + (joueMs(dernier) - lecture.debJ) / (1000 * facteur) + 0.6) arreterLecture(false, !lecture.fin);
  }
  // le curseur : les notes qui sonnent s'allument, une barre fine suit, la page défile pour garder la ligne en vue
  function boucle() {
    cancelAnimationFrame(lecture.img);
    const pas = () => {
      if (lecture.etat !== "lecture") return;
      allumer(tempsActuel());
      lecture.img = requestAnimationFrame(pas);
    };
    lecture.img = requestAnimationFrame(pas);
  }
  let allumes = [];
  function eteindre() { for (const n of allumes) n.classList.remove("joue"); allumes = []; if (cur) cur.hidden = true; if (rendu) for (const m of rendu.querySelectorAll(".en-section")) m.classList.remove("en-section"); if (el) for (const b of el.querySelectorAll(".tab-section.actif")) b.classList.remove("actif"); }
  function allumer(ms) {
    // notes en cours : t <= ms < fin ; la plus proche donne la place du curseur
    for (const n of allumes) n.classList.remove("joue");
    allumes = [];
    let derniere = null, i0 = Math.max(0, Math.min(eventsNotes.length - 1, lecture.prochain - 1));
    for (let i = i0; i >= 0 && i > i0 - 40; i--) {
      const e = eventsNotes[i];
      if (e.t <= ms && ms < e.fin) { const n = document.getElementById(e.id); if (n) { n.classList.add("joue"); allumes.push(n); } if (!derniere || e.t > derniere.t) derniere = e; }
    }
    if (derniere) { majPos(idVersIndex.get(derniere.id)); positionnerCurseur(derniere); }
  }
  function positionnerCurseur(e) {
    const n = document.getElementById(e.id); if (!n || !cur) return;
    const sys = n.closest("g.system"); if (!sys) return;
    const r = n.getBoundingClientRect(), s = sys.getBoundingClientRect(), f = rendu.getBoundingClientRect();
    cur.hidden = false;
    cur.style.transform = "translate(" + (r.left + r.width / 2 - f.left).toFixed(1) + "px," + (s.top - f.top - 6).toFixed(1) + "px)";
    cur.style.height = (s.height + 12).toFixed(1) + "px";
    // la page suit : la ligne jouée reste dans le tiers haut de la fenêtre
    const vis = feuilleP.getBoundingClientRect();
    if (s.top < vis.top + 10 || s.bottom > vis.bottom - 10) feuilleP.scrollTo({ top: feuilleP.scrollTop + (s.top - vis.top) - vis.height * 0.18, behavior: "smooth" });
  }
  function arreterLecture(rien, fini) {
    clearInterval(lecture.minut); cancelAnimationFrame(lecture.img);
    if (lecture.etat === "lecture" && !fini) lecture.deb = Math.max(0, tempsActuel());
    if (fini) lecture.deb = 0;
    lecture.etat = "arret";
    if (chaineA && chaineA.ctx) { try { chaineA.bus.disconnect(); } catch (e) { /* rien */ } chaineA = null; }   // coupe les notes déjà programmées
    eteindre(); majBoutonLire();
    if (rien) lecture.deb = 0;
  }
  function majBoutonLire() {
    const b = transport && transport.querySelector('[data-t="lire"]');
    if (!b) return;
    b.innerHTML = ico(lecture.etat === "lecture" ? "pause" : "lire");
    b.classList.toggle("charge", lecture.etat === "charge");
    b.title = lecture.etat === "lecture" ? "Pause (Espace)" : "Lire (Espace)";
    el.classList.toggle("joue-tout", lecture.etat === "lecture");
  }
  function commande(c) {
    if (c === "lire") { if (lecture.etat === "lecture") arreterLecture(false); else if (lecture.etat !== "charge") demarrer(lecture.deb); }
    else if (c === "debut") { arreterLecture(true); demarrer(0); }
    else if (c === "plus" || c === "moins") {
      const dep = tempsActuel(), jouait = lecture.etat === "lecture";
      const bpm = U.borne(bpmAffiche() + (c === "plus" ? 6 : -6), 30, 240);
      facteur = bpm / bpmBase; majTempo();
      if (jouait) { arreterLecture(false); lecture.deb = dep; demarrer(dep); }
    } else if (c === "zplus" || c === "zmoins") { echelle = U.borne(echelle + (c === "zplus" ? 6 : -6), 24, 90); mettreEnPage(false); }
  }
  // un clic sur une note ou une mesure : on repart de là
  function cliquerPartition(e) {
    const n = e.target.closest("g.note, g.chord, g.rest");
    let id = n && n.id, ms = null;
    if (id) {
      const note = n.matches("g.note") ? n : n.querySelector("g.note");
      const k = note ? idVersIndex.get(note.id) : undefined;
      if (k !== undefined) ms = eventsNotes[k].t;
    }
    if (ms === null) { const m = e.target.closest("g.measure"); if (m) { const mp = mesuresPos.find((x) => x.id === m.id); if (mp) ms = mp.t; } }
    if (ms === null) return;
    arreterLecture(false); lecture.deb = ms;
    const k = eventsNotes.find((x) => x.t >= ms - 1), sec = k && sectionDe(k.mi);
    if (sec && modeExercices()) jouerSection(sec, ms); else demarrer(ms);
  }

  // ------------------------------------------------------------ sections : un exemple, une gamme, une ligne : on la touche, elle seule joue
  const sectionsDe = () => (page && page.propre && page.propre.partition && page.propre.partition.sections) || [];
  const modeExercices = () => !!(page && page.propre && page.propre.partition && page.propre.partition.mode === "exercices");
  const sectionDe = (mi) => sectionsDe().find((s) => mi >= s.a - 1 && mi <= s.b - 1);
  function poserSections() {
    for (const t of rendu.querySelectorAll(".tab-section")) t.remove();
    el.classList.toggle("exercices", modeExercices());
    const secs = sectionsDe(); if (!secs.length || !rendu.querySelector("svg")) return;
    const ms = [...rendu.querySelectorAll("g.measure")], f = rendu.getBoundingClientRect();
    for (const s of secs) {
      const m = ms[s.a - 1]; if (!m) continue;
      const sys = m.closest("g.system"), sr = (sys || m).getBoundingClientRect();
      const b = U.el("button", "tab-section", rendu); b.dataset.n = s.n;
      b.innerHTML = "<i>" + ico("lire") + "</i><b>" + (s.titre ? s.titre.slice(0, 26) : (modeExercices() ? "Exemple " + s.n : "Ligne " + s.n)) + "</b>";
      b.style.transform = "translate(" + Math.max(0, sr.left - f.left - 4).toFixed(0) + "px," + (sr.top - f.top - 30).toFixed(0) + "px)";
      b.title = "Écouter seulement cette section (mesures " + s.a + " à " + s.b + ")";
      b.addEventListener("click", (e) => { e.stopPropagation(); if (b.classList.contains("actif") && lecture.etat === "lecture") arreterLecture(false); else jouerSection(s); });
      b.addEventListener("pointerenter", () => { for (let i = s.a - 1; i <= s.b - 1; i++) if (ms[i]) ms[i].classList.add("en-section"); });
      b.addEventListener("pointerleave", () => { if (lecture.etat !== "lecture") for (const x of rendu.querySelectorAll(".en-section")) x.classList.remove("en-section"); });
    }
  }
  function trouverSection(q) {
    const secs = sectionsDe();
    if (/^\d+$/.test(String(q))) return secs.find((s) => s.n === Number(q));
    const plat = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return secs.find((s) => plat(q) && plat(s.titre).includes(plat(q))) || null;
  }
  function jouerSection(s, depuis) {
    if (typeof s === "number" || typeof s === "string") s = trouverSection(s);
    if (!s) return false;
    const evs = eventsNotes.filter((e) => e.mi >= s.a - 1 && e.mi <= s.b - 1);
    if (!evs.length) return false;
    const deb = depuis !== undefined ? depuis : evs[0].t;
    let fin = evs[0].fin;
    for (const e of evs) if (e.t >= deb && e.t - fin < 4000) fin = Math.max(fin, e.fin);   // premier passage : les reprises ne sont pas rejouées
    if (lecture.etat === "lecture") arreterLecture(false);
    const ms = [...rendu.querySelectorAll("g.measure")];
    for (const x of rendu.querySelectorAll(".en-section")) x.classList.remove("en-section");
    for (let i = s.a - 1; i <= s.b - 1; i++) if (ms[i]) ms[i].classList.add("en-section");
    for (const b of rendu.querySelectorAll(".tab-section")) b.classList.toggle("actif", Number(b.dataset.n) === s.n);
    lecture.deb = deb; demarrer(deb, fin + 30);
    return true;
  }
  P.jouerSection = (q) => jouerSection(q);
  P.sections = () => sectionsDe();
  // ordres de Nova : « joue la section 3 de … »
  if (window.CartableNoyau && CartableNoyau.surNova) CartableNoyau.surNova(async (cmd, r) => {
    if (cmd.action !== "partition-jouer" || !r.ok) return;
    const donnees = C.pont && C.pont.donnees && C.pont.donnees();
    const pg = donnees && donnees.objets.flatMap((o) => o.pages || [o]).find((p) => P.estPartition(p) && p.id === r.id);
    if (!pg) return;
    if (!ouvert && !P.ouvrir(pg, null, {})) return;
    for (let i = 0; i < 100 && !eventsNotes.length; i++) await new Promise((x) => setTimeout(x, 150));
    if (cmd.section) jouerSection(cmd.section); else if (!modeExercices()) demarrer(0);
  });

  // rendu hors ligne complet (essais : aucun son sur la machine) -> { duree, crete, rms, notes, vel, enveloppe, centroide }
  // options.mecanique : l'ancienne lecture (force fixe, une couche, pile sur la grille), pour comparer.
  P.rendreAudio = async function (secondes, options) {
    if (!eventsNotes.length) return null;
    const meca = !!(options && options.mecanique), sr = 22050;
    if (!meca && !interpretation) interpreter();
    const finJ = meca ? eventsNotes[eventsNotes.length - 1].fin : joueMs(eventsNotes[eventsNotes.length - 1].fin);
    const dur = Math.min(secondes || 12, finJ / 1000 / facteur + 1.5);
    const oc = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    await chargerBanque(oc);
    const ch = chaine(oc); let n = 0; const vels = [];
    for (const e of eventsNotes) {
      if (!mainsActives.has(e.staff)) continue;
      if (meca) { const t = e.t / (1000 * facteur); if (t > dur - 0.3) continue; noteMecanique(oc, ch, e.midi, t, (e.fin - e.t) / (1000 * facteur) * 0.96, 70); vels.push(70); }
      else { const t = e.tj / (1000 * facteur); if (t > dur - 0.3) continue; note(oc, ch, e.midi, Math.max(0, t), e.dj / (1000 * facteur), e.vel, e.rel); vels.push(e.vel); }
      n++;
    }
    const r = await oc.startRendering(), x = r.getChannelData(0);
    let crete = 0, s = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > crete) crete = a; s += x[i] * x[i]; }
    // enveloppe : RMS par tranche de 250 ms (en dB), et son écart (un jeu vivant respire)
    const W = Math.floor(sr * 0.25), env = [];
    for (let i = 0; i + W <= x.length; i += W) { let q = 0; for (let j = i; j < i + W; j++) q += x[j] * x[j]; env.push(10 * Math.log10(q / W + 1e-12)); }
    const actifs = env.filter((v) => v > -60), moy = actifs.reduce((a, b) => a + b, 0) / (actifs.length || 1);
    const ecartEnv = Math.sqrt(actifs.reduce((a, b) => a + (b - moy) * (b - moy), 0) / (actifs.length || 1));
    // centroïde spectral moyen (petite DFT sur 1024 points, toutes les 0,5 s)
    const N = 1024; let cs = 0, cn = 0;
    for (let i = 0; i + N <= x.length; i += Math.floor(sr * 0.5)) {
      let num = 0, den = 0;
      for (let k = 1; k < N / 2; k += 2) { let re = 0, im = 0; for (let j = 0; j < N; j += 2) { const w = x[i + j] * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / N)); re += w * Math.cos(2 * Math.PI * k * j / N); im -= w * Math.sin(2 * Math.PI * k * j / N); } const m = Math.hypot(re, im); num += m * k * sr / N; den += m; }
      if (den > 1e-6) { cs += num / den; cn++; }
    }
    const vm = vels.reduce((a, b) => a + b, 0) / (vels.length || 1), ve = Math.sqrt(vels.reduce((a, b) => a + (b - vm) * (b - vm), 0) / (vels.length || 1));
    return { mecanique: meca, duree: +dur.toFixed(2), notes: n, crete: +crete.toFixed(3), rms: +Math.sqrt(s / x.length).toFixed(4),
      vel: { moy: +vm.toFixed(1), ecart: +ve.toFixed(1), min: Math.min(...vels), max: Math.max(...vels) },
      enveloppe: { ecartDb: +ecartEnv.toFixed(2), tranches: env.length }, centroide: Math.round(cn ? cs / cn : 0) };
  };
  P.interpretation = () => (interpretation ? { graine: interpretation.graine, notes: eventsNotes.slice(0, 24).map((e) => ({ midi: e.midi, staff: e.staff, t: Math.round(e.t), tj: Math.round(e.tj), vel: e.vel })) } : null);
  P.etatSections = () => ({ mode: modeExercices() ? "exercices" : "morceau", sections: sectionsDe().length, tabs: rendu ? rendu.querySelectorAll(".tab-section").length : 0 });
  P.regler = (o) => { if (o.mains) { mainsActives = new Set(o.mains); } if (o.bpm) { facteur = o.bpm / bpmBase; majTempo(); } };
  P.voir = voir;
  P.demarrerEssai = (ms) => demarrer(ms || 0);
  P.allumerEssai = (ms) => { lecture.prochain = eventsNotes.findIndex((e) => e.t > ms); if (lecture.prochain < 0) lecture.prochain = eventsNotes.length; allumer(ms); };
  P.arreterEssai = () => arreterLecture(false);

  // ------------------------------------------------------------ exports, apprentissage, faute
  function telecharger(nom, octets, type) {
    const u = URL.createObjectURL(new Blob([octets], { type }));
    const a = document.createElement("a"); a.href = u; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  const nomFichier = () => ((page && page.titre) || "partition").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60) || "partition";
  function action(a) {
    if (!xml) return;
    if (a === "musicxml") { telecharger(nomFichier() + ".musicxml", xml, "application/vnd.recordare.musicxml+xml"); C.dire && C.dire("MusicXML exporté."); }
    else if (a === "midi") {
      try { const b64 = tk.renderToMIDI(); const bin = atob(b64), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); telecharger(nomFichier() + ".mid", o, "audio/midi"); C.dire && C.dire("MIDI exporté."); }
      catch (e) { C.dire && C.dire("Je n'ai pas pu fabriquer le MIDI."); }
    } else if (a === "apprendre") {
      const h = window.cartableHote;
      if (h && h.partitionApprendre) h.partitionApprendre(xml, nomFichier()).then((r) => C.dire && C.dire(r && r.ok ? "Ouverte dans l'appli d'apprentissage." : "Je ne peux pas l'ouvrir ici (appli d'apprentissage absente)."), () => C.dire && C.dire("Je ne peux pas l'ouvrir ici."));
      else C.dire && C.dire("L'appli d'apprentissage est sur le gros PC : dis « ouvre-la dans l'apprentissage » à Nova.");
    } else if (a === "faute") {
      const h = window.cartableHote;
      if (h && h.partitionFaute) h.partitionFaute(nomFichier()).then(() => C.dire && C.dire("Merci, je la fais revérifier la prochaine fois."), () => C.dire && C.dire("Dis-le à Nova : « il y a une faute dans cette partition »."));
      else C.dire && C.dire("Dis-le à Nova : « il y a une faute dans cette partition ».");
    }
  }
})(window.Cartable);
