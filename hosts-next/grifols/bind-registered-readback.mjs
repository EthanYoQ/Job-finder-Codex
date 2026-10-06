// Local binding only. This script never registers a candidate or sends SQL.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url));
const expected=JSON.parse(readFileSync(join(base,'EXPECTED_REGISTRATION.json'),'utf8'));
const build=JSON.parse(readFileSync(join(base,'LOCAL_UNREGISTERED_BUILD_IDENTITY.json'),'utf8')).build;

export function validateRegistrationReadback(input,now=Date.now()){
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='checkedAt,row')throw Error('REGISTRATION_READBACK_SHAPE');
 const checkedAt=Date.parse(input.checkedAt);
 if(!Number.isFinite(checkedAt)||checkedAt>now||now-checkedAt>60000)throw Error('REGISTRATION_FRESH_READ_REQUIRED');
 const row=input.row;
 if(!row||typeof row.id!=='string'||!/^[-A-Za-z0-9._]{1,100}$/.test(row.id)||row.id==='dot-cloud-restored-fb0b8e3-20261005T2028Z'||!Number.isSafeInteger(row.version)||row.version<1||!['BUILDING','READY_FOR_QA','RELEASED'].includes(row.status))throw Error('REGISTRATION_ROW_REQUIRED');
 for(const [key,value] of Object.entries(expected))if(row[key]!==value)throw Error('REGISTRATION_IDENTITY:'+key);
 return {status:'REGISTERED_VERIFIED',build,candidate:{id:row.id,goalId:row.goalId,version:row.version}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [path,...extra]=process.argv.slice(2);if(!path||extra.length)throw Error('Usage: bind-registered-readback.mjs <fresh-verified-registration-readback.json>');
 const activationPath=join(base,'host/activation.json'),controlPath=join(base,'host/control-base.json');
 const previous=JSON.parse(readFileSync(activationPath,'utf8')),control=JSON.parse(readFileSync(controlPath,'utf8'));
 if(previous.status!=='UNREGISTERED'||previous.candidate!==null||control.candidate!==null||JSON.stringify(control.build)!==JSON.stringify(build))throw Error('FRESH_UNREGISTERED_HOST_REQUIRED');
 const binding=validateRegistrationReadback(JSON.parse(readFileSync(path,'utf8')));
 // The activation write comes last; interrupted writes continue to fail closed.
 const controlTemp=controlPath+'.binding.tmp',activationTemp=activationPath+'.binding.tmp';
 writeFileSync(controlTemp,JSON.stringify({...control,candidate:binding.candidate},null,2)+'\n',{flag:'wx',mode:0o600});
 writeFileSync(activationTemp,JSON.stringify(binding,null,2)+'\n',{flag:'wx',mode:0o600});
 renameSync(controlTemp,controlPath);renameSync(activationTemp,activationPath);
 console.log(JSON.stringify({status:'LOCAL_HOST_BOUND_NO_LAUNCH',candidate:binding.candidate,buildCommit:build.commitSha}));
}
