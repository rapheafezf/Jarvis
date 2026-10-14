// Logique principale : micro (Web Speech API), voix (speechSynthesis), commandes locales et IA.
(function () {
  const C = window.JarvisCommandes;
  const $ = (id) => document.getElementById(id);
  const journal = $('journal');
  const entree = $('entree');
  const statut = $('statut');
  const btnMicro = $('micro');
  const optVoix = $('opt-voix');
  const optContinu = $('opt-continu');
  const choixVoix = $('choix-voix');

  const historique = []; // { role: 'user'|'assistant', content }
  const MOT_REVEIL = /\bjarvis\b/i;

  // ---------- Affichage ----------
  function ajouterMessage(role, texte, lien) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'jarvis');
    div.textContent = texte;
    if (lien) {
      div.appendChild(document.createTextNode(' '));
      const a = document.createElement('a');
      a.href = lien.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = lien.texte;
      div.appendChild(a);
    }
    journal.appendChild(div);
    journal.scrollTop = journal.scrollHeight;
    return div;
  }

  function setStatut(texte, actif) {
    statut.textContent = texte;
    statut.classList.toggle('actif', !!actif);
  }

  function horloge() {
    $('horloge').textContent = new Date().toLocaleTimeString('fr-FR');
  }
  setInterval(horloge, 1000);
  horloge();

  // ---------- Voix (synthèse) ----------
  const synth = window.speechSynthesis;
  let voixChoisie = null;
  let enTrainDeParler = false;
  // Voix françaises masculines connues (Windows, macOS, Android, Chrome), par ordre de préférence.
  const PREFERENCES = [/paul/i, /henri/i, /thomas/i, /claude/i, /nicolas/i, /mathieu/i, /daniel/i, /remy|rémy/i, /fr-fr-.*neural/i, /google.*fran/i];

  let reglageVitesse = parseFloat(lireStockage('jarvis-vitesse')) || 1.0;
  let reglagePitch = parseFloat(lireStockage('jarvis-pitch')) || 0.85;

  function synchroniserSelectVoix(voix, meilleure) {
    const selects = [choixVoix, $('menu-choix-voix')].filter(Boolean);
    for (const sel of selects) {
      sel.innerHTML = '';
      if (!voix.length) {
        const o = document.createElement('option');
        o.textContent = 'Voix française par défaut';
        o.value = '';
        sel.appendChild(o);
        continue;
      }
      for (const v of voix) {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = `${v.name} (${v.lang})`;
        if (v === meilleure) o.selected = true;
        sel.appendChild(o);
      }
    }
  }

  function chargerVoix() {
    if (!synth) return;
    const voix = synth.getVoices().filter((v) => /^fr(-|_|$)/i.test(v.lang));
    const memorisee = lireStockage('jarvis-voix');
    let meilleure = voix.find((v) => v.name === memorisee);
    if (!meilleure) {
      for (const re of PREFERENCES) {
        meilleure = voix.find((v) => re.test(v.name) && /fr-FR|fr_FR/i.test(v.lang)) || voix.find((v) => re.test(v.name));
        if (meilleure) break;
      }
    }
    meilleure = meilleure || voix.find((v) => /fr-FR/i.test(v.lang)) || voix[0];
    synchroniserSelectVoix(voix, meilleure);
    voixChoisie = meilleure;
  }
  if (synth) {
    chargerVoix();
    synth.addEventListener?.('voiceschanged', chargerVoix);
  }
  function onChangementVoix(e) {
    const val = e.target.value;
    voixChoisie = synth.getVoices().find((v) => v.name === val) || null;
    ecrireStockage('jarvis-voix', val);
    if (choixVoix) choixVoix.value = val;
    if ($('menu-choix-voix')) $('menu-choix-voix').value = val;
    parler('Voix sélectionnée, Monsieur.');
  }
  choixVoix.addEventListener('change', onChangementVoix);
  if ($('menu-choix-voix')) $('menu-choix-voix').addEventListener('change', onChangementVoix);

  function lireStockage(cle) {
    try { return localStorage.getItem(cle); } catch { return null; }
  }
  function ecrireStockage(cle, val) {
    try { localStorage.setItem(cle, val); } catch { /* stockage indisponible */ }
  }

  // Chrome coupe les énoncés de plus de ~15 s : on découpe par phrases.
  function decouper(texte) {
    const phrases = texte.match(/[^.!?…]+[.!?…]*/g) || [texte];
    const morceaux = [];
    let courant = '';
    for (const p of phrases) {
      if ((courant + p).length > 180 && courant) {
        morceaux.push(courant.trim());
        courant = '';
      }
      courant += p;
    }
    if (courant.trim()) morceaux.push(courant.trim());
    return morceaux;
  }

  let enonces = []; // garde des références (sinon Chrome peut ne jamais déclencher onend)
  function parler(texte) {
    return new Promise((resolve) => {
      if (!synth || !optVoix.checked || !texte) return resolve();
      synth.cancel();
      const morceaux = decouper(texte);
      enonces = morceaux.map((m) => {
        const u = new SpeechSynthesisUtterance(m);
        u.lang = 'fr-FR';
        if (voixChoisie) u.voice = voixChoisie;
        u.rate = reglageVitesse;
        u.pitch = reglagePitch; // personnalisable dans le menu HUD
        return u;
      });
      enTrainDeParler = true;
      suspendreEcoute();
      Reacteur.setMode('parole');
      let fini = false;
      const terminer = () => {
        if (fini) return;
        fini = true;
        clearTimeout(garde);
        enTrainDeParler = false;
        enonces = [];
        Reacteur.setMode('repos');
        resolve();
        reprendreEcoute();
      };
      // Filet de sécurité si onend ne se déclenche jamais (bug connu de certains navigateurs).
      const garde = setTimeout(terminer, 2000 + texte.length * 90);
      enonces.forEach((u, i) => {
        u.onerror = terminer;
        if (i === enonces.length - 1) u.onend = terminer;
        synth.speak(u);
      });
    });
  }

  function taire() {
    if (synth) synth.cancel();
  }

  // ---------- Micro (reconnaissance vocale) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let reco = null; // reconnaissance active (de start() jusqu'à onend), une seule à la fois
  let veutEcouter = false; // l'utilisateur souhaite que le micro soit actif
  let micBranche = false;

  function creerReco() {
    const r = new SR();
    r.lang = 'fr-FR';
    r.interimResults = true;
    r.continuous = optContinu.checked;
    r.maxAlternatives = 1;

    r.onstart = () => {
      btnMicro.classList.add('ecoute');
      Reacteur.setMode('ecoute');
      setStatut(optContinu.checked ? 'J\'écoute… dites « Jarvis » suivi de votre demande' : 'J\'écoute…', true);
    };
    r.onresult = (e) => {
      let provisoire = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const texte = res[0].transcript.trim();
        if (res.isFinal) {
          provisoire = '';
          traiterVoix(texte);
        } else provisoire += texte + ' ';
      }
      if (provisoire) setStatut('« ' + provisoire.trim() + ' »', true);
    };
    let erreur = null;
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      erreur = e.error;
      const fatales = {
        'not-allowed': 'Accès au micro refusé. Autorisez-le dans le navigateur (HTTPS ou localhost requis).',
        'service-not-allowed': 'Accès au micro refusé. Autorisez-le dans le navigateur (HTTPS ou localhost requis).',
        'audio-capture': 'Aucun micro détecté, Monsieur. Branchez-en un ou tapez votre commande.',
        network: 'Reconnaissance vocale indisponible (connexion au service vocal impossible).',
        'language-not-supported': 'Le français n\'est pas pris en charge par la reconnaissance vocale de ce navigateur.',
      };
      if (fatales[e.error]) {
        veutEcouter = false; // inutile de relancer en boucle
        setStatut(fatales[e.error]);
      } else if (e.error === 'no-speech') {
        setStatut('Je n\'ai rien entendu, Monsieur.');
      } else {
        setStatut('Erreur micro : ' + e.error);
      }
    };
    r.onend = () => {
      if (reco === r) reco = null;
      btnMicro.classList.remove('ecoute');
      if (Reacteur.getMode() === 'ecoute') Reacteur.setMode('repos');
      // En mode continu, Chrome arrête la reco au bout d'un moment : on relance.
      if (veutEcouter && optContinu.checked && !enTrainDeParler) {
        setTimeout(demarrerReco, 250);
      } else if (!erreur && !enTrainDeParler && Reacteur.getMode() === 'repos') {
        // Ne pas écraser un message d'erreur qui explique pourquoi le micro s'est arrêté.
        setStatut('Touchez le réacteur ou appuyez sur Espace pour parler');
      }
    };
    return r;
  }

  function demarrerReco() {
    if (!SR || reco || enTrainDeParler || !veutEcouter) return;
    reco = creerReco();
    try {
      reco.start();
    } catch (e) {
      reco = null;
      console.warn(e);
    }
  }

  async function brancherAnalyseMicro() {
    if (micBranche || !navigator.mediaDevices?.getUserMedia) return;
    micBranche = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      Reacteur.brancherMicro(stream);
    } catch {
      micBranche = false;
    }
  }

  function basculerMicro() {
    if (!SR) {
      setStatut('Reconnaissance vocale non supportée : utilisez Chrome ou Edge, ou tapez votre commande.');
      entree.focus();
      return;
    }
    taire();
    // Pendant la courte pause entre deux relances du mode continu, reco est null mais veutEcouter est vrai.
    if (reco || veutEcouter) {
      veutEcouter = false;
      if (reco) reco.abort();
      return;
    }
    veutEcouter = true;
    brancherAnalyseMicro();
    demarrerReco();
  }

  // Évite que Jarvis s'entende parler.
  function suspendreEcoute() {
    if (reco) reco.abort();
  }
  function reprendreEcoute() {
    if (veutEcouter && optContinu.checked) setTimeout(demarrerReco, 300);
  }

  function traiterVoix(texte) {
    if (!texte) return;
    if (optContinu.checked) {
      if (!MOT_REVEIL.test(texte)) return; // ignore ce qui ne commence pas par « Jarvis »
      texte = texte.replace(/^.*?\bjarvis\b[\s,]*/i, '').trim();
      if (!texte) {
        parler('Oui, Monsieur ?');
        return;
      }
    } else {
      veutEcouter = false;
    }
    traiter(texte);
  }

  optContinu.addEventListener('change', () => {
    if (reco) {
      veutEcouter = optContinu.checked;
      reco.abort();
    }
  });

  // ---------- Minuteur ----------
  let minuteurFin = 0;
  let minuteurId = null;
  let alarmeId = null;
  const boiteMinuteur = $('minuteur');

  function majMinuteur() {
    const reste = Math.max(0, Math.round((minuteurFin - Date.now()) / 1000));
    const h = Math.floor(reste / 3600);
    const m = Math.floor((reste % 3600) / 60);
    const s = reste % 60;
    const pad = (x) => String(x).padStart(2, '0');
    $('minuteur-temps').textContent = (h ? h + ':' : '') + pad(m) + ':' + pad(s);
    document.title = reste > 0 ? `⏱ ${$('minuteur-temps').textContent} · J.A.R.V.I.S.` : 'J.A.R.V.I.S.';
    if (reste === 0) {
      clearInterval(minuteurId);
      minuteurId = null;
      sonnerie();
    }
  }

  function lancerMinuteur(secondes) {
    arreterMinuteur(true);
    minuteurFin = Date.now() + secondes * 1000;
    boiteMinuteur.hidden = false;
    majMinuteur();
    minuteurId = setInterval(majMinuteur, 250);
  }

  function arreterMinuteur(silencieux) {
    clearInterval(minuteurId);
    clearInterval(alarmeId);
    minuteurId = alarmeId = null;
    boiteMinuteur.hidden = true;
    boiteMinuteur.classList.remove('sonne');
    document.title = 'J.A.R.V.I.S.';
    return !silencieux;
  }

  let audioCtx = null;
  function bip() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.4);
    } catch { /* audio indisponible */ }
  }

  function sonnerie() {
    boiteMinuteur.classList.add('sonne');
    let n = 0;
    bip();
    alarmeId = setInterval(() => {
      bip();
      if (++n >= 8) {
        clearInterval(alarmeId);
        alarmeId = null;
      }
    }, 600);
    const msg = 'Monsieur, le minuteur est terminé.';
    ajouterMessage('jarvis', msg);
    parler(msg);
  }

  $('minuteur-stop').addEventListener('click', () => arreterMinuteur());

  // ---------- Ouverture d'onglets ----------
  // Après une reconnaissance vocale ou un appel réseau, il n'y a plus de « geste utilisateur » :
  // le bloqueur de popups refuse window.open. On affiche alors un lien cliquable.
  function ouvrir(url, texteRep, libelleLien) {
    let fenetre = null;
    try {
      fenetre = window.open(url, '_blank', 'noopener');
    } catch { /* bloqué */ }
    // Avec 'noopener', window.open renvoie null même en cas de succès dans certains navigateurs :
    // on affiche donc toujours le lien, c'est sans risque.
    ajouterMessage('jarvis', texteRep, { url, texte: libelleLien });
    return fenetre;
  }

  // ---------- Cerveau ----------
  function repondre(texte, lien, estWeb = false) {
    const div = ajouterMessage('jarvis', texte, lien);
    if (estWeb && div) {
      const badge = document.createElement('div');
      badge.className = 'msg-web-badge';
      badge.textContent = '🌐 Source : Recherche web en direct';
      div.prepend(badge);
    }
    historique.push({ role: 'assistant', content: texte });
    parler(texte);
    return div;
  }

  function executerCommande(cmd) {
    const maintenant = new Date();
    switch (cmd.type) {
      case 'heure': {
        const h = maintenant.getHours();
        const m = maintenant.getMinutes();
        const heures = h === 0 ? 'minuit' : h === 12 ? 'midi' : `${h} heure${h > 1 ? 's' : ''}`;
        return repondre(`Il est ${heures}${m ? ' ' + String(m).padStart(2, '0') : ''}, Monsieur.`);
      }
      case 'date': {
        const d = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        return repondre(`Nous sommes le ${d}, Monsieur.`);
      }
      case 'minuteur': {
        if (!cmd.secondes) return repondre('Pour combien de temps, Monsieur ? Dites par exemple : minuteur de 5 minutes.');
        if (cmd.secondes > 24 * 3600) return repondre('Je me limite à 24 heures, Monsieur.');
        lancerMinuteur(cmd.secondes);
        return repondre(`Minuteur réglé sur ${C.formaterDuree(cmd.secondes)}, Monsieur.`);
      }
      case 'minuteur-stop':
        if (minuteurId || alarmeId || !boiteMinuteur.hidden) {
          arreterMinuteur();
          return repondre('Minuteur arrêté, Monsieur.');
        }
        return repondre('Aucun minuteur en cours, Monsieur.');
      case 'google': {
        if (!cmd.requete) return repondre('Que dois-je chercher sur Google, Monsieur ?');
        const url = C.urlGoogle(cmd.requete);
        const msg = `Je lance une recherche Google pour « ${cmd.requete} », Monsieur.`;
        ouvrir(url, msg, 'Ouvrir Google ↗');
        historique.push({ role: 'assistant', content: msg });
        return parler(msg);
      }
      case 'youtube': {
        const url = C.urlYoutube(cmd.requete);
        const msg = cmd.requete ? `Je cherche « ${cmd.requete} » sur YouTube, Monsieur.` : 'J\'ouvre YouTube, Monsieur.';
        ouvrir(url, msg, 'Ouvrir YouTube ↗');
        historique.push({ role: 'assistant', content: msg });
        return parler(msg);
      }
      case 'site': {
        const msg = `J'ouvre ${cmd.url.replace('https://', '')}, Monsieur.`;
        ouvrir(cmd.url, msg, 'Ouvrir ↗');
        return parler(msg);
      }
      case 'effacer':
        journal.innerHTML = '';
        historique.length = 0;
        return repondre('Conversation effacée, Monsieur.');
      case 'silence':
        taire();
        return Promise.resolve();
    }
    return null;
  }

  let requeteEnCours = null;
  async function demanderIA() {
    if (requeteEnCours) requeteEnCours.abort();
    const ctrl = new AbortController();
    requeteEnCours = ctrl;
    const attente = ajouterMessage('jarvis', 'Analyse et recherche en cours…');
    attente.classList.add('attente');
    Reacteur.setMode('reflexion');
    setStatut('Recherche & réflexion…', true);
    try {
      const forceWeb = $('opt-recherche-web') ? $('opt-recherche-web').checked : true;
      const headers = { 'Content-Type': 'application/json' };
      const token = lireStockage('jarvis-auth-token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: historique.slice(-20),
          forceWebSearch: forceWeb,
        }),
        signal: ctrl.signal,
      });
      const data = await r.json();
      attente.remove();
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      if (Reacteur.getMode() === 'reflexion') Reacteur.setMode('repos');
      setStatut('');
      return repondre(data.reply, null, !!data.webSearch);
    } catch (e) {
      attente.remove();
      if (e.name === 'AbortError') return;
      Reacteur.setMode('repos');
      setStatut('');
      return repondre('Je ne parviens pas à joindre le serveur, Monsieur.');
    } finally {
      if (requeteEnCours === ctrl) requeteEnCours = null;
    }
  }

  function traiter(texte) {
    texte = texte.trim();
    if (!texte) return;
    taire();
    ajouterMessage('user', texte);
    historique.push({ role: 'user', content: texte });
    const cmd = C.analyser(texte);
    const resultat = cmd && executerCommande(cmd);
    if (resultat) return resultat;
    return demanderIA();
  }

  // ---------- Événements ----------
  $('formulaire').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = entree.value;
    entree.value = '';
    traiter(t);
  });
  $('reacteur').addEventListener('click', basculerMicro);
  btnMicro.addEventListener('click', basculerMicro);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      basculerMicro();
    }
    if (e.key === 'Escape') {
      taire();
      if (reco) {
        veutEcouter = false;
        reco.abort();
      }
    }
  });

  function mettreAJourStatutIA(s) {
    const p = $('etat-ia');
    if (s.ia === 'gemini') {
      p.textContent = 'IA : Gemini';
      p.className = 'pastille ok';
      p.title = 'Modèle : ' + s.model + ' (cliquez pour modifier la clé)';
    } else if (s.ia === 'claude') {
      p.textContent = 'IA : Claude';
      p.className = 'pastille ok';
      p.title = 'Modèle : ' + s.model + ' (cliquez pour modifier la clé)';
    } else {
      p.textContent = 'IA : hors ligne';
      p.className = 'pastille off';
      p.title = 'Cliquez ici pour renseigner votre clé API Gemini ou Claude';
    }
    const menuIa = $('menu-statut-ia');
    if (menuIa) {
      menuIa.textContent = s.ia === 'gemini' ? 'Gemini (' + s.model + ')' : s.ia === 'claude' ? 'Claude (' + s.model + ')' : 'Hors-ligne';
      menuIa.style.color = s.ia !== 'hors-ligne' ? 'var(--cyan)' : 'var(--alerte)';
    }
  }

  fetch('/api/status')
    .then((r) => r.json())
    .then(mettreAJourStatutIA)
    .catch(() => { $('etat-ia').textContent = 'IA : ?'; });

  // ---------- Menu Latéral HUD ----------
  const menuLateral = $('menu-lateral');
  const btnOuvrirMenu = $('btn-ouvrir-menu');
  const btnFermerMenu = $('btn-fermer-menu');
  const overlayMenu = $('menu-overlay');

  function ouvrirMenu() { if (menuLateral) menuLateral.hidden = false; }
  function fermerMenu() { if (menuLateral) menuLateral.hidden = true; }

  if (btnOuvrirMenu) btnOuvrirMenu.addEventListener('click', ouvrirMenu);
  if (btnFermerMenu) btnFermerMenu.addEventListener('click', fermerMenu);
  if (overlayMenu) overlayMenu.addEventListener('click', fermerMenu);

  // Commandes rapides dans le menu
  document.querySelectorAll('.btn-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd) {
        fermerMenu();
        traiter(cmd);
      }
    });
  });

  // Réglages sliders audio
  const sliderVitesse = $('reglage-vitesse');
  const affVitesse = $('valeur-vitesse');
  if (sliderVitesse && affVitesse) {
    sliderVitesse.value = reglageVitesse;
    affVitesse.textContent = reglageVitesse.toFixed(2) + 'x';
    sliderVitesse.addEventListener('input', () => {
      reglageVitesse = parseFloat(sliderVitesse.value);
      affVitesse.textContent = reglageVitesse.toFixed(2) + 'x';
      ecrireStockage('jarvis-vitesse', reglageVitesse);
    });
  }

  const sliderPitch = $('reglage-pitch');
  const affPitch = $('valeur-pitch');
  if (sliderPitch && affPitch) {
    sliderPitch.value = reglagePitch;
    affPitch.textContent = reglagePitch.toFixed(2);
    sliderPitch.addEventListener('input', () => {
      reglagePitch = parseFloat(sliderPitch.value);
      affPitch.textContent = reglagePitch.toFixed(2);
      ecrireStockage('jarvis-pitch', reglagePitch);
    });
  }

  // Effacer la conversation
  const btnEffacerTout = $('btn-effacer-tout');
  if (btnEffacerTout) {
    btnEffacerTout.addEventListener('click', () => {
      journal.innerHTML = '';
      historique.length = 0;
      fermerMenu();
      repondre('Toutes les données de conversation ont été effacées, Monsieur.');
    });
  }

  // Télécharger l'historique
  const btnTelecharger = $('btn-telecharger-journal');
  if (btnTelecharger) {
    btnTelecharger.addEventListener('click', () => {
      if (!historique.length) {
        alert('Aucune conversation à exporter pour le moment, Monsieur.');
        return;
      }
      const texte = historique
        .map((m) => `[${m.role === 'user' ? 'VOUS' : 'JARVIS'}] : ${m.content}`)
        .join('\n\n');
      const blob = new Blob([texte], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-conversation-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Bouton clé API dans le menu
  const menuBtnCle = $('menu-btn-cle');
  if (menuBtnCle) {
    menuBtnCle.addEventListener('click', () => {
      fermerMenu();
      ouvrirModal();
    });
  }

  // Recherche Web toggle persistant
  const optWeb = $('opt-recherche-web');
  if (optWeb) {
    const memWeb = lireStockage('jarvis-web');
    if (memWeb !== null) optWeb.checked = memWeb === 'true';
    optWeb.addEventListener('change', () => {
      ecrireStockage('jarvis-web', optWeb.checked ? 'true' : 'false');
    });
  }

  // ---------- Modal Configuration Clé API ----------
  const modal = $('modal-cle');
  const btnConfig = $('btn-config-cle');
  const btnFermer = $('modal-fermer');
  const inputCle = $('input-cle-api');
  const btnSauvegarder = $('btn-sauvegarder-cle');
  const msgModal = $('modal-message');

  function ouvrirModal() {
    if (!modal) return;
    modal.hidden = false;
    msgModal.textContent = '';
    msgModal.className = 'modal-msg';
    inputCle.value = '';
    inputCle.focus();
  }

  function fermerModal() {
    if (modal) modal.hidden = true;
  }

  if (btnConfig) btnConfig.addEventListener('click', ouvrirModal);
  if ($('etat-ia')) {
    $('etat-ia').style.cursor = 'pointer';
    $('etat-ia').addEventListener('click', ouvrirModal);
  }
  if (btnFermer) btnFermer.addEventListener('click', fermerModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fermerModal();
    });
  }

  if (btnSauvegarder) {
    btnSauvegarder.addEventListener('click', async () => {
      const cle = inputCle.value.trim();
      if (!cle) {
        msgModal.textContent = 'Veuillez saisir ou coller votre clé API.';
        msgModal.className = 'modal-msg erreur';
        return;
      }
      btnSauvegarder.disabled = true;
      msgModal.textContent = 'Enregistrement et test en cours…';
      msgModal.className = 'modal-msg';

      try {
        const res = await fetch('/api/set-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: cle }),
        });
        const data = await res.json();
        if (data.ok) {
          msgModal.textContent = '✅ Clé ' + (data.provider === 'gemini' ? 'Gemini' : 'Claude') + ' enregistrée et opérationnelle !';
          msgModal.className = 'modal-msg succes';
          parler('Clé ' + (data.provider === 'gemini' ? 'Gemini' : 'Claude') + ' activée, Monsieur.');
          const s = await (await fetch('/api/status')).json();
          mettreAJourStatutIA(s);
          setTimeout(fermerModal, 1500);
        } else {
          msgModal.textContent = 'Erreur : ' + (data.error || 'Impossible d\'enregistrer la clé.');
          msgModal.className = 'modal-msg erreur';
        }
      } catch (err) {
        msgModal.textContent = 'Erreur réseau : ' + err.message;
        msgModal.className = 'modal-msg erreur';
      } finally {
        btnSauvegarder.disabled = false;
      }
    });
  }

  // ---------- Authentification & Gestion de Session ----------
  let utilisateurCourant = null;
  const modalAuth = $('modal-auth');
  const btnOuvrirAuth = $('btn-connexion');
  const btnFermerAuth = $('auth-modal-fermer');
  const ongletConnexion = $('onglet-connexion');
  const ongletInscription = $('onglet-inscription');
  const titreAuthModal = $('auth-modal-titre');
  const formAuth = $('form-auth');
  const inputIdentifiant = $('auth-identifiant');
  const inputMotDePasse = $('auth-motdepasse');
  const btnAuthValider = $('btn-auth-valider');
  const msgAuth = $('auth-message');
  const hudConnecte = $('hud-connecte');
  const labelNomUser = $('nom-utilisateur');
  const btnDeconnexion = $('btn-deconnexion');
  const menuNomUser = $('menu-nom-utilisateur');
  const menuBtnAuth = $('menu-btn-auth');

  let modeAuth = 'login'; // 'login' ou 'register'

  function majInterfaceUtilisateur(user) {
    utilisateurCourant = user;
    if (user && user.username) {
      if (btnOuvrirAuth) btnOuvrirAuth.hidden = true;
      if (hudConnecte) hudConnecte.hidden = false;
      if (labelNomUser) labelNomUser.textContent = `👤 ${user.username}`;
      if (menuNomUser) menuNomUser.textContent = user.username;
      if (menuBtnAuth) menuBtnAuth.textContent = '🚪 Se déconnecter';
    } else {
      if (btnOuvrirAuth) btnOuvrirAuth.hidden = false;
      if (hudConnecte) hudConnecte.hidden = true;
      if (labelNomUser) labelNomUser.textContent = '👤 Invité';
      if (menuNomUser) menuNomUser.textContent = 'Non connecté';
      if (menuBtnAuth) menuBtnAuth.textContent = '👤 Connexion / Inscription';
    }
  }

  function ouvrirModalAuth(mode = 'login') {
    if (!modalAuth) return;
    modeAuth = mode;
    modalAuth.hidden = false;
    msgAuth.textContent = '';
    msgAuth.className = 'modal-msg';
    basculerModeAuth(mode);
    if (inputIdentifiant) {
      inputIdentifiant.value = '';
      inputIdentifiant.focus();
    }
    if (inputMotDePasse) inputMotDePasse.value = '';
  }

  function fermerModalAuth() {
    if (modalAuth) modalAuth.hidden = true;
  }

  function basculerModeAuth(mode) {
    modeAuth = mode;
    msgAuth.textContent = '';
    msgAuth.className = 'modal-msg';
    if (mode === 'login') {
      ongletConnexion?.classList.add('actif');
      ongletInscription?.classList.remove('actif');
      if (titreAuthModal) titreAuthModal.textContent = 'Connexion au Système';
      if (btnAuthValider) btnAuthValider.textContent = 'Se connecter';
    } else {
      ongletInscription?.classList.add('actif');
      ongletConnexion?.classList.remove('actif');
      if (titreAuthModal) titreAuthModal.textContent = 'Création de Compte';
      if (btnAuthValider) btnAuthValider.textContent = 'Créer mon compte';
    }
  }

  async function verifierSessionExistante() {
    const token = lireStockage('jarvis-auth-token');
    if (!token) {
      majInterfaceUtilisateur(null);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.authenticated && data.user) {
        majInterfaceUtilisateur(data.user);
      } else {
        ecrireStockage('jarvis-auth-token', '');
        majInterfaceUtilisateur(null);
      }
    } catch {
      majInterfaceUtilisateur(null);
    }
  }

  if (btnOuvrirAuth) btnOuvrirAuth.addEventListener('click', () => ouvrirModalAuth('login'));
  if (btnFermerAuth) btnFermerAuth.addEventListener('click', fermerModalAuth);
  if (modalAuth) {
    modalAuth.addEventListener('click', (e) => {
      if (e.target === modalAuth) fermerModalAuth();
    });
  }

  if (ongletConnexion) ongletConnexion.addEventListener('click', () => basculerModeAuth('login'));
  if (ongletInscription) ongletInscription.addEventListener('click', () => basculerModeAuth('register'));

  if (menuBtnAuth) {
    menuBtnAuth.addEventListener('click', () => {
      fermerMenu();
      if (utilisateurCourant) {
        deconnecterSession();
      } else {
        ouvrirModalAuth('login');
      }
    });
  }

  async function deconnecterSession() {
    const token = lireStockage('jarvis-auth-token');
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    ecrireStockage('jarvis-auth-token', '');
    majInterfaceUtilisateur(null);
    ajouterMessage('jarvis', 'Session fermée, Monsieur. Mode invité activé.');
    parler('Session fermée, Monsieur.');
  }

  if (btnDeconnexion) btnDeconnexion.addEventListener('click', deconnecterSession);

  if (formAuth) {
    formAuth.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = inputIdentifiant.value.trim();
      const password = inputMotDePasse.value;
      if (!username || !password) return;

      btnAuthValider.disabled = true;
      msgAuth.textContent = modeAuth === 'login' ? 'Connexion en cours…' : 'Création du compte…';
      msgAuth.className = 'modal-msg';

      const endpoint = modeAuth === 'login' ? '/api/auth/login' : '/api/auth/register';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (data.ok && data.token) {
          ecrireStockage('jarvis-auth-token', data.token);
          majInterfaceUtilisateur(data.user);
          const bienvenue = modeAuth === 'login'
            ? `Bienvenue de retour, Monsieur ${data.user.username}.`
            : `Compte initialisé. Ravi de vous rencontrer, Monsieur ${data.user.username}.`;
          msgAuth.textContent = '✅ ' + bienvenue;
          msgAuth.className = 'modal-msg succes';
          ajouterMessage('jarvis', bienvenue);
          parler(bienvenue);
          setTimeout(fermerModalAuth, 1200);
        } else {
          msgAuth.textContent = 'Erreur : ' + (data.error || 'Identifiants invalides');
          msgAuth.className = 'modal-msg erreur';
        }
      } catch (err) {
        msgAuth.textContent = 'Erreur de connexion : ' + err.message;
        msgAuth.className = 'modal-msg erreur';
      } finally {
        btnAuthValider.disabled = false;
      }
    });
  }

  // Vérifier la session active au chargement
  verifierSessionExistante();

  if (!SR) btnMicro.title = 'Reconnaissance vocale non supportée par ce navigateur';
  ajouterMessage('jarvis', 'Bonjour Monsieur. J.A.R.V.I.S. en ligne. Touchez le réacteur pour me parler, ou ouvrez le MENU.');
  if (location.protocol === 'file:') {
    ajouterMessage('jarvis', 'Attention Monsieur : cette page a été ouverte directement depuis le disque. Le micro et l\'IA ne fonctionnent pas ainsi. Lancez plutôt demarrer.bat (Windows) ou demarrer.sh (Mac/Linux), puis utilisez l\'adresse http://localhost:3000.');
  }

  // Exposé pour les tests
  window.Jarvis = { traiter, parler, historique };
})();
