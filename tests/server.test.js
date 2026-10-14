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
});
