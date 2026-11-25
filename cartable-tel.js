// 25/11/2026 : le Cartable sur le téléphone (page publiée dans <appli>/cartable/interface/index.html).
// Chargé ENTRE noyau.js et pont-interface.js : le noyau démarre avec IndexedDB (préfixe « tel ») et la synchro HTTP.
// Les appels partent vers « /api/cartable/… » de la page elle-même ; appli.js (chargé dans le <head>) les intercepte et
// les envoie au PC du moment avec le jeton d'appareil. Hors ligne : l'appel échoue, le noyau garde tout en local et
// réessaie tout seul ; au retour du réseau, tout part.
(function () {
  "use strict";
  if (!window.CartableNoyau || window.cartableHote) return;
  window.cartableHote = {
    prefixe: "tel",
    transport: window.CartableNoyau.transportHttp({ base: () => location.origin, entetes: {} }),
  };
})();
