/** Offline adapter check. Does not listen, fetch, query DB, or startServer. */
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root = process.argv[2];
if (!root) throw Error('Usage: node --import tsx integration/verify-http-integration.mjs <patched-web-root>');
const {createServer} = await import(pathToFileURL(resolve(root, 'src/server/httpServer.ts')));
async function exercise(options) {
  const server = createServer({}, options);
  const result = await new Promise((resolveResult, reject) => {
    const response = new EventEmitter();
    Object.assign(response, {statusCode: 0, headers: {}, headersSent: false,
      hasHeader(name) {return name in this.headers;},
      setHeader(name, value) {this.headers[name] = value;},
      end(body) {resolveResult({status: this.statusCode, headers: this.headers, body: JSON.parse(body)});}
    });
    server.emit('request', {url: '/.well-known/jobfinder-reader-identity.json?nonce=ef953ec1-de13-4d1c-8654-209905aab251',
      method: 'GET', headers: {host: 'job.orz.md'}}, response);
    setTimeout(() => reject(Error('NO_RESPONSE')), 1000).unref();
  });
  assert.equal(server.listening, false);
  server.close();
  return result;
}
const disabled = await exercise({});
assert.equal(disabled.status, 503);
assert.equal(disabled.headers['cache-control'], 'no-store, max-age=0');
assert.deepEqual(disabled.body, {error: 'READER_IDENTITY_UNAVAILABLE'});
let count = 0;
const enabled = await exercise({readerIdentity: async (request, response) => {
  count++;
  assert.ok(request.url.startsWith('/.well-known/jobfinder-reader-identity.json?nonce='));
  response.statusCode = 200;
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({routed: true}));
  return true;
}});
assert.equal(count, 1); assert.equal(enabled.status, 200); assert.deepEqual(enabled.body, {routed: true});
console.log('PASS: actual httpServer adapter routes enabled identity and blocks static fallback while disabled; no listeners, DB, or network.');
