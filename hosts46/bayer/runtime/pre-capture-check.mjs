// Local-only preparation. The synthetic bootstrap is never capture/publication authority.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {preflight,writableDirectory,noLinks} from './preflight/preflight-launch.mjs';
const host=dirname(dirname(fileURLToPath(import.meta.url))),[batchId,captureKey,...extra]=process.argv.slice(2);
if(extra.length||![batchId,captureKey].every(v=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(v??'')))throw Error('Usage: pre-capture-check.mjs <new-batch-id> <new-capture-key>');
const cfg=JSON.parse(await readFile(join(host,'host-config.json'))),expected=JSON.parse(await readFile(join(host,'runtime/expected-database.json')));
const run=join(host,batchId),captureRoot=join(host,'captures',captureKey),main=join(captureRoot,'main'),independent=join(captureRoot,'independent'),dom=join(captureRoot,'dom','dom-capture.json');
for(const path of [main,independent,dom]){await noLinks(path);try{await lstat(path);throw Error('CAPTURE_INPUT_ALREADY_EXISTS:'+path);}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const path of [host,join(host,'runtime'),join(host,'readiness'),captureRoot,join(captureRoot,'dom')])await writableDirectory(path);
const bootstrap={schemaVersion:1,batchId,candidateRows:[expected.candidate],checkedAt:new Date(0).toISOString()},bytes=JSON.stringify(bootstrap),path=join(host,'readiness','NONQUAL-PREFLIGHT-'+randomUUID()+'.json');
await writeFile(path,bytes,{flag:'wx',mode:0o600});
const checked=await preflight(['check',join(host,'host-config.json'),join(host,'control-base.json'),path,createHash('sha256').update(bytes).digest('hex'),run]);
if(checked.report.launchPermitted)throw Error('SYNTHETIC_PREFLIGHT_CANNOT_AUTHORIZE_LAUNCH');
console.log(JSON.stringify({purpose:'LOCAL_ONLY_PRE_CAPTURE_PATH_AND_RUNTIME_CHECK',sourceId:cfg.sourceId,localChecksPassed:true,reportPath:checked.reportPath,run,captureRoot,main,independent,dom,launchPermitted:false,archiveProbeVerified:checked.report.runtime.archiveSmoke.passed}));
