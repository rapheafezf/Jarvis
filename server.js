// Serveur Jarvis : fichiers statiques + /api/chat (Gemini ou Claude si clé présente, sinon mode hors ligne).
// Aucune dépendance : node server.js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const isVercel = Boolean(process.env.VERCEL);
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = isVercel ? path.join('/tmp', 'jarvis-data') : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function initDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
    if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf8');
  } catch (e) {
    console.error('[auth] Erreur création data dir :', e.message);
  }
}
initDataDir();

function chargerUtilisateurs() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function sauvegarderUtilisateurs(utilisateurs) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(utilisateurs, null, 2), 'utf8');
  } catch (e) {
    console.error('[auth] Erreur sauvegarde utilisateurs :', e.message);
  }
}

function chargerSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function sauvegarderSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[auth] Erreur sauvegarde sessions :', e.message);
  }
}

function hasherMotDePasse(motDePasse, sel) {
  return crypto.scryptSync(motDePasse, sel, 64).toString('hex');
}

function inscrireUtilisateur(username, password) {
  const nom = String(username || '').trim();
  const mdp = String(password || '');
  if (nom.length < 2) throw new Error("Le nom d'utilisateur doit contenir au moins 2 caractères.");
  if (mdp.length < 4) throw new Error('Le mot de passe doit contenir au moins 4 caractères.');

  const utilisateurs = chargerUtilisateurs();
  if (utilisateurs.some((u) => u.username.toLowerCase() === nom.toLowerCase())) {
    throw new Error("Ce nom d'utilisateur est déjà pris.");
  }

  const sel = crypto.randomBytes(16).toString('hex');
  const hash = hasherMotDePasse(mdp, sel);
  const nouvelUtilisateur = {
    id: 'usr_' + crypto.randomBytes(8).toString('hex'),
    username: nom,
    salt: sel,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  };

  utilisateurs.push(nouvelUtilisateur);
  sauvegarderUtilisateurs(utilisateurs);

  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  const sessions = chargerSessions();
  sessions[token] = {
    userId: nouvelUtilisateur.id,
    username: nouvelUtilisateur.username,
    createdAt: Date.now(),
  };
  sauvegarderSessions(sessions);

  return {
    user: { id: nouvelUtilisateur.id, username: nouvelUtilisateur.username },
    token,
  };
}

function connecterUtilisateur(username, password) {
  const nom = String(username || '').trim();
  const mdp = String(password || '');
  const utilisateurs = chargerUtilisateurs();
  const utilisateur = utilisateurs.find((u) => u.username.toLowerCase() === nom.toLowerCase());

  if (!utilisateur) throw new Error('Identifiants incorrects.');

  const hashTest = hasherMotDePasse(mdp, utilisateur.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hashTest, 'hex'), Buffer.from(utilisateur.passwordHash, 'hex'))) {
    throw new Error('Identifiants incorrects.');
  }

  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  const sessions = chargerSessions();
  sessions[token] = {
    userId: utilisateur.id,
    username: utilisateur.username,
    createdAt: Date.now(),
  };
  sauvegarderSessions(sessions);

  return {
    user: { id: utilisateur.id, username: utilisateur.username },
    token,
  };
}

function obtenirUtilisateurDepuisRequete(req) {
  const authHeader = req.headers['authorization'] || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = req.headers['cookie'] || '';
    const m = cookies.match(/jarvis_token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1].trim());
  }
  if (!token) return null;

  const sessions = chargerSessions();
  const session = sessions[token];
  if (!session) return null;

  return {
    id: session.userId,
    username: session.username,
    token,
  };
}

function deconnecterUtilisateur(token) {
  if (!token) return;
  const sessions = chargerSessions();
  if (sessions[token]) {
    delete sessions[token];
    sauvegarderSessions(sessions);
  }
}

