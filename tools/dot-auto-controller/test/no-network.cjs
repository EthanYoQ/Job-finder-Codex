/** Offline validation only. Tests must inject/mock transport explicitly. */
const deny=()=>{throw Error('OFFLINE_NETWORK_FORBIDDEN');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
require('node:net').connect=deny;require('node:net').createConnection=deny;
require('node:tls').connect=deny;globalThis.fetch=deny;
