'use strict';
// Test process only. No network transport is permitted, including loopback sockets.
const {syncBuiltinESMExports}=require('node:module');
const deny=name=>function(){throw new Error('SYNTHETIC_FIXTURE_NETWORK_FORBIDDEN:'+name);};
for(const [module,names]of [['node:http',['request','get']],['node:https',['request','get']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dgram',['createSocket']],['node:dns',['resolve','resolve4','resolve6']],['node:dns/promises',['resolve','resolve4','resolve6']]]){
 const target=require(module);for(const name of names)target[name]=deny(module+'.'+name);
}
require('node:net').Socket.prototype.connect=deny('net.Socket.connect');
function localhost(name,options){if(name!=='localhost')return deny('dns.lookup')();const family=(typeof options==='number'?options:options?.family)===6?6:4;const x={address:family===6?'::1':'127.0.0.1',family};return options?.all?[x]:x;}
require('node:dns/promises').lookup=async(name,options)=>localhost(name,options);
require('node:dns').lookup=(name,options,callback)=>{if(typeof options==='function'){callback=options;options=undefined;}const x=localhost(name,options);queueMicrotask(()=>options?.all?callback(null,x):callback(null,x.address,x.family));};
globalThis.fetch=deny('global.fetch');
syncBuiltinESMExports();