const SYSTEM = [
  'Tu es J.A.R.V.I.S., l\'assistant IA de Tony Stark, au service de ton utilisateur.',
  'Réponds TOUJOURS en français, avec un ton poli, posé et légèrement pince-sans-rire.',
  'Appelle l\'utilisateur « Monsieur » (ou « Madame » s\'il le précise).',
  'Tes réponses sont lues à voix haute : 1 à 3 phrases courtes, pas de markdown, pas de listes, pas d\'emoji.',
].join(' ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function envoyerJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function lireCorps(req, limite = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (c) => {
      taille += c.length;
      if (taille > limite) {
        reject(new Error('corps trop grand'));
        req.destroy();
      } else morceaux.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', reject);
  });
}

function getCredentials() {
  if (process.env.GEMINI_API_KEY) {
    return { provider: 'gemini', key: process.env.GEMINI_API_KEY.trim() };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'claude', key: process.env.ANTHROPIC_API_KEY.trim() };
  }
  const chemins = [path.join(__dirname, "cle-api.txt"), path.join("/tmp", "cle-api.txt")];
  for (const fichierCle of chemins) {
    if (fs.existsSync(fichierCle)) {
      try {
        const cle = fs.readFileSync(fichierCle, "utf8").trim();
        if (cle) {
          if (cle.startsWith("sk-ant-")) return { provider: "claude", key: cle };
          return { provider: "gemini", key: cle };
        }
      } catch {}
    }
  }
  return { provider: null, key: '' };
}

// Garde un historique valide pour l'API : rôles alternés, commence par "user", textes non vides.
function nettoyerHistorique(messages) {
  if (!Array.isArray(messages)) return [];
  const propres = [];
  for (const m of messages.slice(-20)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const texte = String(m.content || '').slice(0, 4000).trim();
    if (!texte) continue;
    const dernier = propres[propres.length - 1];
    if (dernier && dernier.role === m.role) dernier.content += '\n' + texte;
    else propres.push({ role: m.role, content: texte });
  }
  while (propres.length && propres[0].role !== 'user') propres.shift();
  return propres;
}

function reponseHorsLigne(texte) {
  const t = texte.toLowerCase();
  if (/bonjour|salut|hello|coucou|bonsoir/.test(t)) return 'Bonjour Monsieur. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?';
  if (/comment (ça|ca) va|tu vas bien/.test(t)) return 'Mes circuits se portent à merveille, Monsieur. Merci de vous en soucier.';
  if (/qui es[- ]tu|tu es qui|ton nom|présente|presente/.test(t)) return 'Je suis Jarvis, Monsieur : Just A Rather Very Intelligent System. À votre service.';
  if (/merci/.test(t)) return 'Je vous en prie, Monsieur. C\'est toujours un plaisir.';
  if (/blague|drôle|drole/.test(t)) return 'Pourquoi les plongeurs plongent-ils toujours en arrière ? Parce que sinon, ils tombent dans le bateau, Monsieur.';
  if (/aide|que sais[- ]tu faire|commandes/.test(t)) return 'Je peux vous donner l\'heure et la date, lancer un minuteur, chercher sur Google ou sur YouTube, et discuter avec vous, Monsieur.';
  return 'Mon module d\'intelligence artificielle est hors ligne, Monsieur. Ajoutez une clé API Gemini (ou Claude) dans cle-api.txt pour que je puisse répondre à cela. En attendant, je gère l\'heure, les minuteurs, Google et YouTube.';
}

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
].filter(Boolean);

// Détecte si la question nécessite une recherche internet
function necessiteRechercheWeb(texte) {
  const t = texte.toLowerCase();
  if (/^(bonjour|salut|coucou|hello|bonsoir|comment (ça|ca) va|qui es[- ]tu|merci|raconte[- ]moi une blague)/.test(t)) {
    return false;
  }
  return (
    /m[ée]t[ée]o|temps fait[- ]il|temp[ée]rature|degr[ée]s?|pleuv|soleil|climat/.test(t) ||
    /actualit[ée]|nouvelles?|infos?|dernier|r[ée]cent|aujourd|hier|demain/.test(t) ||
    /match|score|gagn[ée]|vainqueur|classement|foot|champion|ligue|prix|cours/.test(t) ||
    /qui est|qui sont|c['’]est quoi|qu['’]est[- ]ce que|o[uù] se trouve|capitale de/.test(t) ||
    /cherche|recherche|trouve|donne[- ]moi des infos|que sais[- ]tu sur/.test(t) ||
    /\b(2024|2025|2026)\b/.test(t)
  );
}

