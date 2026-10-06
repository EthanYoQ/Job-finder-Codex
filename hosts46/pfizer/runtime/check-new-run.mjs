import {lstat,readdir,readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {noLinks} from './preflight/preflight-launch.mjs';
const host=dirname(dirname(fileURLToPath(import.meta.url)));
export async function checkNewRun(args){
 const [batch,...extra]=args;if(extra.length||typeof batch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error('NEW_RUN_ARGUMENTS');
 const run=await noLinks(join(host,batch));
 for(const name of ['bootstrap.json','diagnostics','reviewed-command.txt'])try{await lstat(join(run,name));throw Error('RUN_ALREADY_STARTED:'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const name of ['artifacts','relay'])try{const p=await noLinks(join(run,name));if((await readdir(p)).length)throw Error('RUN_OUTPUT_NOT_EMPTY:'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
 return {run,reusableEvidence:false,checkedAt:new Date().toISOString()};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkNewRun(process.argv.slice(2))));
