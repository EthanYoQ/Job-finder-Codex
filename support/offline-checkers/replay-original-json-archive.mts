import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const B='/workspace/scratch/5e9614251709',V=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source';
const run=process.argv[2],d=JSON.parse(fs.readFileSync(run+'/review/PACKET_REVIEW.json.decoded.json','utf8')),a=JSON.parse(fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.archive.json','utf8'));
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const {createOfficialJsonSourceFetch}=await import(V+'/src/crawler/officialJsonSourceFetch.ts');
const {createPresenceCheckedHttpHtmlSourceFetch}=await import(V+'/src/crawler/httpHtmlSourceFetch.ts');
const ab=['a-grade-official-total-v2','b-grade-independent-traversal-v2'].includes(d.receipt.legacyCertificate.schemaVersion);
if(!ab)assert(['source-ucb-china-social','source-viatris-social','source-hansoh-social','source-takeda-china-social','source-merck-china-social','source-fosun-pharma-social','source-cspc-social','source-abbvie-china-social','source-bms-china-social','source-boehringer-ingelheim-china-social','source-gilead-china-social','source-kelun-social','source-novartis-social','source-novo-nordisk-china-social','source-organon-china-social','source-qilu-social','source-grifols-china-social'].includes(d.terminal.sourceId));let originalFetch:any=d.plan.adapterId==='html-table'?createPresenceCheckedHttpHtmlSourceFetch:createOfficialJsonSourceFetch;
if(!ab&&d.plan.profileBoundSource){
 const kind=d.plan.profileBoundSource.kind;
 if(kind==='qilu-dual-official'){
  const {createQiluDualPartitionSourceFetch}=await import(V+'/src/crawler/qiluDualPartitionSourceFetch.ts');
  originalFetch=(deps:any)=>createQiluDualPartitionSourceFetch({now:deps.now,marketingHttp:deps.http,nonMarketingHttp:deps.http});
 }else if(kind==='grifols-china-detail-scope'){
  const {createGrifolsChinaSourceFetch}=await import(V+'/src/crawler/grifolsChinaSourceFetch.ts');
  originalFetch=createGrifolsChinaSourceFetch;
 }else throw Error('UNIMPLEMENTED_PORTABLE_PROFILE');
}
if(ab){
 const {createSourceFetchRouter}=await import(V+'/src/crawler/sourceFetchRouter.ts');
 const {createMokaSourceFetch}=await import(V+'/src/crawler/mokaSourceFetch.ts');
 const {createWorkdaySourceFetch}=await import(V+'/src/crawler/workdaySourceFetch.ts');
 const {createHotjobLegacySourceFetch}=await import(V+'/src/crawler/hotjobLegacySourceFetch.ts');
 const {createAmgenManualWorkdaySourceFetch}=await import(V+'/src/crawler/amgenManualWorkdaySourceFetch.ts');
 const {createMsdAjingaSourceFetch}=await import(V+'/src/crawler/msdAjingaSourceFetch.ts');
 const rows=JSON.parse(fs.readFileSync(path.resolve(V,'../../config/native-catalog.json'),'utf8')).routingCatalogue;
 assert(rows.some((r:any)=>r.sourceId===d.plan.source.id&&(r.route==='TRUE_A'&&r.sourceId!=='source-johnson-innovative-medicine-social'||r.route==='TRUE_B'&&r.sourceId==='source-pfizer-china-social')),'UNIMPLEMENTED_AB_ROUTE');
 assert.notEqual(d.plan.source.id,'source-astrazeneca-social','ASTRAZENECA_OWNED_DETAIL_REPLAY_NOT_WIRED');
 originalFetch=(deps:any)=>{const fail=()=>{throw Error('UNIMPLEMENTED_OFFLINE_SOURCE');};
  const profiles:any={'amgen-manual-workday-lookup':createAmgenManualWorkdaySourceFetch(deps),'msd-ajinga':createMsdAjingaSourceFetch({...deps,http:(url:string)=>deps.http({url,method:'GET'})})};
  return createSourceFetchRouter({html:createPresenceCheckedHttpHtmlSourceFetch(deps),moka:createMokaSourceFetch(deps),officialJson:createOfficialJsonSourceFetch(deps),workday:createWorkdaySourceFetch({...deps,detailHttp:deps.http}),hotjobLegacy:createHotjobLegacySourceFetch(deps),profileBoundSource:(plan:any)=>(profiles[plan.profileBoundSource?.kind]??fail)(plan),fallback:fail,delay:async()=>{throw Error('OFFLINE_REPLAY_RETRY_REQUIRES_EXACT_ATTEMPT_EVIDENCE');}});
 };
}
const {sanitizeEvidenceHttpUrl}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
const {runSourceCrawl,replayStrictSourceQualityEvidence}=await import(V+'/src/crawler/runSourceCrawl.ts');
const {loadPilotContext}=await import(V+'/src/crawler/cloudPilotContext.ts');
const {buildJobDedupeKey}=await import(V+'/src/crawler/normalizedJob.ts');
const {verifySourceQualityReceipt}=await import(V+'/src/crawler/sourceQualityAdmission.ts');
const ts=(await import(V+'/node_modules/typescript/lib/typescript.js')).default;
const bodies=new Map();for(const f of a.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));const bytes=Buffer.concat(f.chunks.map((s:string)=>Buffer.from(s,'base64')));assert.equal(bytes.length,f.byteCount);assert.equal(sha(bytes),f.sha256);assert(bytes.equals(fs.readFileSync(path.join(run,'artifacts',f.path))));bodies.set(f.path,bytes.toString('utf8'));}
const httpArtifacts=a.sidecar.artifacts.filter((x:any)=>typeof x.requestedUrl==='string'&&x.logicalKey!=='qilu-required-partitions-declaration');
let i=0, replayNow=Date.parse(d.receipt.observedAt);const requests:any[]=[];const capture=d.receipt.observedAt;const replay=await originalFetch({allowBrowserFallback:false,now:()=>new Date(replayNow),http:async(req:any)=>{const artifact=httpArtifacts[i++];assert(artifact,'EXTRA_REQUEST');const requested=new URL(req.url);assert.equal(ab||d.plan.profileBoundSource||d.plan.adapterId==='html-table'||d.terminal.sourceId==='source-cspc-social'?sanitizeEvidenceHttpUrl(req.url):requested.origin+requested.pathname,artifact.requestedUrl);if(i===1&&d.plan.adapterId==='html-table')assert.equal(req.url,d.plan.source.officialEntryUrl);assert.equal(artifact.httpStatus,200);replayNow=Date.parse(artifact.capturedAt);requests.push({url:req.url,method:req.method??'GET',body:req.body??null,capturedAt:artifact.capturedAt});return {status:artifact.httpStatus,body:bodies.get(artifact.path),finalUrl:req.url,contentType:artifact.contentType,capturedAt:artifact.capturedAt};}})(d.plan);
assert(replay.ok,JSON.stringify(replay));assert.equal(i,httpArtifacts.length);assert(replay.fetchEvidence&&replay.paginationEvaluation);
if(ab){assert.equal(replay.fetchEvidence.artifacts.length,a.sidecar.artifacts.length,'EXACT_RAW_ARTIFACT_SET');for(const [index,artifact] of replay.fetchEvidence.artifacts.entries()){const saved=a.sidecar.artifacts[index];assert.equal(artifact.logicalKey,saved.logicalKey);assert.equal(sha(artifact.body),saved.sha256,'EXACT_RAW_OR_DERIVED_BODY');assert.equal(artifact.requestedUrl,saved.requestedUrl);assert.equal(artifact.capturedAt,saved.capturedAt);}}const ctx=await loadPilotContext(d.context,d.plan,ab);const native=await runSourceCrawl(d.plan,{fetch:async()=>replay,isBaseline:!ctx.baselineCompletedBeforeCrawl});assert.deepEqual(native.truth,{transportSuccess:true,adapterSuccess:true,completenessVerified:true});
let certificateReplay:any;
if(ab){
 const {reviewOriginalABCertificate}=await import('./original-ab-certificate-review.mts');
 const independent=d.receipt.legacyCertificate.schemaVersion==='b-grade-independent-traversal-v2'?JSON.parse(fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.independent-validation.json','utf8')):undefined;
 certificateReplay=await reviewOriginalABCertificate(V,d,native,independent);
 const current=d.receipt.members.filter((m:any)=>m.setKind==='CURRENT').map((m:any)=>m.jobKey).sort();
 assert.deepEqual(native.jobs.map(buildJobDedupeKey).sort(),current,'EXACT_CURRENT_JOB_IDS');
 const effective=new Map(d.context.jobs.map((row:any)=>[row.dedupeKey,row]));
 for(const row of d.decoded.filter((x:any)=>x.table==='Job').flatMap((x:any)=>x.rows))effective.set(row.dedupeKey,{...row,...row.__update});
 for(const job of native.jobs){const row:any=effective.get(buildJobDedupeKey(job));assert(row);
  for(const key of ['companyId','sourceId','officialTitle','officialUrl','locationRaw','cities'])assert.deepEqual(row[key],job[key],'RAW_JOB_'+key);
  for(const key of ['sourceJobId','listUrl'])assert.equal(row[key],job[key]??null,'RAW_JOB_'+key);
  assert.equal(row.city,job.cities[0]);
  assert.equal(row.officialPublishedAt==null?null:new Date(/[Zz]|[+-]\d\d:\d\d$/.test(row.officialPublishedAt)?row.officialPublishedAt:row.officialPublishedAt+'Z').toISOString(),job.officialPublishedAt??null,'RAW_JOB_DATE');
 }
}else{
const source=fs.readFileSync(V+'/src/crawler/sourceQualityAdmission.ts','utf8');const snippets=source.slice(source.indexOf('function digest('),source.indexOf('function deepFreeze('))+'\n'+source.slice(source.indexOf('function jobRecordsDigest('),source.indexOf('function artifactProjection('));const code=ts.transpileModule(snippets+'\nreturn {digest,jobRecordsDigest}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;const digest=new Function('createHash','buildJobDedupeKey',code)(createHash,buildJobDedupeKey);
assert.equal(digest.digest(replay.fetchEvidence),d.receipt.legacyCertificate.sourceEvidenceSha256,'EXACT_SOURCE_EVIDENCE_DIGEST');assert.equal(digest.jobRecordsDigest(native.jobs),d.receipt.legacyCertificate.output.jobsSha256,'EXACT_NATIVE_JOBS');assert(replayStrictSourceQualityEvidence({plan:d.plan,evidence:replay.fetchEvidence,paginationEvaluation:replay.paginationEvaluation,reconciliation:native.reconciliation,jobs:native.jobs,capturedAt:capture}));
verifySourceQualityReceipt({receipt:d.receipt.legacyCertificate,receiptSha256:d.receipt.legacyCertificateSha256,expected:{releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceResultId:d.terminal.id,sourceId:d.terminal.sourceId,sourceConfigSha256:d.terminal.sourceConfigHash,adapterVersion:d.terminal.adapterVersion}});
}
const report={status:'PASS',classification:'ORIGINAL_NATIVE_ARCHIVE_EXACT_REPLAY',sourceId:d.terminal.sourceId,capturedAt:capture,requests,jobCount:native.jobs.length,allRawHashesVerified:true,exactNativeEvidenceAndJobsDigests:!ab,originalStrictQualityReplay:!ab,...(certificateReplay?{certificateReplay}:{}),networkUsed:false};fs.writeFileSync(run+'/review/NATIVE_RAW_REPLAY.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