async function rechercherSurLeWeb(question) {
  const q = question.toLowerCase();
  const infos = [];

  // Météo en direct via wttr.in
  if (/m[ée]t[ée]o|temps fait[- ]il|temp[ée]rature|degr[ée]s?|climat/.test(q)) {
    let ville = 'Paris';
    const m = q.match(/(?:[aà]|en|pour|sur|de)\s+([a-zA-Zà-ÿ\-]+)/i);
    if (m && m[1] && !/france|monde|demain|aujourd|temps|meteo|ce matin|ce soir/.test(m[1].toLowerCase())) {
      ville = m[1];
    }
    try {
      const r = await fetch(`https://wttr.in/${encodeURIComponent(ville)}?format=%l:+%C,+%t+(ressenti+%f),+vent+%w,+humidite+%h`, {
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const text = await r.text();
        if (text && !text.includes('Unknown') && !text.includes('404')) {
          infos.push(`Météo en direct pour ${ville} : ${text.trim()}`);
        }
      }
    } catch {}
  }

  // Actualités via Google News RSS
  if (/actualit[ée]|nouvelles?|infos?|titres?|match|score|politique|guerre/.test(q)) {
    try {
      const cleanQ = question.replace(/jarvis|s'il te plaît|s'il vous plaît|peux-tu|quelles sont les/gi, '').trim();
      const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanQ || 'France')}&hl=fr&gl=FR&ceid=FR:fr`, {
        signal: AbortSignal.timeout(3500),
      });
      if (r.ok) {
        const xml = await r.text();
        const titres = [...xml.matchAll(/<title>([^<]+)<\/title>/g)]
          .map((m) => m[1])
          .filter((t) => !t.includes('Google Actualités') && !t.includes(' - Google'))
          .slice(0, 3);
        if (titres.length) {
          infos.push(`Titres récents d'actualité :\n- ${titres.join('\n- ')}`);
        }
      }
    } catch {}
  }

  // Recherche générale web via DuckDuckGo HTML
  try {
    const cleanQ = question.replace(/jarvis|s'il te plaît|s'il vous plaît|peux-tu|cherche|recherche|trouve|donne-moi/gi, '').trim();
    if (cleanQ) {
      const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQ)}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (r.ok) {
        const html = await r.text();
        const re = /class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        let count = 0;
        while ((m = re.exec(html)) !== null && count < 3) {
          const snippet = m[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&#x27;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
          if (snippet) {
            infos.push(`Information web : ${snippet}`);
            count++;
          }
        }
      }
    }
  } catch {}

  return infos.join('\n\n');
}

async function demanderGemini(messages, apiKey, webContext = '', customSystem = '') {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  let systemPrompt = customSystem || SYSTEM;
  if (webContext) {
    systemPrompt += `\n\nVoici des données en direct trouvées sur internet pour t'aider à répondre avec une précision totale :\n${webContext}`;
  }

  const payload = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      maxOutputTokens: 300,
      temperature: 0.7,
    },
  };

  let dernierErreur = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 404 || r.status === 503) {
          dernierErreur = new Error((data.error && data.error.message) || `Modèle ${model} indisponible (${r.status})`);
          continue;
        }
        throw new Error((data.error && data.error.message) || `HTTP ${r.status}`);
      }
      const candidate = data.candidates && data.candidates[0];
      const parts = candidate?.content?.parts || [];
      const texte = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
      return texte || "Je n'ai pas de réponse à cela, Monsieur.";
    } catch (e) {
      dernierErreur = e;
      if (e.message && (e.message.includes('404') || e.message.includes('503') || e.message.includes('not found') || e.message.includes('unavailable'))) continue;
      throw e;
    }
  }
  throw dernierErreur || new Error('Erreur Gemini');
}

