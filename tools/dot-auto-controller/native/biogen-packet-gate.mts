import {readBiogenOriginalDeadline} from './biogen-original-run.mjs';
import {assertBiogenPacketDeadline} from './biogen-deadline-gate.mts';
import {verifySourceQualityReceipt} from "../vendor/c60-source/src/crawler/sourceQualityAdmission.ts";
import {buildJobDedupeKey} from "../vendor/c60-source/src/crawler/normalizedJob.ts";
import {canonicalPageTraceSha256,canonicalStringSetSha256} from "../vendor/c60-source/src/crawler/sourceFetchEvidence.ts";
import {requiresAGradeOfficialTotalCertificate,issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt} from "../vendor/c60-source/src/crawler/completenessCertificate.ts";
import {createWorkdaySourceFetch} from "../vendor/c60-source/src/crawler/workdaySourceFetch.ts";
import {assertBiogenRefreshPlan} from "./biogen-native-capture.mts";
import {loadPilotContext} from '../vendor/c60-source/src/crawler/cloudPilotContext.ts';
import {reviewBiogenRawPages} from "./biogen-raw-review.mts";
import {requestContractV2Matches} from "../vendor/c60-source/src/crawler/strictPageRequestContract.ts";
/** Local read-only SQL parser/recompiler. Never submits SQL or edits producer/run. */
import assert from 'node:assert/strict';
import {verifyNodeRuntimeProfile} from "../vendor/c60-source/scripts/verify-node-runtime-profile.ts";
import {createBuildIdentity} from "../vendor/c60-source/src/readiness/buildIdentity.ts";
import {sanitizeEvidenceHttpUrl} from "../vendor/c60-source/src/crawler/sourceFetchEvidence.ts";
import {runSourceCrawl,replayStrictSourceQualityEvidence,supportsStrictOfficialTotalCertificate,validateStrictOfficialTotalCertificateEvidence} from "../vendor/c60-source/src/crawler/runSourceCrawl.ts";
import {load} from "cheerio";
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {decodeDeclarations} from './review-packet-envelope.mts';
import {prepareCloudPilotDbStartedControl,CLOUD_PILOT_SOURCE} from '../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
import {deriveCurrentStagedScheduleExpectation} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {buildPendingRuntimeBatch} from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts';
import {hashCanonicalStringSet} from '../vendor/c60-source/src/crawler/runtimeBatchIdentity.ts';
import {JOB_SOURCE_UPDATE_FIELDS,parseJobProjectionDeltaReceipt,hashJobPersistedProjection,hashProjectionJson} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
export async function reviewBiogenPacket(runArg:string,requestId:string,output:string,{originalOuterDeadline}: {originalOuterDeadline:number}){
assert(runArg&&requestId&&output);
assert.equal(originalOuterDeadline,readBiogenOriginalDeadline(runArg),'BIOGEN_ORIGINAL_DEADLINE_PROVENANCE');
const R=resolve(import.meta.dirname,'../vendor'),run=resolve(runArg),host=resolve(run,'..');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));const sha=(b:any)=>createHash('sha256').update(b).digest('hex');
const rawPath=join(run,'relay',requestId+'.request.json'),sqlPath=rawPath+'.sql';
const request=json(rawPath),sql=readFileSync(sqlPath,'utf8');assert.equal(sql,request.payload.sql);
assert.equal(request.requestId,requestId);assert.equal(request.kind,'PUBLISH');assert.equal(request.payload.projectId,'yiopvxysxrtrnvqxwgbx');
assert(Date.now()<Date.parse(request.payload.dispatchBefore));assert(Date.now()<Date.parse(request.expiresAt));
const cfg=json(join(host,'host-config.json')),control=json(join(host,'control-base.json')),binding=json(join(host,'activation.json'));
assert.equal(binding.status,'REGISTERED_VERIFIED');const expectedCandidate=json(join(host,'expected-candidate.json'));assert.equal(control.candidate.id,expectedCandidate.id);assert.equal(control.candidate.version,expectedCandidate.version);assert.deepEqual(binding.candidate,control.candidate);assert.equal(CLOUD_PILOT_SOURCE.id,cfg.sourceId);
const git=(...a:string[])=>execFileSync('git',a,{cwd:join(R,'c60-source'),encoding:'utf8'}).trim();assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),control.build.commitSha);
assert.equal(control.build.commitSha,git('rev-parse','HEAD')); assert.deepEqual(createBuildIdentity(join(R,'c60-source'),control.build.commitSha),control.build);assert.deepEqual(binding.build,control.build);
const runtimeVerification=await verifyNodeRuntimeProfile();
const {requestSha256,...requestBody}=request;assert.equal(sha(JSON.stringify(requestBody)),requestSha256);
const declarations=/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\nDECLARE affected bigint; job_data jsonb; ([\s\S]*?) current_context jsonb;/.exec(sql);assert(declarations);
const {terminal,context}=decodeDeclarations(declarations[2]);const legacyCertificate=terminal.completenessCertificate.legacyCertificate;
assert.equal(legacyCertificate.schemaVersion,'plan-bound-source-quality-v1');assert.equal(legacyCertificate.policyId,'PLAN_BOUND_SOURCE_QUALITY_V1');const packet={terminal,context,legacyCertificate};
const registered=json(join(host,'expected-candidate.json'));for(const k of ['id','goalId','status','version','commitSha','rosterHash','schemaHash','oracleVersion','dbSnapshotHash','sourcePlanHash','sourceTreeHash','runtimeTreeHash','migrationVersion','sourceConfigHash','adapterBundleHash','minimumStableCompanyCount'])assert.deepEqual(context.candidateRow[k],registered[k],'REGISTERED_16_FIELD:'+k);
for(const[k,v]of Object.entries(control.databaseIdentity))assert.deepEqual(context.candidateRow[k],v,'DATABASE_IDENTITY:'+k);
assert.equal(terminal.sourceId,cfg.sourceId);assert.equal(terminal.batchId,run.split('/').at(-1));assert.equal(terminal.releaseCandidateId,control.candidate.id);assert.equal(terminal.id,terminal.batchId+'--'+cfg.sourceId);
const compilerPath=join(R,'c60-source/src/db/ingestionRepository.ts'),compilerSource=readFileSync(compilerPath,'utf8');
const snip=compilerSource.slice(compilerSource.indexOf('function compileAtomicWriteStatements('),compilerSource.indexOf('const LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL'));
assert(snip.startsWith('function compileAtomicWriteStatements(')&&snip.includes('function sqlRecords('));
const terminalSnip=compilerSource.slice(compilerSource.indexOf('function sourceResultTerminalData('),compilerSource.indexOf('const ATOMIC_SOURCE_RESULT_FIELDS'));
let uuidQueue:string[]=[];
const transpiled=ts.transpileModule(snip+'\n'+terminalSnip+'\nreturn {compileAtomicWriteStatements,sqlRecords,sourceResultTerminalData};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const original=new Function('randomUUID','JOB_SOURCE_UPDATE_FIELDS','fromPrismaJobCategory','fromPrismaRequiredJobField',transpiled)(()=>{assert(uuidQueue.length,'unexpected original compiler UUID');return uuidQueue.shift();},JOB_SOURCE_UPDATE_FIELDS,(v:any)=>v,(v:any)=>v);
// Parse only the literal/tuple JSON forms emitted by original sqlRecords. No eval.
function parseRows(s:string,start:number){let i=start;
 const take=(x:string)=>{assert.equal(s.slice(i,i+x.length),x,'SQL_GRAMMAR '+i);i+=x.length;};
 const literal=()=>{take("E'");let value='';while(i<s.length){let c=s[i++];if(c==='\\'){assert.equal(s[i++],'\\');value+='\\';}else if(c==="'"){if(s[i]==="'"){i++;value+="'";}else return value;}else value+=c;}throw Error('unclosed SQL literal');};
 const jsonLiteral=()=>{const v=JSON.parse(literal());take('::jsonb');return v;};
 if(s.startsWith("E'",i)){const rows=jsonLiteral();assert(Array.isArray(rows));return {rows,end:i};}
 take('(SELECT jsonb_agg(');const common=jsonLiteral();assert(common&&!Array.isArray(common));take(' || jsonb_build_object(');const fields:any[]=[];
 while(!s.startsWith(') ORDER BY tuple.ordinality)',i)){if(fields.length)take(', ');const key=literal();take(', tuple.value->');const m=/^\d+/.exec(s.slice(i));assert(m);i+=m[0].length;assert(!fields.some(x=>x[0]===key));assert(!Object.hasOwn(common,key));fields.push([key,Number(m[0])]);}
 take(') ORDER BY tuple.ordinality)\n    FROM jsonb_array_elements(');const tuples=jsonLiteral();take(') WITH ORDINALITY AS tuple(value, ordinality))');assert(Array.isArray(tuples));
 return {rows:tuples.map((t:any)=>{assert(Array.isArray(t));const used=new Set(fields.map(x=>x[1]));assert.equal(used.size,t.length);assert([...used].every((v:any)=>v<t.length));return {...common,...Object.fromEntries(fields.map(([k,n])=>[k,t[n]]))};}),end:i};
}
function verifyFullBody(sql:string){
const bodyMatch=/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\nDECLARE affected bigint; job_data jsonb; [\s\S]*? current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\n([\s\S]*)\nEND;\n\1;$/.exec(sql);assert(bodyMatch);const body=bodyMatch[2]!;
const e=deriveCurrentStagedScheduleExpectation(control.build),plan=e.plans.find((x:any)=>x.source.id===cfg.sourceId)!;assert(plan);
const c=context.candidateRow;
const planned=buildPendingRuntimeBatch(terminal.batchId,[plan],{releaseCandidateId:c.id,commitSha:c.commitSha,rosterSha256:c.rosterHash,sourcePlanSha256:c.sourcePlanHash,sourceConfigSha256:c.sourceConfigHash,adapterBundleSha256:c.adapterBundleHash,batchKind:'SCHEDULED',ownerId:CLOUD_PILOT_SOURCE.ownerId,expectedPlannedSourceIds:[cfg.sourceId],expectedPlannedSourceSetSha256:hashCanonicalStringSet([cfg.sourceId]),expectedPlannedSourceCount:1},new Date(terminal.startedAt));
const holder=/UPDATE public\."CrawlCoordinatorLock" SET "holderId"=E'([a-f0-9-]{36})'/.exec(body)?.[1];assert(holder);
const through=/IF E'([^']+)'::timestamptz>clock_timestamp\(\)\+interval '1 second'/.exec(body)?.[1];assert(through);
// Shared JSON declarations restore nested certificate last; native matches emits original insertion order.
const terminalGuard=/PERFORM 1 FROM public\."CrawlBatchSourceResult" s WHERE[^\n]+source_result_data[^\n]+FOR SHARE;/.exec(body);assert(terminalGuard);
const terminalKeys=[...terminalGuard[0].matchAll(/s\."([^"]+)" IS NOT DISTINCT FROM expected\."\1"/g)].map(m=>m[1]);assert.deepEqual([...terminalKeys].sort(),Object.keys(terminal).sort());
const originalOrderedTerminal=Object.fromEntries(terminalKeys.map(k=>[k,terminal[k]]));
const controls=prepareCloudPilotDbStartedControl({...control,planned,context},originalOrderedTerminal,holder,request.expiresAt,through,'PLAN_BOUND_SOURCE_QUALITY_V1');
const prefix="PERFORM set_config('TimeZone', 'UTC', true);\nPERFORM set_config('lock_timeout', '1000ms', true);\nSET CONSTRAINTS ALL DEFERRED;\n"+controls.before+'\n';
assert(body.startsWith(prefix),'ORIGINAL_CONTROL_PREFIX_MISMATCH');if(!body.endsWith('\n'+controls.after)){writeFileSync(output+'.actual-tail.txt',body.slice(-controls.after.length-100));writeFileSync(output+'.expected-tail.txt',controls.after);}assert(body.endsWith('\n'+controls.after),'ORIGINAL_CONTROL_SUFFIX_MISMATCH');
const middle=body.slice(prefix.length,-('\n'+controls.after).length);let offset=0;const decoded:any[]=[];const regenerated:string[]=[];
const tableModel:any={EvidenceArtifact:'evidenceArtifact',PaginationEvidence:'paginationEvidence',LossLedgerEntry:'lossLedgerEntry',CrawlObservation:'crawlObservation',LifecycleSetEvidenceMember:'lifecycleSetEvidenceMember'};
const reorder=(row:any,keys:string[])=>{assert.deepEqual(Object.keys(row).sort(),[...keys].sort());return Object.fromEntries(keys.map(k=>[k,row[k]]));};
while(offset<middle.length){const s=middle.slice(offset);let stmt:string;let writes:any[]=[];
 if(s.startsWith('INSERT INTO public.')){
  const m=/^INSERT INTO public\."([A-Za-z]+)" \(([^\n]+)\)\n          SELECT \2 FROM jsonb_populate_recordset\(NULL::public\."\1", /.exec(s);assert(m,'INSERT closed grammar');const table=m[1]!,cols=m[2]!.split(', ').map(x=>{assert(/^"[A-Za-z][A-Za-z0-9]*"$/.test(x));return x.slice(1,-1);});assert(tableModel[table],table);
  const parsed=parseRows(s,m[0].length);assert.equal(s.slice(parsed.end,parsed.end+2),');');stmt=s.slice(0,parsed.end+2);const rows=parsed.rows.map((v:any)=>reorder(v,cols));
  uuidQueue=rows.map((x:any)=>x.id);writes=rows.map((data:any)=>({kind:'insert',stage:'REVIEW',model:tableModel[table],data}));decoded.push({table,rows});
 }else if(s.startsWith('FOR job_data IN SELECT value FROM jsonb_array_elements(')){
  const start='FOR job_data IN SELECT value FROM jsonb_array_elements('.length;const parsed=parseRows(s,start);assert.equal(s.slice(parsed.end,parsed.end+6),') LOOP');const end=s.indexOf('\n          END LOOP;',parsed.end);assert(end>=0);stmt=s.slice(0,end+'\n          END LOOP;'.length);
  const cm=/INSERT INTO public\."Job" AS existing_job \(([^\n]+)\)/.exec(stmt),um=/DO UPDATE SET \(([^\n]+)\) =/.exec(stmt);assert(cm&&um);
  const getcols=(x:string)=>x.split(', ').map(k=>{assert(/^"[A-Za-z][A-Za-z0-9]*"$/.test(k));return k.slice(1,-1);});const cols=getcols(cm[1]!),updates=getcols(um[1]!);
  assert.deepEqual(updates,['sourceJobId','officialTitle','officialUrl','listUrl','locationRaw','city','cities','officialPublishedAt','lastSeenAt','missingSuccessCount','lifecycleStatus','visibleInFrontend','isNew','sourceChangedAt']);
  const expectedCols=['id','companyId','sourceId','dedupeKey','sourceJobId','officialTitle','auxiliaryChineseTitle','officialUrl','listUrl','locationRaw','city','cities','category','officialPublishedAt','firstSeenAt','lastSeenAt','missingSuccessCount','lifecycleStatus','visibleInFrontend','isNew','sourceChangedAt'];assert.deepEqual(cols,expectedCols);
  const rows=parsed.rows.map((v:any)=>reorder(v,[...cols,'__update']));uuidQueue=rows.map((x:any)=>x.id);
  writes=rows.map((row:any)=>{assert.equal(row.sourceChangedAt,terminal.finishedAt);assert(Object.keys(row.__update).every(k=>updates.includes(k)&&k!=='sourceChangedAt'));const create=Object.fromEntries(cols.filter(k=>!['id','sourceChangedAt'].includes(k)).map(k=>[k,row[k]]));const update=Object.fromEntries(updates.filter(k=>k!=='sourceChangedAt').map(k=>[k,Object.hasOwn(row.__update,k)?row.__update[k]:row[k]]));return {kind:'job',stage:'REVIEW',args:{where:{sourceId_dedupeKey:{sourceId:row.sourceId,dedupeKey:row.dedupeKey}},create,update}};});decoded.push({table:'Job',rows});
 }else if(s.startsWith('UPDATE public."CrawlBatchSourceResult" AS target')){
  stmt=s;const where={id:terminal.id,releaseCandidateId:terminal.releaseCandidateId,batchId:terminal.batchId,sourceId:terminal.sourceId,atomicCommitState:'PENDING'};writes=[{kind:'terminal',stage:'REVIEW',where,data:original.sourceResultTerminalData(originalOrderedTerminal)}];uuidQueue=[];decoded.push({table:'CrawlBatchSourceResult',rows:[terminal]});
 }else throw Error('UNCONSUMED_BODY_AT_'+offset+':'+s.slice(0,120));
 const compiled=original.compileAtomicWriteStatements(writes,()=>{},true,terminal.finishedAt).join('\n');assert.equal(uuidQueue.length,0,'UUID queue mismatch');assert.equal(compiled,stmt,'ORIGINAL_MUTATION_TEMPLATE_MISMATCH');regenerated.push(compiled);offset+=stmt.length;if(offset<middle.length){assert.equal(middle[offset],'\n');offset++;}
}
assert.equal(regenerated.join('\n'),middle,'BODY_NOT_FULLY_RECONSTRUCTED');
return {decoded,through,plan};
}
const {decoded,through,plan}=verifyFullBody(sql);
const negativeCases=[
 ['arbitrary inserted SQL',sql.replace('\nINSERT INTO public."EvidenceArtifact"','\nPERFORM pg_sleep(1);\nINSERT INTO public."EvidenceArtifact"')],
 ['weakened context guard',sql.replace("IF (current_context-'checkedAt') IS DISTINCT FROM (expected_context_data-'checkedAt')",'IF false')],
 ['removed coordinator release',sql.replace("SET \"holderId\"='',\"heartbeatAt\"=clock_timestamp(),metadata='portable-quality-sync-v1:released'","SET \"holderId\"='retained',\"heartbeatAt\"=clock_timestamp(),metadata='portable-quality-sync-v1:released'")],
 ['arbitrary trailing SQL',sql+'\nSELECT 1;'],
 ['altered update target scope',sql.replace('target."sourceId" = E\''+cfg.sourceId+'\'','target."sourceId" = E\'source-other\'')],
 ['arbitrary delete in body',sql.replace('\nINSERT INTO public."EvidenceArtifact"','\nDELETE FROM public."Job";\nINSERT INTO public."EvidenceArtifact"')]
];
const negativeTests=negativeCases.map(([name,mutated])=>{assert.notEqual(mutated,sql,name+' not applied');assert.throws(()=>verifyFullBody(mutated),name);return {name,rejected:true};});
const statementTables=decoded.map(x=>x.table);const tables=statementTables.filter((x,i)=>i===0||x!==statementTables[i-1]);assert.deepEqual(tables.filter(x=>!['Job','LossLedgerEntry'].includes(x)),['EvidenceArtifact','PaginationEvidence','CrawlObservation','LifecycleSetEvidenceMember','CrawlBatchSourceResult']);assert(tables.filter(x=>x==='Job').length<=1);assert(tables.filter(x=>x==='LossLedgerEntry').length<=1);if(tables.includes('LossLedgerEntry'))assert(tables.indexOf('LossLedgerEntry')===2);
const get=(name:string)=>decoded.filter(x=>x.table===name).flatMap(x=>x.rows);
const tuple={releaseCandidateId:terminal.releaseCandidateId,batchId:terminal.batchId,sourceId:terminal.sourceId,sourceResultId:terminal.id};
for(const entry of decoded.filter(x=>!['Job','CrawlBatchSourceResult'].includes(x.table)))for(const row of entry.rows)for(const [k,v]of Object.entries(tuple))assert.equal(row[k],v,entry.table+'.'+k);
const receipt=parseJobProjectionDeltaReceipt(terminal.completenessCertificate,terminal.completenessCertificateSha256);
const members=get('LifecycleSetEvidenceMember');assert.equal(members.length,receipt.members.length);const deltaMap=new Map(receipt.members.map((m:any)=>[m.setKind+'\0'+m.jobKey,m]));
for(const row of members){const expected=deltaMap.get(row.setKind+'\0'+row.jobKey);assert(expected);assert.deepEqual(Object.keys(row).sort(),['id',...Object.keys(tuple),'setKind','jobKey','jobKeySha256','lifecycleStatus','missingCount'].sort());for(const k of Object.keys(row))if(k!=='id')assert.equal(row[k],expected[k]);}
const jobs=get('Job'),old=new Map<any,any>(context.jobs.map((j:any)=>[j.dedupeKey,j]));let newCount=0,changedCount=0,unchangedOmittedCount=0;
const jobChanges:any[]=[];const proposed=new Map();for(const row of jobs){assert.equal(row.sourceId,cfg.sourceId);assert.equal(row.companyId,plan.company.id);assert(row.dedupeKey.startsWith(cfg.sourceId+':'));assert(!proposed.has(row.dedupeKey));const effective={...row,...row.__update};proposed.set(row.dedupeKey,effective);if(old.has(row.dedupeKey)){assert.notEqual(hashJobPersistedProjection(effective),hashJobPersistedProjection(old.get(row.dedupeKey)));changedCount++;}else newCount++;const prior:any=old.get(row.dedupeKey);jobChanges.push({dedupeKey:row.dedupeKey,priorLifecycle:prior?.lifecycleStatus??null,nextLifecycle:effective.lifecycleStatus,priorMissingCount:prior?.missingSuccessCount??null,nextMissingCount:effective.missingSuccessCount,changedProjectionFields:prior?JOB_SOURCE_UPDATE_FIELDS.filter(k=>k==='officialPublishedAt'?(prior[k]==null?null:new Date(String(prior[k]).replace(/(?<!Z)$/,'Z')).toISOString())!==(effective[k]==null?null:new Date(String(effective[k]).replace(/(?<!Z)$/,'Z')).toISOString()):JSON.stringify(prior[k])!==JSON.stringify(effective[k])):['NEW']});}
for(const member of receipt.members.filter((x:any)=>x.setKind==='VISIBLE')){const row=proposed.get(member.jobKey)??old.get(member.jobKey);assert(row);assert.equal(hashJobPersistedProjection(row),member.jobProjectionSha256);if(!proposed.has(member.jobKey))unchangedOmittedCount++;}
const kinds=Object.fromEntries(['CURRENT','GRACE','VISIBLE'].map(kind=>[kind,receipt.members.filter((x:any)=>x.setKind===kind).length]));assert.equal(kinds.CURRENT,terminal.dedupeOutputCount);assert.equal(kinds.VISIBLE,kinds.CURRENT+kinds.GRACE);
const observations=get('CrawlObservation');assert.equal(observations.length,1);assert.equal(observations[0].crawledAt,receipt.observedAt);for(const k of ['rawCount','parsedCount','validCount','dedupeOutputCount'])assert.equal(observations[0][k],terminal[k]);
const archivePath=join(run,'artifacts',terminal.batchId+'.archive.json'),archiveBytes=readFileSync(archivePath),archive=JSON.parse(archiveBytes.toString('utf8'));assert.equal(archive.schemaVersion,1);for(const[k,v]of Object.entries(tuple))assert.equal(archive.sidecar[k],v);
const artifacts=get('EvidenceArtifact'),pages=get('PaginationEvidence');assert.equal(archive.files.length,artifacts.length);
assert.equal(cfg.sourceId,'source-biogen-china-social');assert.equal(cfg.sourceConfigSha256,'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348');
assert.deepEqual(plan,json(join(host,'source-config-reference.json')).currentSourcePlan);assertBiogenRefreshPlan(plan);assert(supportsStrictOfficialTotalCertificate(plan));assert.equal(plan.transportPolicy?.primary,'DIRECT_HTTP');assert(Date.parse(terminal.startedAt)>=Date.parse(JSON.parse(readFileSync(join(run,'bootstrap.json'),'utf8')).checkedAt));
const archiveFiles:any[]=[],bodies=new Map<string,string>(),byLogical=new Map<string,any>();
for(const f of archive.files){
 assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));assert(f.path.includes('/'+terminal.batchId+'/'+cfg.sourceId+'/'+terminal.id+'/'));assert(Array.isArray(f.chunks));
 const chunks=f.chunks.map((c:string)=>{const b=Buffer.from(c,'base64');assert.equal(b.toString('base64'),c);return b;});const b=Buffer.concat(chunks);assert.equal(b.length,f.byteCount);assert.equal(sha(b),f.sha256);assert(b.equals(readFileSync(join(run,'artifacts',f.path))));
 const artifact=artifacts.find((a:any)=>a.path===f.path),sourceArtifact=archive.sidecar.artifacts.find((a:any)=>a.path===f.path);assert(artifact&&sourceArtifact);assert.equal(artifact.sha256,f.sha256);assert.equal(artifact.byteCount,f.byteCount);
 for(const k of ['id','kind','releaseCandidateId','batchId','sourceId','sourceResultId','requestedUrl','finalUrl','httpStatus','contentType','capturedAt','sha256','byteCount','path','extractorLocator','captureToolName','captureToolVersion'])if(k in sourceArtifact)assert.deepEqual(artifact[k],sourceArtifact[k]);
 assert.equal(artifact.logicalKey,undefined);assert(f.path.includes('--'+sourceArtifact.logicalKey+'.'));assert(sourceArtifact.bodyRepresentation===undefined||sourceArtifact.bodyRepresentation==='EXACT');assert(!sourceArtifact.redactionDescriptors?.length);assert(!sourceArtifact.rawBodySha256);assert(!byLogical.has(sourceArtifact.logicalKey));if(!['ORACLE_RESULT','COMMAND_OUTPUT'].includes(artifact.kind))assert.equal(artifact.httpStatus,200);else assert.equal(artifact.httpStatus,undefined);
 bodies.set(sourceArtifact.logicalKey,b.toString('utf8'));byLogical.set(sourceArtifact.logicalKey,sourceArtifact);archiveFiles.push({path:f.path,sha256:f.sha256,byteCount:f.byteCount,logicalKey:sourceArtifact.logicalKey,capturedAt:artifact.capturedAt});
}
// Only the new archive supplies responses. The offline network guard denies all network I/O.
const captureAt=packet.legacyCertificate.observation.crawledAt;let replayIndex=0;const replayRequests:any[]=[];
let lastCaptured=Date.parse(captureAt);assert(lastCaptured>=Date.parse(terminal.startedAt));
for(const a of archive.sidecar.artifacts){const at=Date.parse(a.capturedAt);assert(at>=lastCaptured&&at<=Date.parse(terminal.finishedAt));lastCaptured=at;assert(a.bodyRepresentation===undefined||a.bodyRepresentation==='EXACT','BIOGEN_NATIVE_UNREDACTED_BODY_REQUIRED');}
const replay=await createWorkdaySourceFetch({now:()=>new Date(captureAt),http:async(req:any)=>{try{
 const a=archive.sidecar.artifacts[replayIndex++];assert(a,'EXTRA_NATIVE_REQUEST');assert.equal(req.url,a.requestedUrl);assert.equal(a.finalUrl,a.requestedUrl);assert.equal(req.method,'POST');assert.equal(req.url,'https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs');
 assert.deepEqual(JSON.parse(req.body),{appliedFacets:{locationCountry:['6cb77610a8a543aea2d6bc10457e35d4']},limit:20,offset:(replayIndex-1)*20});
 replayRequests.push({logicalKey:a.logicalKey,url:req.url,method:req.method??'GET',body:req.body??null,headers:req.headers,capturedAt:a.capturedAt,status:a.httpStatus});
 return {status:a.httpStatus,body:bodies.get(a.logicalKey)!,finalUrl:req.url,contentType:a.contentType,capturedAt:a.capturedAt};
}catch(error:any){writeFileSync(output+'.request-error.json',JSON.stringify({replayIndex,request:req,error:String(error),stack:error.stack,actual:error.actual,expected:error.expected},null,2));throw error;}
}})(plan);assert(replay.ok,'ARCHIVE_REPLAY_FAILED:'+JSON.stringify({ok:replay.ok,failureReason:('failureReason' in replay?replay.failureReason:null),replayIndex}));assert.equal(replayIndex,artifacts.length);assert(replay.fetchEvidence&&replay.paginationEvaluation);const nativeEvidence=replay.fetchEvidence;
// Workday filtered-list pagination is safe but not independently certificate-eligible.
// Native runSourceCrawl and strict source-quality replay below must prove completeness.
assert(replay.paginationEvaluation.safeCompleteness,JSON.stringify(replay.paginationEvaluation));assert.deepEqual(replay.paginationEvaluation.derivedAnomalyCodes,[]);
assert.equal(nativeEvidence.artifacts.length,artifacts.length);assert.equal(nativeEvidence.pages.length,pages.length);
for(const a of nativeEvidence.artifacts){const stored=byLogical.get(a.logicalKey);assert(stored);assert.equal(a.body,bodies.get(a.logicalKey));for(const k of ['kind','requestedUrl','finalUrl','httpStatus','contentType','capturedAt','bodyRepresentation','extractorLocator','channelId'])assert.deepEqual(a[k],stored[k],'NATIVE_ARTIFACT:'+a.logicalKey+':'+k);}
for(const a of artifacts){assert.equal(a.captureToolName,nativeEvidence.captureTool.name);assert.equal(a.captureToolVersion,nativeEvidence.captureTool.version);}
for(const [i,p]of replay.paginationEvaluation.pages.entries()){const a=byLogical.get(p.artifactLogicalKey),stored=pages[i];assert.equal(stored.artifactId,a.id);for(const [k,v]of Object.entries(p)){if(k==='artifactLogicalKey')continue;if(k==='channelId'&&v===null){assert.equal(stored[k],undefined);continue;}assert.deepEqual(stored[k],v instanceof Date?v.toISOString():v,'PAGINATION_FIELD:'+k);}}
for(const [k,v]of Object.entries(nativeEvidence.fetchCounts))assert.equal(terminal[k],v,'NATIVE_COUNT:'+k);
const losses=get('LossLedgerEntry');assert.deepEqual(losses,[]);assert.deepEqual(nativeEvidence.fetchLosses,[]);
const currentRows=receipt.members.filter((m:any)=>m.setKind==='CURRENT').map((m:any)=>{const row=proposed.get(m.jobKey)??old.get(m.jobKey);assert(row);return row;});
const nativeContext=await loadPilotContext(context,plan,false);
const nativeRun=await runSourceCrawl(plan,{fetch:async()=>replay,isBaseline:!nativeContext.baselineCompletedBeforeCrawl});assert.deepEqual(nativeRun.truth,{transportSuccess:true,adapterSuccess:true,completenessVerified:true});assert(nativeRun.reconciliation);
assert(validateStrictOfficialTotalCertificateEvidence({plan,evidence:nativeEvidence,paginationEvaluation:replay.paginationEvaluation,reconciliation:nativeRun.reconciliation,jobs:nativeRun.jobs}),'NATIVE_A_GRADE_OFFICIAL_TOTAL_GATE_FAILED');
const declaration=nativeEvidence.declaredCompleteness!;assert.equal(declaration.kind,'OFFICIAL_TOTAL_COUNT');assert.equal(declaration.scope,'SOURCE');assert.equal(declaration.value,currentRows.length);
const declaredArtifact=byLogical.get(declaration.artifactLogicalKey);assert(declaredArtifact);
const qualitySource=readFileSync(join(R,'c60-source/src/crawler/sourceQualityAdmission.ts'),'utf8');
const digestSnippet=qualitySource.slice(qualitySource.indexOf('function digest('),qualitySource.indexOf('function deepFreeze('));
const recordSnippet=qualitySource.slice(qualitySource.indexOf('function jobRecordsDigest('),qualitySource.indexOf('function artifactProjection('));
const digestCode=ts.transpileModule(digestSnippet+'\n'+recordSnippet+'\nreturn {digest,jobRecordsDigest};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const nativeDigest=new Function('createHash','buildJobDedupeKey',digestCode)(createHash,buildJobDedupeKey);
assert.equal(nativeDigest.digest(nativeEvidence),packet.legacyCertificate.sourceEvidenceSha256,'EXACT_NEW_BINARY_ENVELOPE_DIGEST');assert.equal(nativeDigest.jobRecordsDigest(nativeRun.jobs),packet.legacyCertificate.output.jobsSha256,'EXACT_NATIVE_JOB_DIGEST');
assert.equal(nativeRun.reconciliation!.ledgerSha256,packet.legacyCertificate.ledger.adapterReconciliationSha256);assert.equal(canonicalPageTraceSha256(nativeEvidence.pages),packet.legacyCertificate.paginationTraceSha256);assert.equal(canonicalStringSetSha256(nativeEvidence.pages.flatMap(p=>p.rawJobIds)),packet.legacyCertificate.canonicalRawEvidenceIdSetSha256);
assert(replayStrictSourceQualityEvidence({plan,evidence:nativeEvidence,paginationEvaluation:replay.paginationEvaluation,reconciliation:nativeRun.reconciliation!,jobs:nativeRun.jobs,capturedAt:captureAt}),'SOURCE_QUALITY_NATIVE_STRICT_REPLAY');
assert(typeof receipt.legacyCertificateSha256==='string');assert(typeof terminal.batchId==='string');verifySourceQualityReceipt({receipt:packet.legacyCertificate,receiptSha256:receipt.legacyCertificateSha256,expected:{releaseCandidateId:terminal.releaseCandidateId,batchId:terminal.batchId,sourceResultId:terminal.id,sourceId:terminal.sourceId,sourceConfigSha256:terminal.sourceConfigHash,adapterVersion:terminal.adapterVersion}});
const deadlineProof=assertBiogenPacketDeadline({terminal,legacyCertificate:packet.legacyCertificate,request,originalOuterDeadline});
// Workday JSON/facets/identities/cities are independently checked; no HTML protocol reuse.
const nativePages=nativeEvidence.pages;
const sourceRows=reviewBiogenRawPages(nativePages.map((p:any)=>bodies.get(p.artifactLogicalKey)!),currentRows,nativeRun.jobs);
const rawIds=sourceRows.map(r=>r.sourceJobId).sort(),currentIds=currentRows.map((j:any)=>j.sourceJobId).sort(),nativeIds=nativeRun.jobs.map((j:any)=>j.sourceJobId).sort();assert.deepEqual(rawIds,currentIds);assert.deepEqual(currentIds,nativeIds);assert.equal(new Set(currentIds).size,currentIds.length);
const diagnostics=readFileSync(join(run,'diagnostics/http-requests.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(diagnostics.length,2*replayRequests.length);for(const [i,r]of replayRequests.entries()){const start=diagnostics[i*2],headers=diagnostics[i*2+1];assert.equal(start.event,'REQUEST_START');assert.equal(headers.event,'HEADERS_RECEIVED');assert.equal(start.requestId,headers.requestId);assert.equal(headers.status,200);assert.equal(start.timeoutMs,45000);assert.equal(headers.timeoutMs,45000);assert.equal(start.url.origin,'https://biibhr.wd3.myworkdayjobs.com');assert.equal(headers.url.origin,start.url.origin);assert.deepEqual(start.url,headers.url);assert(Date.parse(start.recordedAt)>=Date.parse(terminal.startedAt));assert(Date.parse(headers.recordedAt)<=Date.parse(r.capturedAt));assert(Date.parse(r.capturedAt)<=Date.parse(terminal.finishedAt));}
const scopeNegativeTests:any[]=[];for(const [name,mutate]of [
 ['modified official total',(e:any)=>{const b=JSON.parse(e.artifacts[0].body);b.total++;e.artifacts[0].body=JSON.stringify(b);}],
 ['changed first row ID',(e:any)=>{const b=JSON.parse(e.artifacts[0].body);if(b.jobPostings.length)b.jobPostings[0].bulletFields=['REQ999'];else b.total++;e.artifacts[0].body=JSON.stringify(b);}],
 ['modified request contract',(e:any)=>{e.artifacts[0].extractorLocator+='0';}],
 ['dropped final page',(e:any)=>{e.pages.pop();}],
 ['changed valid count',(e:any)=>{e.fetchCounts.validCount+=1;}]
]as const){const e=structuredClone(nativeEvidence),before=JSON.stringify(e);mutate(e);assert.notEqual(JSON.stringify(e),before);const nativeStrictGateAccepted=validateStrictOfficialTotalCertificateEvidence({plan,evidence:e,paginationEvaluation:replay.paginationEvaluation,reconciliation:nativeRun.reconciliation,jobs:nativeRun.jobs});const actualReceiptDigestMatched=nativeDigest.digest(e)===packet.legacyCertificate.sourceEvidenceSha256;assert.equal(nativeStrictGateAccepted&&actualReceiptDigestMatched,false,name);scopeNegativeTests.push({name,nativeStrictGateAccepted,actualReceiptDigestMatched,rejectedByFullReceiptBoundGate:true});}
assert.equal(through,new Date(Math.max(Date.parse(terminal.startedAt),Date.parse(terminal.finishedAt),...artifacts.map((a:any)=>Date.parse(a.capturedAt)))).toISOString());
const biogenReview={status:'PASS_PORTABLE_NATIVE_OFFICIAL_TOTAL_WITH_DETAIL_APPLICATION_UNKNOWN',officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,officialTotal:declaration.value,nativePages,sourceRows,rawIds,currentIds,nativeIds,rawMinusCurrent:[],currentMinusRaw:[],exactArchiveOnlyProducerReplay:true,exactNativeSourceEvidenceDigest:true,exactNativeJobsDigest:true,sourceQualityReceiptVerified:true,supportsStrictOfficialTotal:true,allNativeRequestsAccounted:true,replayRequests,bodyRepresentation:'EXACT',archiveBytesMatchOriginalHttpArtifact:true,detailArtifactsCaptured:0,applicationArtifactsCaptured:0,applicationAvailability:'UNKNOWN',detailAvailability:'UNKNOWN',detailEvidenceState:receipt.detailEvidenceState,allRawRowsPreserved:true,scopeNegativeTests,ageBasedExclusions:0,exactPublishedDateInferred:false,officialChainReacquired:false,alternateScopeEntryReacquired:false,httpDiagnosticsAllRequestPairsAccounted:true};
assert.equal(git('status','--porcelain'),'');assert.deepEqual(createBuildIdentity(join(R,'c60-source'),control.build.commitSha),control.build);assert(Date.now()<Date.parse(request.payload.dispatchBefore));assert(Date.now()<Date.parse(request.expiresAt));
assert.equal(originalOuterDeadline,readBiogenOriginalDeadline(runArg),'BIOGEN_ORIGINAL_DEADLINE_PROVENANCE');
assertBiogenPacketDeadline({terminal,legacyCertificate:packet.legacyCertificate,request,originalOuterDeadline});
const review={deadlineProof,classification:'INDEPENDENT_FULL_BIOGEN_C60_PORTABLE_PACKET_REVIEW_PASS',reviewedAt:new Date().toISOString(),requestId,requestSha256:request.requestSha256,sqlSha256:sha(sql),sqlBytes:Buffer.byteLength(sql),dispatchBefore:request.payload.dispatchBefore,expiresAt:request.expiresAt,runtimeVerification,compilerCommit:git('rev-parse','HEAD'),compilerFileSha256:sha(compilerSource),compilerSnippetSha256:sha(snip),controlsExactOriginalRecompile:true,allMutationBytesConsumed:true,mutationsExactOriginalCompilerRecompile:true,tuple,terminalStates:{transport:terminal.transportState,adapter:terminal.adapterState,completeness:terminal.completenessState,atomicCommit:terminal.atomicCommitState},counts:{raw:terminal.rawCount,current:kinds.CURRENT,grace:kinds.GRACE,visible:kinds.VISIBLE,deltaMembers:receipt.members.length,jobWrites:jobs.length,newJobs:newCount,changedExistingJobs:changedCount,unchangedVisibleJobsOmitted:unchangedOmittedCount,artifacts:artifacts.length,pages:pages.length,observations:observations.length},archive:{path:archivePath,sha256:sha(archiveBytes),bytes:archiveBytes.length,allChunksHashesAndDiskBytesVerified:true,files:archiveFiles,remotePersistenceNotProven:true},biogenReview,tableOrder:tables,statementTableOrder:statementTables,lossLedgerEntries:losses,jobChanges,negativeTests,checkerSha256:sha(readFileSync(import.meta.filename)),networkUsed:false,databaseWrites:false,producerModified:false,readerProjectionPending:true};
writeFileSync(output+'.decoded.json',JSON.stringify({terminal,context,decoded,receipt,plan},null,2)+'\n',{flag:'wx',mode:0o600});writeFileSync(output,JSON.stringify(review,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({classification:review.classification,counts:review.counts,officialTotal:declaration.value,dispatchBefore:review.dispatchBefore}));

return {review,decoded:{terminal,context,decoded,receipt,plan}};
}
