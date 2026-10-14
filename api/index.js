'use strict';
const handler = require('../server.js');

module.exports = async (req, res) => {
  return handler(req, res);
};
