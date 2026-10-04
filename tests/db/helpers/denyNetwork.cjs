// Local POC runner guard: fail closed if a dependency tries any TCP connection.
const net = require('node:net');
net.Socket.prototype.connect = function () { throw new Error('LOCAL_POC_NETWORK_FORBIDDEN'); };
globalThis.fetch = async function () { throw new Error('LOCAL_POC_NETWORK_FORBIDDEN'); };
