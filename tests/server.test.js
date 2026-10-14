const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const { serveur, nettoyerHistorique, getCredentials, DATA_DIR } = require('../server.js');

test('nettoyerHistorique fusionne et commence par user', () => {
  const h = nettoyerHistorique([
    { role: 'assistant', content: 'salut' },
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
    { role: 'system', content: 'pirate' },
    { role: 'assistant', content: '' },
  ]);
  assert.deepEqual(h, [{ role: 'user', content: 'a\nb' }]);
});

const fs = require('node:fs');
const path = require('node:path');
const fichierCle = path.join(__dirname, '../cle-api.txt');
const backupCle = path.join(__dirname, '../cle-api.txt.bak');
const tmpCle = path.join('/tmp', 'cle-api.txt');
const backupTmpCle = path.join('/tmp', 'cle-api.txt.testbak');
const fichierUsers = path.join(DATA_DIR, 'users.json');
const backupUsers = path.join(DATA_DIR, 'users.json.testbak');
const fichierSessions = path.join(DATA_DIR, 'sessions.json');
const backupSessions = path.join(DATA_DIR, 'sessions.json.testbak');

test('API et fichiers statiques', async (t) => {
  if (fs.existsSync(fichierCle)) fs.renameSync(fichierCle, backupCle);
  if (fs.existsSync(tmpCle)) {
    try { fs.renameSync(tmpCle, backupTmpCle); } catch {}
  }
  if (fs.existsSync(fichierUsers)) fs.copyFileSync(fichierUsers, backupUsers);
  if (fs.existsSync(fichierSessions)) fs.copyFileSync(fichierSessions, backupSessions);
  fs.writeFileSync(fichierUsers, "[]", "utf8");
  fs.writeFileSync(fichierSessions, "{}", "utf8");
  t.after(() => {
    serveur.close();
    if (fs.existsSync(backupCle)) {
      try { fs.renameSync(backupCle, fichierCle); } catch {}
    } else {
      try { fs.unlinkSync(fichierCle); } catch {}
    }
    if (fs.existsSync(backupTmpCle)) {
      try { fs.renameSync(backupTmpCle, tmpCle); } catch {}
    } else {
      try { fs.unlinkSync(tmpCle); } catch {}
    }
    if (fs.existsSync(backupUsers)) {
      try { fs.copyFileSync(backupUsers, fichierUsers); fs.unlinkSync(backupUsers); } catch {}
    } else {
      try { fs.unlinkSync(fichierUsers); } catch {}
    }
    if (fs.existsSync(backupSessions)) {
      try { fs.copyFileSync(backupSessions, fichierSessions); fs.unlinkSync(backupSessions); } catch {}
    } else {
      try { fs.unlinkSync(fichierSessions); } catch {}
    }
  });

  await new Promise((r) => serveur.listen(0, r));
  const base = 'http://127.0.0.1:' + serveur.address().port;

  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /J\.A\.R\.V\.I\.S\./);

  assert.equal((await fetch(base + '/..%2fserver.js')).status, 403);
  assert.equal((await fetch(base + '/nope.js')).status, 404);

  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.ia, 'hors-ligne');

  // Sans authentification : accès refusé (401)
  const chatSansAuth = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Bonjour' }] }),
  });
  assert.equal(chatSansAuth.status, 401);

  const setKeyVide = await fetch(base + '/api/set-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: '' }),
  });
  assert.equal(setKeyVide.status, 400);

  // --- Tests Authentification Compte ---
  // Inscription réussie
  const regRes = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'TonyStark', password: 'arc-reactor-42' }),
  });
  const regData = await regRes.json();
  assert.equal(regRes.status, 200);
  assert.equal(regData.ok, true);
  assert.equal(regData.user.username, 'TonyStark');
  assert.ok(regData.token);

  // Inscription doublon refusée
  const regDoublon = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'TonyStark', password: 'autre-password' }),
  });
  const regDoublonData = await regDoublon.json();
  assert.equal(regDoublon.status, 400);
  assert.equal(regDoublonData.ok, false);

  // Connexion mauvais mot de passe
  const logBad = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'TonyStark', password: 'mauvais-mdp' }),
  });
  assert.equal(logBad.status, 400);

  // Connexion réussie
  const logRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'TonyStark', password: 'arc-reactor-42' }),
  });
  const logData = await logRes.json();
  assert.equal(logRes.status, 200);
  assert.equal(logData.ok, true);
  assert.ok(logData.token);
  const sessionToken = logData.token;

  // Profil vérifié via token
  const meRes = await fetch(base + '/api/auth/me', {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const meData = await meRes.json();
  assert.equal(meRes.status, 200);
  assert.equal(meData.authenticated, true);
  assert.equal(meData.user.username, 'TonyStark');

  // Chat accessible UNE FOIS CONNECTÉ
  const chatAvecAuth = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Bonjour' }] }),
  });
  const chatData = await chatAvecAuth.json();
  assert.equal(chatAvecAuth.status, 200);
  assert.equal(chatData.user, 'TonyStark');
  assert.equal(chatData.mode, 'hors-ligne');

  // Configuration clé accessible UNE FOIS CONNECTÉ
  const setKeyRes = await fetch(base + '/api/set-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ key: 'AIzaSyTestGeminiKey' }),
  });
  const setKeyData = await setKeyRes.json();
  assert.equal(setKeyRes.status, 200);
  assert.equal(setKeyData.ok, true);
  try { fs.unlinkSync(fichierCle); } catch {}

  // Profil non connecté sans token
  const meAnon = await (await fetch(base + '/api/auth/me')).json();
  assert.equal(meAnon.authenticated, false);

  // Déconnexion
  const decoRes = await fetch(base + '/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const decoData = await decoRes.json();
  assert.equal(decoRes.status, 200);
  assert.equal(decoData.ok, true);

  // Profil après déconnexion
  const meApresDeco = await (await fetch(base + '/api/auth/me', {
    headers: { Authorization: `Bearer ${sessionToken}` },
  })).json();
  assert.equal(meApresDeco.authenticated, false);
});
