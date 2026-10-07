'use strict';
const {syncBuiltinESMExports}=require('node:module');
const denied=()=>{throw Error('STATIC_SOURCE_RESTORE_NETWORK_FORBIDDEN');};
for(const [name,keys]of [['node:http',['get','request']],['node:https',['get','request']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dns',['lookup','resolve','resolve4','resolve6']],['node:dgram',['createSocket']]])for(const key of keys)require(name)[key]=denied;
require('node:net').Socket.prototype.connect=denied;globalThis.fetch=denied;syncBuiltinESMExports();
