// Test de bout en bout dans Chromium (Playwright). Micro et voix sont simulés.
// Usage : node server.js &  puis  node tests/e2e.js [url]
const assert = require('node:assert/strict');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const URL_APP = process.argv[2] || 'http://localhost:3000/';

// Faux SpeechRecognition / speechSynthesis injectés avant le chargement de la page.
function simulateurs() {
  window.__parole = [];
  window.__ouvertures = [];
  window.open = (u) => { window.__ouvertures.push(u); return null; };
  class FakeReco {
    constructor() { window.__reco = this; this.lang = ''; }
    start() { window.__recoLang = this.lang; window.__recoActive = true; setTimeout(() => this.onstart && this.onstart(), 10); }
    stop() { window.__recoActive = false; setTimeout(() => this.onend && this.onend(), 10); }
    abort() { this.stop(); }
    dire(texte) {
      this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: texte }], { isFinal: true })] });
      this.stop();
    }
  }
  window.SpeechRecognition = FakeReco;
  window.webkitSpeechRecognition = FakeReco;
  const voix = [
    { name: 'Google français', lang: 'fr-FR' },
    { name: 'Microsoft Paul - French (France)', lang: 'fr-FR' },
    { name: 'Google US English', lang: 'en-US' },
  ];
  const synth = {
    speaking: false,
    getVoices: () => voix,
    cancel() {},
    addEventListener() {},
    speak(u) {
      window.__parole.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang, pitch: u.pitch });
      setTimeout(() => u.onend && u.onend(), 30);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
}

