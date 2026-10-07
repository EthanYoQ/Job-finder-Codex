'use strict';
const { syncBuiltinESMExports } = require('node:module');
function deny() { throw Error('SERVIER_B_TEST_NETWORK_FORBIDDEN'); }
for (const [name, methods] of [
  ['node:http', ['get', 'request']], ['node:https', ['get', 'request']],
  ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
  ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6']], ['node:dns/promises', ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ['node:dgram', ['createSocket']]
]) for (const method of methods) require(name)[method] = deny;
require('node:net').Socket.prototype.connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
