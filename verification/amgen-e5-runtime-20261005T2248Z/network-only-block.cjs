const fs=require('node:fs');
let count=0;
const log=process.env.AMGEN_OFFLINE_NETWORK_LOG;
function blocked(){count++;if(log)fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),pid:process.pid,blocked:true})+'\n');throw Error('OFFLINE_PREPARATION_NETWORK_FORBIDDEN');}
global.fetch=blocked;
for(const id of ['node:http','node:https']){const m=require(id);m.request=blocked;m.get=blocked;}
const net=require('node:net');net.connect=blocked;net.createConnection=blocked;net.Socket.prototype.connect=blocked;
const tls=require('node:tls');tls.connect=blocked;
const dns=require('node:dns');for(const k of ['lookup','resolve','resolve4','resolve6'])dns[k]=blocked;
