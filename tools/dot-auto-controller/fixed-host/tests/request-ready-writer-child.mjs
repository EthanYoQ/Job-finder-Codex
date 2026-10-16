/** TEST_ONLY fault injection around the real writer's Node filesystem calls. */
import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const [file,text,stage,mode]=process.argv.slice(2),now=Date.now(),realNow=Date.now;let advanced=false,reached=false;
Date.now=()=>realNow()+(advanced?120000:0);
async function at(which){if(which!==stage||reached)return;reached=true;if(mode==='kill'){process.send({stage});setInterval(()=>{},1000);await new Promise(()=>{});}else advanced=true;}
const realOpen=fs.open.bind(fs),realLink=fs.link.bind(fs);
fs.open=async(p,...args)=>{if(p===file.replace(/\.json$/,'.ready'))await at('final');const fd=await realOpen(p,...args),sync=fd.sync.bind(fd);fd.sync=async()=>{await sync();if(String(p).endsWith('.tmp'))await at('temp');if(String(p).endsWith('.request.ready'))await at('ready');};return fd;};
// final-stage expiry must happen BEFORE the production pre-ready time check.
const realUnlink=fs.unlink.bind(fs);fs.unlink=async(...args)=>{await realUnlink(...args);if(stage==='final'&&mode!=='kill')await at('final');};
fs.link=async(...args)=>{await realLink(...args);await at('link');};syncBuiltinESMExports();
const {publishRelayRequest}=await import('../../vendor/c60-source/ops/cloud-pilot-host/relay-request-ready.mjs');
try{await publishRelayRequest(file,text,{deadline:mode==='dispatchBefore'?now+240000:now+60000,dispatchBefore:mode==='dispatchBefore'?now+60000:undefined});throw Error('EXPECTED_FAULT_NOT_OBSERVED');}catch(e){if(mode==='kill')throw e;process.send({stage,error:e.message});if(e.message!==(mode==='deadline'?'RELAY_DEADLINE':'RELAY_DISPATCH_BUDGET'))process.exitCode=1;process.disconnect();}
