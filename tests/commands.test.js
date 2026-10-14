const test = require('node:test');
const assert = require('node:assert/strict');
const { analyser, parserDuree, formaterDuree, urlGoogle, urlYoutube } = require('../public/commands.js');

test('heure et date', () => {
  for (const p of ['Quelle heure est-il ?', 'Jarvis, donne-moi l\'heure', 'il est quelle heure'])
    assert.equal(analyser(p)?.type, 'heure', p);
  assert.equal(analyser('Quel jour sommes-nous ?')?.type, 'date');
  assert.equal(analyser('On est quel jour ?')?.type, 'date');
});

test('durées', () => {
  assert.equal(parserDuree('5 minutes'), 300);
  assert.equal(parserDuree('une minute et 30 secondes'), 90);
  assert.equal(parserDuree('deux heures'), 7200);
  assert.equal(parserDuree('10 secondes'), 10);
  assert.equal(parserDuree('1 h 15 minutes'), 4500);
  assert.equal(parserDuree('trois minutes et demie'), 210);
  assert.equal(formaterDuree(90), '1 minute et 30 secondes');
  assert.equal(formaterDuree(3600), '1 heure');
});

test('minuteur', () => {
  assert.deepEqual(analyser('Mets un minuteur de 5 minutes'), { type: 'minuteur', secondes: 300 });
  assert.deepEqual(analyser('Lance un timer de 10 secondes'), { type: 'minuteur', secondes: 10 });
  assert.deepEqual(analyser('Rappelle-moi dans 2 minutes'), { type: 'minuteur', secondes: 120 });
  assert.deepEqual(analyser('minuteur'), { type: 'minuteur', secondes: 0 });
  assert.equal(analyser('Arrête le minuteur')?.type, 'minuteur-stop');
  assert.equal(analyser('annule le timer')?.type, 'minuteur-stop');
});

test('Google', () => {
  assert.deepEqual(analyser('Cherche la météo à Paris sur Google'), { type: 'google', requete: 'la meteo a paris' });
  assert.deepEqual(analyser('Recherche recette de crêpes'), { type: 'google', requete: 'recette de crepes' });
  assert.deepEqual(analyser('Google Tony Stark'), { type: 'google', requete: 'tony stark' });
  assert.equal(urlGoogle('a b&c'), 'https://www.google.com/search?q=a%20b%26c');
});

test('YouTube', () => {
  assert.deepEqual(analyser('Mets AC/DC Back in Black sur YouTube'), { type: 'youtube', requete: 'ac/dc back in black' });
  assert.deepEqual(analyser('Joue de la musique sur YouTube'), { type: 'youtube', requete: 'de la musique' });
  assert.deepEqual(analyser('Ouvre YouTube'), { type: 'youtube', requete: '' });
  assert.deepEqual(analyser('cherche des tutos Python sur youtube'), { type: 'youtube', requete: 'des tutos python' });
  assert.equal(urlYoutube(''), 'https://www.youtube.com/');
  assert.equal(urlYoutube('iron man'), 'https://www.youtube.com/results?search_query=iron%20man');
});

test('le reste part à l\'IA', () => {
  for (const p of ['Bonjour Jarvis', 'Explique-moi la relativité', 'Quel temps fait-il demain ?', 'Raconte une blague'])
    assert.equal(analyser(p), null, p);
});