async function demanderClaude(messages, apiKey, webContext = '', customSystem = '') {
  const model = process.env.JARVIS_MODEL || 'claude-sonnet-5-5';
  const url = 'https://api.anthropic.com/v1/messages';
  let systemPrompt = customSystem || SYSTEM;
  if (webContext) {
    systemPrompt += `\n\nDonnées web en direct :\n${webContext}`;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 300, system: systemPrompt, messages }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + r.status);
  const texte = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  return texte || "Je n'ai pas de réponse à cela, Monsieur.";
}

async function gererChat(req, res) {
  // Sécurité : l'accès est strictement réservé aux utilisateurs ayant créé un compte
  const user = obtenirUtilisateurDepuisRequete(req);
  if (!user) {
    return envoyerJson(res, 401, {
      ok: false,
      error: 'Accès refusé. Veuillez créer un compte ou vous connecter pour accéder à J.A.R.V.I.S.',
    });
  }

  let corps;
  try {
    corps = JSON.parse(await lireCorps(req));
  } catch {
    return envoyerJson(res, 400, { error: 'JSON invalide' });
  }
  const messages = nettoyerHistorique(corps.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return envoyerJson(res, 400, { error: 'Aucun message utilisateur' });
  }
  const question = messages[messages.length - 1].content;
  const { provider, key } = getCredentials();
  if (!key) return envoyerJson(res, 200, { reply: reponseHorsLigne(question), mode: 'hors-ligne', user: user.username });

  // Personnalisation en fonction de l'utilisateur connecté
  const customSystem = [
    `Tu es J.A.R.V.I.S., l'assistant IA de Tony Stark, actuellement au service de votre interlocuteur : ${user.username}.`,
    `Réponds TOUJOURS en français, avec un ton poli, posé et légèrement pince-sans-rire.`,
    `Appelle l'utilisateur « Monsieur ${user.username} » (ou « Madame » s'il le précise).`,
    `Tes réponses sont lues à voix haute : 1 à 3 phrases courtes, pas de markdown, pas de listes, pas d'emoji.`,
  ].join(' ');

  let webContext = '';
  let webRecherche = false;
  if (corps.forceWebSearch || necessiteRechercheWeb(question)) {
    try {
      webContext = await rechercherSurLeWeb(question);
      if (webContext) webRecherche = true;
    } catch (err) {
      console.warn('[jarvis] échec recherche web :', err.message);
    }
  }

  try {
    const reply = provider === 'gemini'
      ? await demanderGemini(messages, key, webContext, customSystem)
      : await demanderClaude(messages, key, webContext, customSystem);
    return envoyerJson(res, 200, { reply, mode: provider, webSearch: webRecherche, user: user ? user.username : null });
  } catch (e) {
    console.error('[jarvis] erreur IA :', e.message);
    return envoyerJson(res, 200, {
      reply: 'Je n\'arrive pas à joindre mes serveurs, Monsieur. ' + reponseHorsLigne(question),
      mode: 'erreur',
      error: e.message,
    });
  }
}

async function gererCleApi(req, res) {
  const user = obtenirUtilisateurDepuisRequete(req);
  if (!user) {
    return envoyerJson(res, 401, { error: 'Accès refusé. Authentification requise.' });
  }
  try {
    const data = JSON.parse(await lireCorps(req));
    const cle = String(data.key || '').trim();
    if (!cle) return envoyerJson(res, 400, { error: 'Clé vide' });
    const fichierCle = isVercel ? path.join('/tmp', 'cle-api.txt') : path.join(__dirname, 'cle-api.txt');
    fs.writeFileSync(fichierCle, cle, 'utf8');
    const { provider } = getCredentials();
    return envoyerJson(res, 200, { ok: true, provider });
  } catch (e) {
    return envoyerJson(res, 500, { error: e.message });
  }
}