(async () => {
  const navigateur = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 800 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.addInitScript(simulateurs);
  await page.goto(URL_APP);

  const dernier = () => page.locator('.msg.jarvis:not(.attente)').last().innerText();
  const taper = async (t) => {
    await page.fill('#entree', t);
    await page.press('#entree', 'Enter');
    await page.waitForTimeout(250);
  };

  // 1. Chargement
  await page.waitForSelector('.msg.jarvis');
  await page.waitForFunction(() => document.getElementById('etat-ia').textContent.includes('hors ligne'));
  assert.equal(await page.locator('#choix-voix option').count(), 2, 'seules les voix françaises sont listées');
  assert.match(await page.inputValue('#choix-voix'), /Paul/, 'voix masculine préférée');
  console.log('✔ chargement, voix FR (Paul) sélectionnée');

  // 2. Heure
  await taper('Quelle heure est-il ?');
  assert.match(await dernier(), /^Il est (minuit|midi|\d+ heures?)/);
  console.log('✔ heure :', (await dernier()).replace('JARVIS', '').trim());

  // 3. Minuteur de 3 s : affichage, sonnerie, annonce vocale
  await taper('Mets un minuteur de 3 secondes');
  assert.match(await dernier(), /3 secondes/);
  assert.equal(await page.isVisible('#minuteur'), true);
  await page.waitForFunction(() => document.querySelector('#minuteur').classList.contains('sonne'), null, { timeout: 6000 });
  assert.match(await dernier(), /minuteur est terminé/);
  await taper('Arrête le minuteur');
  assert.equal(await page.isVisible('#minuteur'), false);
  console.log('✔ minuteur : décompte, sonnerie, arrêt');

  // 4. Google & YouTube
  await taper('Cherche la météo à Paris sur Google');
  await taper('Mets Back in Black sur YouTube');
  const ouv = await page.evaluate(() => window.__ouvertures);
  assert.deepEqual(ouv, [
    'https://www.google.com/search?q=la%20meteo%20a%20paris',
    'https://www.youtube.com/results?search_query=back%20in%20black',
  ]);
  assert.equal(await page.locator('.msg.jarvis a[href*="youtube.com"]').count(), 1, 'lien de secours YouTube');
  console.log('✔ Google / YouTube :', ouv.join(' | '));

  // 5. IA (mode hors ligne côté serveur)
  await taper('Bonjour Jarvis');
  await page.waitForFunction(() => !document.querySelector('.msg.attente'));
  assert.match(await dernier(), /Bonjour Monsieur/);
  console.log('✔ IA :', (await dernier()).replace('JARVIS', '').trim());

  // 6. IA avec réponse simulée (comme si Claude répondait) + historique envoyé
  let corpsEnvoye;
  await page.route('**/api/chat', async (route) => {
    corpsEnvoye = JSON.parse(route.request().postData());
    await new Promise((r) => setTimeout(r, 300));
    route.fulfill({ json: { reply: 'Le Mark III est prêt, Monsieur.', mode: 'claude' } });
  });
  await taper('Prépare l\'armure');
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'reflexion', 'réacteur en mode réflexion');
  await page.waitForFunction(() => !document.querySelector('.msg.attente'));
  assert.match(await dernier(), /Mark III/);
  assert.equal(corpsEnvoye.messages.at(-1).content, 'Prépare l\'armure');
  assert.ok(corpsEnvoye.messages.length >= 3, 'historique transmis');
  await page.unroute('**/api/chat');
  console.log('✔ IA Claude simulée + historique (' + corpsEnvoye.messages.length + ' messages)');

  // 7. Micro : clic sur le réacteur -> reco fr-FR -> commande vocale
  await page.click('#reacteur');
  await page.waitForFunction(() => document.body.dataset.mode === 'ecoute');
  assert.equal(await page.evaluate(() => window.__recoLang), 'fr-FR');
  await page.evaluate(() => window.__reco.dire('quel jour sommes-nous'));
  await page.waitForTimeout(200);
  assert.match(await dernier(), /Nous sommes le/);
  console.log('✔ micro fr-FR :', (await dernier()).replace('JARVIS', '').trim());

  // 8. Mode continu : ignore sans mot de réveil
  await page.check('#opt-continu');
  await page.click('#reacteur');
  await page.waitForFunction(() => window.__recoActive);
  const avant = await page.locator('.msg').count();
  await page.evaluate(() => window.__reco.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'blabla sans mot clé' }], { isFinal: true })] }));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.msg').count(), avant, 'phrase ignorée sans « Jarvis »');
  await page.evaluate(() => window.__reco.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Jarvis quelle heure est-il' }], { isFinal: true })] }));
  await page.waitForTimeout(300);
  assert.match(await dernier(), /Il est/);
  console.log('✔ écoute continue avec mot de réveil « Jarvis »');

  // 9. Voix : tout a été prononcé en français avec la voix grave
  const parole = await page.evaluate(() => window.__parole);
  assert.ok(parole.length >= 8);
  assert.ok(parole.every((p) => p.lang === 'fr-FR' && p.pitch < 1 && /Paul/.test(p.voice)));
  console.log('✔ synthèse vocale :', parole.length, 'énoncés fr-FR, voix', parole[0].voice);

  await page.screenshot({ path: 'tests/capture-conversation.png' });

  // 10. Régression : une erreur micro reste affichée et ne relance pas l'écoute en boucle
  await page.click('#micro'); // coupe l'écoute continue
  await page.waitForFunction(() => !window.__recoActive);
  await page.click('#reacteur');
  await page.waitForFunction(() => window.__recoActive);
  await page.evaluate(() => { window.__reco.onerror({ error: 'audio-capture' }); window.__reco.stop(); });
  await page.waitForTimeout(500);
  assert.match(await page.innerText('#statut'), /Aucun micro détecté/);
  assert.equal(await page.evaluate(() => window.__recoActive), false, 'pas de relance après erreur fatale');
  console.log('✔ erreur micro affichée, pas de boucle de relance');
  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  const debord = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(debord, false, 'pas de défilement horizontal sur mobile');
  console.log('✔ affichage mobile sans débordement');

  assert.deepEqual(erreurs, [], 'aucune erreur JS');
  console.log('\nTous les tests E2E sont passés.');
  await navigateur.close();
})().catch((e) => {
  console.error('✘', e.message);
  process.exit(1);
});
