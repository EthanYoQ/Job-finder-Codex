const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const original = net.createConnection;
net.createConnection = function (...args) {
  const first = args[0];
  fs.appendFileSync(path.join(__dirname, 'logs', 'loader-socket-classification.jsonl'), JSON.stringify({
    argumentType: typeof first,
    unixSocketPath: typeof first === 'string' ? first : first?.path ?? null,
    hasHostOrPort: typeof first === 'object' && !!(first?.host || first?.port),
    stack: new Error('Classification only; original deny guard remains active').stack.split('\n').slice(1, 6)
  }) + '\n');
  return original.apply(this, args);
};
require('node:module').syncBuiltinESMExports();