function servirFichier(req, res) {
  let chemin;
  try {
    chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (chemin === '/') chemin = '/index.html';
  const fichier = path.normalize(path.join(PUBLIC, chemin));
  if (!fichier.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('Interdit');
  }
  fs.readFile(fichier, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function requestHandler(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {}

  // --- Routes d'authentification ---
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const data = JSON.parse(await lireCorps(req));
      const result = inscrireUtilisateur(data.username, data.password);
      return envoyerJson(res, 200, { ok: true, ...result });
    } catch (e) {
      return envoyerJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const data = JSON.parse(await lireCorps(req));
      const result = connecterUtilisateur(data.username, data.password);
      return envoyerJson(res, 200, { ok: true, ...result });
    } catch (e) {
      return envoyerJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = obtenirUtilisateurDepuisRequete(req);
    if (!user) return envoyerJson(res, 200, { authenticated: false });
    return envoyerJson(res, 200, { authenticated: true, user: { id: user.id, username: user.username } });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = obtenirUtilisateurDepuisRequete(req);
    if (user) deconnecterUtilisateur(user.token);
    return envoyerJson(res, 200, { ok: true });
  }

  // --- Routes IA et Clé ---
  if (pathname === '/api/chat' && req.method === 'POST') return void gererChat(req, res);
  if (pathname === '/api/set-key' && req.method === 'POST') return void gererCleApi(req, res);
  if (pathname === '/api/status') {
    const { provider } = getCredentials();
    const model = provider === 'gemini'
      ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite')
      : provider === 'claude'
      ? (process.env.JARVIS_MODEL || 'claude-sonnet-5-5')
      : null;
    return envoyerJson(res, 200, { ia: provider || 'hors-ligne', model, provider: provider || 'hors-ligne' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  servirFichier(req, res);
}

const serveur = http.createServer(requestHandler);

function ouvrirNavigateur(url) {
  const { spawn } = require('node:child_process');
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch { /* pas de navigateur : l'URL est affichée dans la console */ }
}

// Démarre sur PORT ; si le port est déjà pris, essaie les 10 suivants.
function demarrer(port, essais = 10) {
  serveur.once('error', (e) => {
    serveur.removeAllListeners('listening');
    if (e.code === 'EADDRINUSE' && essais > 0) {
      console.log(`Port ${port} déjà utilisé, essai sur ${port + 1}…`);
      return demarrer(port + 1, essais - 1);
    }
    console.error('Impossible de démarrer le serveur :', e.message);
    process.exit(1);
  });
  serveur.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    const { provider } = getCredentials();
    const model = provider === 'gemini' ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : (process.env.JARVIS_MODEL || 'claude-sonnet-5-5');
    console.log(`J.A.R.V.I.S. en ligne : ${url}`);
    if (provider === 'gemini') {
      console.log(`IA : Gemini (${model})`);
    } else if (provider === 'claude') {
      console.log(`IA : Claude (${model})`);
    } else {
      console.log('IA : mode hors ligne (définissez GEMINI_API_KEY ou créez cle-api.txt pour activer Gemini)');
    }
    console.log('Ouvrez cette adresse dans Chrome ou Edge. Ctrl+C pour arrêter.');
    if (process.argv.includes('--ouvrir')) ouvrirNavigateur(url);
  });
}

if (require.main === module && !isVercel) demarrer(PORT);

const handler = (req, res) => requestHandler(req, res);
handler.serveur = serveur;
handler.requestHandler = requestHandler;
handler.nettoyerHistorique = nettoyerHistorique;
handler.reponseHorsLigne = reponseHorsLigne;
handler.getCredentials = getCredentials;
handler.inscrireUtilisateur = inscrireUtilisateur;
handler.connecterUtilisateur = connecterUtilisateur;
handler.obtenirUtilisateurDepuisRequete = obtenirUtilisateurDepuisRequete;
handler.deconnecterUtilisateur = deconnecterUtilisateur;
handler.DATA_DIR = DATA_DIR;

module.exports = handler;
