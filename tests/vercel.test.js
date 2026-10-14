const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/index.js');
const server = require('../server.js');

test('Vercel serverless - corps pré-parsé par le runtime (@vercel/node)', async () => {
  // Simule une requête Vercel où le runtime a déjà consommé le stream et pré-parsé req.body
  const req = {
    url: '/api/auth/register',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { username: 'StarkVercel', password: 'reactor-pass-123' },
  };

  let statusCode = 0;
  let responseHeaders = {};
  let responseBody = '';

  const res = {
    writeHead(code, headers) {
      statusCode = code;
      responseHeaders = headers;
    },
    end(data) {
      responseBody = data;
    },
  };

  await handler(req, res);

  assert.equal(statusCode, 200);
  const data = JSON.parse(responseBody);
  assert.equal(data.ok, true);
  assert.equal(data.user.username, 'StarkVercel');
  assert.ok(data.token);
  assert.ok(data.token.startsWith('tok_'));
});

test('Vercel serverless - token de session HMAC vérifié sans état (stateless)', async () => {
  const reqUser = {
    url: '/api/auth/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { username: 'StarkVercel', password: 'reactor-pass-123' },
  };

  let token = '';
  const resLogin = {
    writeHead() {},
    end(data) {
      token = JSON.parse(data).token;
    },
  };

  await handler(reqUser, resLogin);
  assert.ok(token);

  // Requête /api/auth/me sur un autre conteneur éphémère (utilise le token signé)
  const reqMe = {
    url: '/api/auth/me',
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  };

  let statusMe = 0;
  let bodyMe = '';
  const resMe = {
    writeHead(code) { statusMe = code; },
    end(data) { bodyMe = data; },
  };

  await handler(reqMe, resMe);
  assert.equal(statusMe, 200);
  const dataMe = JSON.parse(bodyMe);
  assert.equal(dataMe.authenticated, true);
  assert.equal(dataMe.user.username, 'StarkVercel');
});

test('Vercel serverless - requêtes OPTIONS (CORS preflight)', async () => {
  const req = {
    url: '/api/chat',
    method: 'OPTIONS',
    headers: {},
  };

  let statusCode = 0;
  let responseHeaders = {};
  const res = {
    writeHead(code, headers) {
      statusCode = code;
      responseHeaders = headers;
    },
    end() {},
  };

  await handler(req, res);
  assert.equal(statusCode, 204);
  assert.equal(responseHeaders['Access-Control-Allow-Origin'], '*');
});
