const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const { serveur, nettoyerHistorique, getCredentials } = require('../server.js');

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

test('API et fichiers statiques', async (t) => {
  if (fs.existsSync(fichierCle)) fs.renameSync(fichierCle, backupCle);
  t.after(() => {
    serveur.close();
    if (fs.existsSync(backupCle)) {
      try { fs.renameSync(backupCle, fichierCle); } catch {}
    } else {
      try { fs.unlinkSync(fichierCle); } catch {}
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

  const chat = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Bonjour' }] }),
  });
  const data = await chat.json();
  assert.equal(chat.status, 200);
  assert.equal(data.mode, 'hors-ligne');
  assert.match(data.reply, /Bonjour Monsieur/);

  const mauvais = await fetch(base + '/api/chat', { method: 'POST', body: '{oups' });
  assert.equal(mauvais.status, 400);

  // Test set-key
  const setKeyRes = await fetch(base + '/api/set-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'AIzaSyTestGeminiKey' }),
  });
  const setKeyData = await setKeyRes.json();
  assert.equal(setKeyRes.status, 200);
  assert.equal(setKeyData.ok, true);
  assert.equal(setKeyData.provider, 'gemini');

  const statusApres = await (await fetch(base + '/api/status')).json();
  assert.equal(statusApres.ia, 'gemini');

  // Nettoyer cle-api.txt créé par le test
  try { fs.unlinkSync(fichierCle); } catch {}

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
