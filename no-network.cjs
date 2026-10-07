'use strict';
// Local verification only. Reject network calls before any transport starts.
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
function deny(api) {
  return function (...args) {
    const first=args[0];
    const socketPath=typeof first==='string'&&first.startsWith('/')?first:typeof first?.path==='string'?first.path:null;
    const line = JSON.stringify({ pid: process.pid, api, socketKind:socketPath?'LOCAL_UNIX_SOCKET':'NETWORK_OR_UNKNOWN', socketPath, stack:new Error().stack.split('\n').slice(1,5), code: 'OFFLINE_VERIFICATION_NETWORK_BLOCKED' });
    fs.appendFileSync(path.join(__dirname, 'logs', 'network-blocks.jsonl'), line + '\n');
    throw new Error('OFFLINE_VERIFICATION_NETWORK_BLOCKED: ' + api);
  };
}
for (const [moduleName, names] of [
  ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
  ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
  ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ['node:dns/promises', ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ['node:dgram', ['createSocket']]
]) {
  const module = require(moduleName);
  for (const name of names) module[name] = deny(moduleName + '.' + name);
}
// Vite asks the resolver for localhost at startup. Answer from a literal,
// without permitting DNS or opening any socket.
function loopbackResult(hostname, options) {
  if (hostname !== 'localhost') return deny('dns.nonlocal.lookup')();
  const family = (typeof options === 'number' ? options : options?.family) === 6 ? 6 : 4;
  const result = { address: family === 6 ? '::1' : '127.0.0.1', family };
  return options?.all ? [result] : result;
}
require('node:dns/promises').lookup = async (hostname, options) => loopbackResult(hostname, options);
require('node:dns').lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const result = loopbackResult(hostname, options);
  queueMicrotask(() => options?.all ? callback(null, result) : callback(null, result.address, result.family));
};
require('node:net').Socket.prototype.connect = deny('net.Socket.connect');
globalThis.fetch = deny('global.fetch');
syncBuiltinESMExports();
