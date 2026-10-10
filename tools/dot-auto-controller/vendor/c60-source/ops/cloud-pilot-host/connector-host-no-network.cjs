/** Connector file/compiler subprocesses never need network; MCP stays in the host. */
'use strict';
const deny=()=>{throw Error('HOST_SUBPROCESS_NETWORK_FORBIDDEN');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;
require('node:tls').connect=deny;
const dgram=require('node:dgram');for(const k of ['connect','send','sendto','bind'])if(dgram.Socket.prototype[k])dgram.Socket.prototype[k]=deny;
const dns=require('node:dns');for(const m of [dns,dns.promises])for(const k of Object.keys(m))if(/^(lookup|resolve|reverse)/.test(k)&&typeof m[k]==='function')m[k]=deny;
globalThis.fetch=deny;require('node:module').syncBuiltinESMExports();
