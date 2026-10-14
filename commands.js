// Analyseur de commandes locales (sans IA). Fonctionne dans le navigateur et sous Node.
(function (root) {
  const NOMBRES = {
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
    neuf: 9, dix: 10, onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30,
    quarante: 40, cinquante: 50, soixante: 60,
  };

  function normaliser(texte) {
    return texte
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’']/g, ' ')
      .replace(/[?!.,;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nombre(mot) {
    if (/^\d+$/.test(mot)) return parseInt(mot, 10);
    return NOMBRES[mot];
  }

  // "5 minutes et 30 secondes", "une heure", "90 secondes", "2 min 10"
  function parserDuree(t) {
    let total = 0;
    const re = /\b(\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante)\s*(heures?|h|minutes?|mins?|mn|secondes?|secs?|s)\b/g;
    let m;
    while ((m = re.exec(t))) {
      const n = nombre(m[1]);
      if (n === undefined) continue;
      if (m[2].startsWith('h')) total += n * 3600;
      else if (m[2].startsWith('m')) total += n * 60;
      else total += n;
    }
    if (/\bet demie?\b/.test(t) && /minute/.test(t)) total += 30;
    return total;
  }

  function formaterDuree(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (h) parts.push(h + (h > 1 ? ' heures' : ' heure'));
    if (m) parts.push(m + (m > 1 ? ' minutes' : ' minute'));
    if (s) parts.push(s + (s > 1 ? ' secondes' : ' seconde'));
    return parts.join(' et ') || '0 seconde';
  }

  function extraireRequete(t, motsCles) {
    let q = t;
    for (const re of motsCles) q = q.replace(re, ' ');
    return q.replace(/\s+/g, ' ').trim();
  }

  // Renvoie { type, ... } ou null si la phrase doit partir à l'IA.
  function analyser(texteBrut) {
    const t = normaliser(texteBrut);
    if (!t) return null;

    if (/\b(arrete|annule|stoppe?|coupe)\b.*\b(minuteur|timer|chrono)/.test(t)) {
      return { type: 'minuteur-stop' };
    }
    if (/\b(minuteur|timer|compte a rebours|chrono|reveille[- ]moi dans|rappelle[- ]moi dans)\b/.test(t)) {
      const secondes = parserDuree(t);
      return { type: 'minuteur', secondes };
    }

    if (/\b(quelle heure|l heure|heure est[- ]il|donne[- ]moi l heure)\b/.test(t)) {
      return { type: 'heure' };
    }
    if (/\b(quel jour|quelle date|la date|on est quel|sommes[- ]nous)\b/.test(t)) {
      return { type: 'date' };
    }

    if (/\byoutube\b/.test(t)) {
      const q = extraireRequete(t, [
        /\b(sur|dans|de|via)? ?youtube\b/g,
        /^(jarvis )?(mets|met|lance|joue|ouvre|cherche|recherche|trouve|montre[- ]moi|affiche|passe)( moi)?\b/,
        /^(la |le |les |une |un |des )/,
      ]);
      return { type: 'youtube', requete: q };
    }

    const google = /\b(google|cherche|recherche|rechercher|chercher)\b/.test(t);
    if (google) {
      const q = extraireRequete(t, [
        /\b(sur|dans|avec|via)? ?google\b/g,
        /^(jarvis )?(peux[- ]tu |pourrais[- ]tu )?(cherche|recherche|rechercher|chercher|trouve|regarde)( moi)?\b/,
        /^(des informations sur|des infos sur|infos sur|informations sur)\b/,
      ]);
      if (q) return { type: 'google', requete: q };
      return { type: 'google', requete: '' };
    }

    if (/^(ouvre|lance) (le site |la page )?/.test(t)) {
      const site = t.replace(/^(ouvre|lance) (le site |la page )?/, '').trim();
      if (/^[a-z0-9-]+(\.[a-z]{2,})+$/.test(site)) return { type: 'site', url: 'https://' + site };
    }

    if (/\b(efface|vide|nettoie)\b.*\b(conversation|ecran|historique)\b/.test(t)) {
      return { type: 'effacer' };
    }
    if (/\b(tais[- ]toi|silence|chut|stop)\b$/.test(t)) {
      return { type: 'silence' };
    }
    return null;
  }

  function urlGoogle(q) {
    return 'https://www.google.com/search?q=' + encodeURIComponent(q);
  }
  function urlYoutube(q) {
    return q
      ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q)
      : 'https://www.youtube.com/';
  }

  const api = { analyser, parserDuree, formaterDuree, normaliser, urlGoogle, urlYoutube };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JarvisCommandes = api;
})(typeof window !== 'undefined' ? window : globalThis);
