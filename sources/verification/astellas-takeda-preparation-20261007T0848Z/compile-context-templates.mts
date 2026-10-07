// Offline compiler proof only. Placeholder context is not an actual registered binding.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE} from '../../producer/src/db/cloudPilotSqlControl.ts';
const [key]=process.argv.slice(2);assert(['astellas','takeda'].includes(key));
const R=resolve(import.meta.dirname,'../..'),host=join(R,'hosts',key,'host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.template.json'),'utf8'));
const base=JSON.parse(readFileSync(join(host,'control-base.template.json'),'utf8'));
assert.equal(base.candidate,null);assert.equal(CLOUD_PILOT_SOURCE.id,cfg.sourceId);assert.equal(CLOUD_PILOT_SOURCE.sourceConfigSha256,cfg.sourceConfigSha256);
const candidate={id:'OWNER_REGISTERED_C51_CANDIDATE_ID',goalId:'jobfinder-portable-required-40',version:51};
const template=compileCloudPilotPublicationContextSql({...base,candidate},'PLAN_BOUND_SOURCE_QUALITY_V1');
const exact=compileCloudPilotPublicationContextSql({...base,candidate:{...candidate,id:'dot-cloud-delta-proxy-28402a29-20261007'}},'PLAN_BOUND_SOURCE_QUALITY_V1');
assert(template.includes('OWNER_REGISTERED_C51_CANDIDATE_ID'));assert(exact.includes("E'dot-cloud-delta-proxy-28402a29-20261007'"));
for(const s of [template,exact]){assert(s.includes(cfg.sourceId));assert(s.includes(cfg.sourceConfigSha256));assert(s.includes('j."visibleInFrontend",j."isNew"'));assert(s.includes("'legacyCertificate'"));assert(s.includes('AS observations'));}
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
writeFileSync(join(host,'context-read.sql.template'),template);
writeFileSync(join(host,'context-template-proof.json'),JSON.stringify({sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,compilerPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',templateSha256:sha(template),templateBytes:Buffer.byteLength(template),exactC51CandidateId:'dot-cloud-delta-proxy-28402a29-20261007',expectedExactC51ContextSha256:sha(exact),expectedExactC51ContextBytes:Buffer.byteLength(exact),actualContextWritten:false,actualBindingCreated:false,noSqlExecuted:true,restoreInstruction:'Do not substitute text. Parent owner must use prepare-registered-control.mts with its verified current official C51 readback; compare compiled context SHA-256 to this exact expected hash.'},null,2)+'\n');
console.log(JSON.stringify({source:key,templateSha256:sha(template),expectedExactC51ContextSha256:sha(exact),noSqlExecuted:true}));
