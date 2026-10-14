'use strict';
const handler = require('../server.js');

module.exports = async (req, res) => {
  try {
    return await handler(req, res);
  } catch (err) {
    console.error('[vercel] Unhandled error in api/index.js:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: false, error: 'Internal Server Error: ' + (err && err.message) }));
    }
  }
};
