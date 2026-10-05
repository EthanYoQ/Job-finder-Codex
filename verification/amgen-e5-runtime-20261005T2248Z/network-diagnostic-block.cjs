const fs=require('node:fs');
const log=process.env.AMGEN_OFFLINE_NETWORK_DIAGNOSTIC_LOG;
function blocked(label){return function(...args){const a=args[0],target=typeof a==='string'||typeof a==='number'?String(a):a&&typeof a==='object'?Object.fromEntries(['host','hostname','port','path'].filter(k=>k in a).map(k=>[k,a[k]])):typeof a;if(log)fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),pid:process.pid,label,target,stack:new Error().stack.split('\n').slice(1,9)})+'\n');throw Error('OFFLINE_PREPARATION_NETWORK_FORBIDDEN');};}
global.fetch=blocked('fetch');
for(const id of ['node:http','node:https']){const m=require(id);m.request=blocked(id+'.request');m.get=blocked(id+'.get');}
const net=require('node:net');net.connect=blocked('net.connect');net.createConnection=blocked('net.createConnection');net.Socket.prototype.connect=blocked('net.Socket.connect');
require('node:tls').connect=blocked('tls.connect');const dns=require('node:dns');for(const k of ['lookup','resolve','resolve4','resolve6'])dns[k]=blocked('dns.'+k);
