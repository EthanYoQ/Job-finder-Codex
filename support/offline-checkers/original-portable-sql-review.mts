import {compileAtomicJsonRecords as originalSqlRecords} from '/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/db/atomicJsonDeclarations.ts';

/** Local read-only SQL parser/recompiler. Never submits SQL or edits producer/run. */
import assert from 'node:assert/strict';
import {verifyNodeRuntimeProfile} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/scripts/verify-node-runtime-profile.ts";
import {createBuildIdentity} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/readiness/buildIdentity.ts";

import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/typescript/lib/typescript.js";
import {decodeDeclarations} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/native/review-packet-envelope.mts";
import {prepareCloudPilotDbStartedControl,publicationContextComparisonValue,CLOUD_PILOT_SOURCE} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/db/cloudPilotSqlControl.ts";
import {deriveCurrentStagedScheduleExpectation} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/stagedScheduleAuthority.ts";
import {buildPendingRuntimeBatch} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts";
import {hashCanonicalStringSet} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/runtimeBatchIdentity.ts";
import {JOB_SOURCE_UPDATE_FIELDS,parseJobProjectionDeltaReceipt,hashJobPersistedProjection} from "/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts";
export async function reviewOriginalPortableSql(runArg:string,requestId:string,output:string,{originalOuterDeadline,publicationContext}: {originalOuterDeadline:number;publicationContext?:any}){
assert(runArg&&requestId&&output);
assert(Number.isFinite(originalOuterDeadline)&&Date.now()<originalOuterDeadline);
const R=resolve("/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/native",'../vendor'),run=resolve(runArg),host=resolve(run,'..');
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
const {terminal,context:packetContext}=decodeDeclarations(declarations[2]);
const context=packetContext.snapshotSha256?publicationContext:packetContext;assert(context,'READ_CONTEXT_REQUIRED');assert.deepEqual(publicationContextComparisonValue(context),packetContext,'READ_CONTEXT_BINDING');
const legacyCertificate=terminal.completenessCertificate.legacyCertificate;
const ab=cfg.mode==='NATIVE_AB_CONNECTOR_V1';
if(ab)assert(['a-grade-official-total-v2','b-grade-independent-traversal-v2'].includes(legacyCertificate.schemaVersion)||(terminal.sourceId==='source-sanofi-china-social'&&legacyCertificate.schemaVersion==='sanofi-cn-dual-chain-attestation-v1'));else{assert.equal(legacyCertificate.schemaVersion,'plan-bound-source-quality-v1');assert.equal(legacyCertificate.policyId,'PLAN_BOUND_SOURCE_QUALITY_V1');}const packet={terminal,context,legacyCertificate};
const registered=json(join(host,'expected-candidate.json'));for(const k of ['id','goalId','status','version','commitSha','rosterHash','schemaHash','oracleVersion','dbSnapshotHash','sourcePlanHash','sourceTreeHash','runtimeTreeHash','migrationVersion','sourceConfigHash','adapterBundleHash','minimumStableCompanyCount'])assert.deepEqual(context.candidateRow[k],registered[k],'REGISTERED_16_FIELD:'+k);
for(const[k,v]of Object.entries(control.databaseIdentity))assert.deepEqual(context.candidateRow[k],v,'DATABASE_IDENTITY:'+k);
assert.equal(terminal.sourceId,cfg.sourceId);assert.equal(terminal.batchId,run.split('/').at(-1));assert.equal(terminal.releaseCandidateId,control.candidate.id);assert.equal(terminal.id,terminal.batchId+'--'+cfg.sourceId);
const compilerPath=join(R,'c60-source/src/db/ingestionRepository.ts'),compilerSource=readFileSync(compilerPath,'utf8');
const snip=compilerSource.slice(compilerSource.indexOf('function compileAtomicWriteStatements('),compilerSource.indexOf('const LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL'));
assert(snip.startsWith('function compileAtomicWriteStatements(')&&compilerSource.includes('compileAtomicJsonRecords as sqlRecords'));
const terminalSnip=compilerSource.slice(compilerSource.indexOf('function sourceResultTerminalData('),compilerSource.indexOf('const ATOMIC_SOURCE_RESULT_FIELDS'));
let uuidQueue:string[]=[];
const transpiled=ts.transpileModule(snip+'\n'+terminalSnip+'\nreturn {compileAtomicWriteStatements,sqlRecords,sourceResultTerminalData};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const original=new Function('sqlRecords','randomUUID','JOB_SOURCE_UPDATE_FIELDS','fromPrismaJobCategory','fromPrismaRequiredJobField',transpiled)(originalSqlRecords,()=>{assert(uuidQueue.length,'unexpected original compiler UUID');return uuidQueue.shift();},JOB_SOURCE_UPDATE_FIELDS,(v:any)=>v,(v:any)=>v);
// Parse only the literal/tuple JSON forms emitted by original sqlRecords. No eval.
function parseRows(s:string,start:number){let i=start;
 const take=(x:string)=>{assert.equal(s.slice(i,i+x.length),x,'SQL_GRAMMAR '+i);i+=x.length;};
 const literal=()=>{take("E'");let value='';while(i<s.length){let c=s[i++];if(c==='\\'){assert.equal(s[i++],'\\');value+='\\';}else if(c==="'"){if(s[i]==="'"){i++;value+="'";}else return value;}else value+=c;}throw Error('unclosed SQL literal');};
 const jsonLiteral=()=>{const v=JSON.parse(literal());take('::jsonb');return v;};
 if(s.startsWith("E'",i)){const rows=jsonLiteral();assert(Array.isArray(rows));return {rows,end:i};}
 if(s.startsWith("(SELECT jsonb_agg(member.value || jsonb_build_object('id', ",i)){
  take("(SELECT jsonb_agg(member.value || jsonb_build_object('id', ");const ids=jsonLiteral();
  take("->(member.ordinality::int-1)) ORDER BY member.ordinality)\n    FROM jsonb_array_elements(source_result_data->'completenessCertificate'->'members') WITH ORDINALITY AS member(value, ordinality))");
  const members=terminal.completenessCertificate.members;assert(Array.isArray(ids));assert.equal(ids.length,members.length);
  const keys=['releaseCandidateId','batchId','sourceId','sourceResultId','setKind','jobKey','jobKeySha256','lifecycleStatus','missingCount'];
  return {rows:members.map((member:any,n:number)=>({id:ids[n],...Object.fromEntries(keys.map(k=>[k,member[k]]))})),end:i};
 }
 take('(SELECT jsonb_agg(');const common=jsonLiteral();assert(common&&!Array.isArray(common));take(' || jsonb_build_object(');const fields:any[]=[];
 while(!s.startsWith(') ORDER BY tuple.ordinality)',i)){if(fields.length)take(', ');const key=literal();take(', tuple.value->');const m=/^\d+/.exec(s.slice(i));assert(m);i+=m[0].length;assert(!fields.some(x=>x[0]===key));assert(!Object.hasOwn(common,key));fields.push([key,Number(m[0])]);}
 take(') ORDER BY tuple.ordinality)\n    FROM jsonb_array_elements(');const tuples=jsonLiteral();take(') WITH ORDINALITY AS tuple(value, ordinality))');assert(Array.isArray(tuples));
 return {rows:tuples.map((t:any)=>{assert(Array.isArray(t));const used=new Set(fields.map(x=>x[1]));assert.equal(used.size,t.length);assert([...used].every((v:any)=>v<t.length));return {...common,...Object.fromEntries(fields.map(([k,n])=>[k,t[n]]))};}),end:i};
}
const e=deriveCurrentStagedScheduleExpectation(control.build),plan=e.plans.find((x:any)=>x.source.id===cfg.sourceId)!;assert(plan);
const c=context.candidateRow;
const planned=buildPendingRuntimeBatch(terminal.batchId,[plan],{releaseCandidateId:c.id,commitSha:c.commitSha,rosterSha256:c.rosterHash,sourcePlanSha256:c.sourcePlanHash,sourceConfigSha256:c.sourceConfigHash,adapterBundleSha256:c.adapterBundleHash,batchKind:'SCHEDULED',ownerId:CLOUD_PILOT_SOURCE.ownerId,expectedPlannedSourceIds:[cfg.sourceId],expectedPlannedSourceSetSha256:hashCanonicalStringSet([cfg.sourceId]),expectedPlannedSourceCount:1},new Date(terminal.startedAt));
function verifyFullBody(sql:string){
const bodyMatch=/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\nDECLARE affected bigint; job_data jsonb; [\s\S]*? current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\n([\s\S]*)\nEND;\n\1;$/.exec(sql);assert(bodyMatch);const body=bodyMatch[2]!;
const holder=/UPDATE public\."CrawlCoordinatorLock" SET "holderId"=E'([a-f0-9-]{36})'/.exec(body)?.[1];assert(holder);
const through=/IF E'([^']+)'::timestamptz>clock_timestamp\(\)\+interval '1 second'/.exec(body)?.[1];assert(through);
// Shared JSON declarations restore nested certificate last; native matches emits original insertion order.
const terminalGuard=/PERFORM 1 FROM public\."CrawlBatchSourceResult" s WHERE[^\n]+source_result_data[^\n]+FOR SHARE;/.exec(body);assert(terminalGuard);
const terminalKeys=[...terminalGuard[0].matchAll(/s\."([^"]+)" IS NOT DISTINCT FROM expected\."\1"/g)].map(m=>m[1]);assert.deepEqual([...terminalKeys].sort(),Object.keys(terminal).sort());
const originalOrderedTerminal=Object.fromEntries(terminalKeys.map(k=>[k,terminal[k]]));
const controls=prepareCloudPilotDbStartedControl({...control,planned,context},originalOrderedTerminal,holder,request.expiresAt,through,ab?undefined:'PLAN_BOUND_SOURCE_QUALITY_V1');
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
 const compiled=original.compileAtomicWriteStatements(writes,()=>{},true,terminal.finishedAt,undefined,terminal.completenessCertificate.members).join('\n');assert.equal(uuidQueue.length,0,'UUID queue mismatch');assert.equal(compiled,stmt,'ORIGINAL_MUTATION_TEMPLATE_MISMATCH');regenerated.push(compiled);offset+=stmt.length;if(offset<middle.length){assert.equal(middle[offset],'\n');offset++;}
}
assert.equal(regenerated.join('\n'),middle,'BODY_NOT_FULLY_RECONSTRUCTED');
return {decoded,through,plan};
}
const {decoded,through}=verifyFullBody(sql);
const negativeCases=[
 ['arbitrary inserted SQL',sql.replace('\nINSERT INTO public."EvidenceArtifact"','\nPERFORM pg_sleep(1);\nINSERT INTO public."EvidenceArtifact"')],
 ['weakened context guard',sql.replace(/IF [^\n]* THEN RAISE EXCEPTION 'PILOT_CONTEXT_CHANGED'; END IF;/,"IF false THEN RAISE EXCEPTION 'PILOT_CONTEXT_CHANGED'; END IF;")],
 ['removed coordinator release',sql.replace("SET \"holderId\"='',\"heartbeatAt\"=clock_timestamp(),metadata='portable-quality-sync-v1:released'","SET \"holderId\"='retained',\"heartbeatAt\"=clock_timestamp(),metadata='portable-quality-sync-v1:released'")],
 ['arbitrary trailing SQL',sql+'\nSELECT 1;'],
 ['altered update target scope',sql.replace('target."sourceId" = E\''+cfg.sourceId+'\'','target."sourceId" = E\'source-other\'')],
 ['arbitrary delete in body',sql.replace('\nINSERT INTO public."EvidenceArtifact"','\nDELETE FROM public."Job";\nINSERT INTO public."EvidenceArtifact"')]
];
const negativeTests=negativeCases.filter(([name,mutated])=>mutated!==sql).map(([name,mutated])=>{assert.notEqual(mutated,sql,name+' not applied');assert.throws(()=>verifyFullBody(mutated),name);return {name,rejected:true};});
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

const review={classification:ab?'ORIGINAL_AB_SQL_RECOMPILE_PASS':'ORIGINAL_GENERIC_PORTABLE_SQL_RECOMPILE_PASS',reviewedAt:new Date().toISOString(),requestId,requestSha256:request.requestSha256,sqlSha256:sha(sql),dispatchBefore:request.payload.dispatchBefore,expiresAt:request.expiresAt,controlsExactOriginalRecompile:true,allMutationBytesConsumed:true,mutationsExactOriginalCompilerRecompile:true,tuple,counts:{current:kinds.CURRENT,grace:kinds.GRACE,visible:kinds.VISIBLE,jobWrites:jobs.length,newJobs:newCount,changedExistingJobs:changedCount},negativeTests,sourceRawReplayPending:true};
writeFileSync(output+'.decoded.json',JSON.stringify({terminal,context,decoded,receipt,plan},null,2),{flag:'wx',mode:0o600});writeFileSync(output,JSON.stringify(review,null,2),{flag:'wx',mode:0o600});return {review,decoded:{terminal,context,decoded,receipt,plan}};
}
