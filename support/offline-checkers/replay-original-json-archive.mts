import {assertMokaArchivedRequest} from './moka-archive-request.mts';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const B='/workspace/scratch/5e9614251709',V=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source';
const run=process.argv[2],d=JSON.parse(fs.readFileSync(run+'/review/PACKET_REVIEW.json.decoded.json','utf8')),a=JSON.parse(fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.archive.json','utf8'));
assert.equal(a.schemaVersion,1);for(const[k,v]of Object.entries({releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceId:d.terminal.sourceId,sourceResultId:d.terminal.id}))assert.equal(a.sidecar[k],v);
assert.equal(a.files.length,d.decoded.filter((x:any)=>x.table==='EvidenceArtifact').flatMap((x:any)=>x.rows).length);
if(Object.hasOwn(d,'receipt'))assert.deepEqual(d.receipt,d.terminal.completenessCertificate,'PACKET_RECEIPT_MISMATCH');
d.receipt=d.terminal.completenessCertificate;
const sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const {createOfficialJsonSourceFetch}=await import(V+'/src/crawler/officialJsonSourceFetch.ts');
const {createPresenceCheckedHttpHtmlSourceFetch}=await import(V+'/src/crawler/httpHtmlSourceFetch.ts');
const httpHtmlFetch=(deps:any)=>createPresenceCheckedHttpHtmlSourceFetch({...deps,http:(req:any)=>deps.http(req,replayHtmlEvidenceUrl)});
const officialJsonFetch=(deps:any)=>createOfficialJsonSourceFetch({...deps,http:(req:any)=>deps.http(req,safeOfficialJsonEvidenceUrl)});
const bi=d.terminal.sourceId==='source-boehringer-ingelheim-china-social';
const novo=d.terminal.sourceId==='source-novo-nordisk-china-social';
const astellas=d.terminal.sourceId==='source-astellas-china-social',astrazeneca=d.terminal.sourceId==='source-astrazeneca-social',jnj=d.terminal.sourceId==='source-johnson-innovative-medicine-social';
const {isCurrentBGradeCertificateSchema,SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION,SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION,BAYER_INDEPENDENT_ORIGINAL_LOCATOR}=await import(V+'/src/crawler/traversalCertificate.ts');
const bayerCompact=d.receipt.legacyCertificate.schemaVersion===BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION;
const compact=d.receipt.legacyCertificate.schemaVersion===SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION||bayerCompact;
const ab=d.receipt.legacyCertificate.schemaVersion==='a-grade-official-total-v2'||isCurrentBGradeCertificateSchema(d.receipt.legacyCertificate.schemaVersion);
const independentArtifacts=compact?a.sidecar.artifacts.filter((x:any)=>x.extractorLocator===(bayerCompact?BAYER_INDEPENDENT_ORIGINAL_LOCATOR:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR)):[];
if(compact){assert.equal(d.terminal.sourceId,bayerCompact?'source-bayer-healthcare-social':'source-sanofi-china-social');assert.equal(independentArtifacts.length,1,'SANOFI_INDEPENDENT_ARCHIVE_REQUIRED');assert.equal(independentArtifacts[0].kind,'COMMAND_OUTPUT');assert.equal(independentArtifacts[0].bodyRepresentation,'EXACT');}
const mainArtifacts=compact?a.sidecar.artifacts.filter((x:any)=>x!==independentArtifacts[0]):a.sidecar.artifacts;
const moka=ab&&d.plan.source.atsKind==='MOKA';
if(!ab&&!astellas)assert(['source-ucb-china-social','source-viatris-social','source-hansoh-social','source-takeda-china-social','source-merck-china-social','source-fosun-pharma-social','source-cspc-social','source-abbvie-china-social','source-bms-china-social','source-boehringer-ingelheim-china-social','source-gilead-china-social','source-kelun-social','source-novartis-social','source-novo-nordisk-china-social','source-organon-china-social','source-qilu-social','source-grifols-china-social'].includes(d.terminal.sourceId));let originalFetch:any=d.plan.adapterId==='html-table'?httpHtmlFetch:officialJsonFetch;
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
 assert(rows.some((r:any)=>r.sourceId===d.plan.source.id&&(r.route==='TRUE_A'||r.route==='TRUE_B'&&['source-pfizer-china-social','source-bayer-healthcare-social','source-servier-china-social','source-sanofi-china-social'].includes(r.sourceId))),'UNIMPLEMENTED_AB_ROUTE');
 originalFetch=(deps:any)=>{const fail=()=>{throw Error('UNIMPLEMENTED_OFFLINE_SOURCE');};
  const profiles:any={'amgen-manual-workday-lookup':createAmgenManualWorkdaySourceFetch(deps),'msd-ajinga':createMsdAjingaSourceFetch({...deps,http:(url:string)=>deps.http({url,method:'GET'})})};
  return createSourceFetchRouter({html:httpHtmlFetch(deps),moka:createMokaSourceFetch(deps),officialJson:officialJsonFetch(deps),workday:createWorkdaySourceFetch({...deps,detailHttp:deps.http}),hotjobLegacy:createHotjobLegacySourceFetch(deps),profileBoundSource:(plan:any)=>(profiles[plan.profileBoundSource?.kind]??fail)(plan),fallback:fail,delay:async()=>{throw Error('OFFLINE_REPLAY_RETRY_REQUIRES_EXACT_ATTEMPT_EVIDENCE');}});
 };
}
if(jnj){
 assert(ab&&d.receipt.legacyCertificate.schemaVersion==='a-grade-official-total-v2','JNJ_ORIGINAL_A_REQUIRED');
 const {createJnjCareersDomSourceFetch}=await import(V+'/src/crawler/jnjCareersDomEvidence.ts');
 const {JNJ_DOM_CAPTURE_TOOL,JNJ_DOM_LIST_LOCATOR,JNJ_DOM_DETAIL_LOCATOR}=await import(V+'/src/crawler/jnjCareersDomContract.ts');
 for(const artifact of a.sidecar.artifacts){
  assert.equal(artifact.kind,'COMMAND_OUTPUT');assert.equal(artifact.bodyRepresentation,'EXACT');assert.equal(artifact.captureToolName,JNJ_DOM_CAPTURE_TOOL.name);assert.equal(artifact.captureToolVersion,JNJ_DOM_CAPTURE_TOOL.version);
  for(const field of ['requestedUrl','finalUrl','httpStatus','contentType','channelId','rawBodySha256','redactionDescriptors'])assert.equal(artifact[field],undefined,'JNJ_NOT_HTTP');
  assert.equal(artifact.extractorLocator,artifact.logicalKey.startsWith('jnj-dom-list-')?JNJ_DOM_LIST_LOCATOR:JNJ_DOM_DETAIL_LOCATOR);
 }
 originalFetch=()=>createJnjCareersDomSourceFetch({lists:a.sidecar.artifacts.filter((x:any)=>/^jnj-dom-list-\d{4}$/.test(x.logicalKey)).map((x:any)=>bodies.get(x.path)),details:a.sidecar.artifacts.filter((x:any)=>/^jnj-dom-detail-r-\d+$/.test(x.logicalKey)).map((x:any)=>bodies.get(x.path))});
}
const {sanitizeEvidenceHttpUrl}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
const {safeOfficialJsonEvidenceUrl}=await import(V+'/src/crawler/officialJsonEvidence.ts');
const {runSourceCrawl}=await import(V+'/src/crawler/runSourceCrawl.ts');
const {loadPilotContext}=await import(V+'/src/crawler/cloudPilotContext.ts');
const {buildJobDedupeKey}=await import(V+'/src/crawler/normalizedJob.ts');
const {verifySourceQualityReceipt}=await import(V+'/src/crawler/sourceQualityAdmission.ts');
const ts=(await import(V+'/node_modules/typescript/lib/typescript.js')).default;
if(compact){
 assert.equal(a.files.length,a.sidecar.artifacts.length);assert.equal(new Set(a.files.map((f:any)=>f.path)).size,a.files.length);
 for(const file of a.files){const saved=a.sidecar.artifacts.filter((x:any)=>x.path===file.path);assert.equal(saved.length,1);assert.equal(file.sha256,saved[0].sha256);assert.equal(file.byteCount,saved[0].byteCount);}
}
const bodies=new Map();for(const f of a.files){assert(!f.path.startsWith('/')&&!f.path.split('/').includes('..'));const bytes=Buffer.concat(f.chunks.map((s:string)=>Buffer.from(s,'base64')));assert.equal(bytes.length,f.byteCount);assert.equal(sha(bytes),f.sha256);assert(bytes.equals(fs.readFileSync(path.join(run,'artifacts',f.path))));bodies.set(f.path,astellas||astrazeneca||compact&&f.path===independentArtifacts[0].path?bytes:bytes.toString('utf8'));}
const httpArtifacts=a.sidecar.artifacts.filter((x:any)=>typeof x.requestedUrl==='string'&&x.logicalKey!=='qilu-required-partitions-declaration');
const sanofi=d.terminal.sourceId==='source-sanofi-china-social';
// Same keyword-key projection as native httpHtmlSourceFetch.safeHtmlEvidenceUrl.
const replayHtmlEvidenceUrl=(value:string)=>{const url=new URL(value);for(const key of [...url.searchParams.keys()])if(key.normalize('NFKC').toLowerCase().replace(/[^a-z]/g,'').includes('keyword'))url.searchParams.delete(key);return sanitizeEvidenceHttpUrl(url.toString());};
let independent:any;
if(isCurrentBGradeCertificateSchema(d.receipt.legacyCertificate.schemaVersion)){
 const raw=fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.independent-validation.json');
 if(compact){const saved=independentArtifacts[0];assert.equal(sha(raw),saved.sha256,'SANOFI_INDEPENDENT_ORIGINAL_HASH');assert.equal(raw.length,saved.byteCount);assert(raw.equals(bodies.get(saved.path)),'SANOFI_INDEPENDENT_ARCHIVE_BYTES');independent=raw;}
 else independent=JSON.parse(raw.toString('utf8'));
}
const msd=d.terminal.sourceId==='source-msd-china-social',phenomDetails=d.plan.officialJsonFetch?.kind==='phenom';
// Phenom native details retain input order; restore their recorded completion order for the replay clock.
const completionArtifacts=msd?httpArtifacts:sanofi?httpArtifacts.filter((a:any)=>a.kind==='ATS_PAGE'):phenomDetails?httpArtifacts.filter((a:any)=>/-detail-/.test(a.logicalKey)).sort((a:any,b:any)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)):[];
const pendingCompletion=new Map<string,{resolve:(a:any)=>void,reject:(e:Error)=>void}>();let completionNext=0,completionScheduled=false;
const drainCompletion=()=>{if(completionScheduled)return;completionScheduled=true;setImmediate(()=>{completionScheduled=false;const next=completionArtifacts[completionNext],waiting=next&&pendingCompletion.get(next.requestedUrl);if(!waiting){if(pendingCompletion.size){const error=Error('ARCHIVED_COMPLETION_ORDER_MISMATCH');for(const waiter of pendingCompletion.values())waiter.reject(error);pendingCompletion.clear();}return;}pendingCompletion.delete(next.requestedUrl);completionNext++;waiting.resolve(next);if(pendingCompletion.size)drainCompletion();});};
const completionArtifact=(url:string,projectRequestUrl=(value:string)=>sanitizeEvidenceHttpUrl(value))=>new Promise<any>((resolve,reject)=>{const key=projectRequestUrl(url);assert(!pendingCompletion.has(key),'ARCHIVED_DUPLICATE_REQUEST');assert(completionArtifacts.slice(completionNext).filter((a:any)=>a.requestedUrl===key).length===1,'ARCHIVED_EXACT_REQUEST_IDENTITY');pendingCompletion.set(key,{resolve,reject});drainCompletion();});
let i=0, replayNow=Date.parse(d.receipt.observedAt);const requests:any[]=[];const capture=d.receipt.observedAt;const replay=bi?await (await import(V+'/src/crawler/officialJsonSourceFetch.ts')).replayBiArchivedSourceFetch(d.plan,a.sidecar.artifacts.map((a:any)=>({...a,id:a.logicalKey,body:bodies.get(a.path)})),capture):novo?await (await import('./original-novo-archive-replay.mts')).restoreOriginalNovo(V,d.plan,a.sidecar.artifacts,bodies,capture,requests):astrazeneca?await (await import('./original-astrazeneca-archive-replay.mts')).restoreOriginalAstraZeneca(V,JSON.parse(fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.astrazeneca-evidence.json','utf8')),a.sidecar,bodies):astellas?await (await import('./original-astellas-archive-replay.mts')).restoreOriginalAstellas(V,JSON.parse(fs.readFileSync(run+'/artifacts/'+d.terminal.batchId+'.astellas-evidence.json','utf8')),a.sidecar.artifacts,bodies):await originalFetch({allowBrowserFallback:false,now:()=>new Date(replayNow),http:async(req:any,projectRequestUrl=sanitizeEvidenceHttpUrl)=>{const artifact=completionArtifacts.some((a:any)=>a.requestedUrl===projectRequestUrl(req.url))?await completionArtifact(req.url,projectRequestUrl):httpArtifacts[i];i++;assert(artifact,'EXTRA_REQUEST');const requested=new URL(req.url);if(moka)assertMokaArchivedRequest(d.plan,req,artifact,i-1);else {assert.equal(projectRequestUrl(req.url),artifact.requestedUrl);if(i===1&&artifact.kind==='OFFICIAL_COMPANY_PAGE'&&projectRequestUrl===safeOfficialJsonEvidenceUrl){assert.equal(req.method,'GET');assert.equal(req.url,d.plan.source.officialEntryUrl,'OFFICIAL_JSON_EXACT_ENTRY_REQUEST');}}if(i===1&&d.plan.adapterId==='html-table')assert.equal(req.url,d.plan.source.officialEntryUrl);assert.equal(artifact.httpStatus,200);replayNow=Date.parse(artifact.capturedAt);requests.push({url:req.url,method:req.method??'GET',body:req.body??null,capturedAt:artifact.capturedAt});return {status:artifact.httpStatus,body:bodies.get(artifact.path),finalUrl:moka||sanofi&&artifact.kind==='ATS_PAGE'?artifact.finalUrl:req.url,contentType:artifact.contentType,capturedAt:artifact.capturedAt};}})(d.plan);
if(bi||astellas||astrazeneca)requests.push(...a.sidecar.artifacts.filter((x:any)=>x.requestedUrl).map((x:any)=>({url:x.requestedUrl,method:'GET',body:null,capturedAt:x.capturedAt})));
if(astrazeneca)assert.equal(replay.capturedAt,capture,'ASTRAZENECA_CAPTURE_TIME');
if(sanofi&&replay.ok&&replay.fetchEvidence){
 const {bindSanofiChineseIndependentArtifact}=await import(V+'/src/crawler/sanofiChineseNative.ts');
 replay.fetchEvidence=bindSanofiChineseIndependentArtifact(d.plan,replay.fetchEvidence,compact?d.receipt.legacyCertificate.independentValidation.artifactSha256:independent.artifactSha256);
}
assert(replay.ok,replay.failureReason);if(!bi&&!novo&&!astellas&&!astrazeneca)assert.equal(i,httpArtifacts.length);assert(replay.fetchEvidence&&replay.paginationEvaluation);
if(compact){
 const {assertVerifiedArchivedEvidenceMetadata}=await import(V+'/src/crawler/artifactArchive.ts');
 const {bindRuntimeEvidenceArtifactIds}=await import(V+'/src/crawler/runtimeAtomicEvidence.ts');
 const tuple={releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceId:d.terminal.sourceId,sourceResultId:d.terminal.id};
 const original=d.receipt.legacyCertificate.independentValidation;
 const draft={id:bayerCompact?BAYER_INDEPENDENT_ORIGINAL_LOCATOR:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,logicalKey:bayerCompact?BAYER_INDEPENDENT_ORIGINAL_LOCATOR:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,kind:'COMMAND_OUTPUT',capturedAt:original.finishedAt,body:independent,bodyRepresentation:'EXACT',extractorLocator:bayerCompact?BAYER_INDEPENDENT_ORIGINAL_LOCATOR:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR};
 assertVerifiedArchivedEvidenceMetadata({...tuple,evidenceSubdirectory:a.sidecar.evidenceSubdirectory,artifacts:a.sidecar.artifacts.map((x:any)=>({...x,capturedAt:new Date(x.capturedAt)}))},bindRuntimeEvidenceArtifactIds({...tuple,artifacts:[...replay.fetchEvidence.artifacts,draft]}));
 const stored=d.decoded.filter((x:any)=>x.table==='EvidenceArtifact').flatMap((x:any)=>x.rows);assert.equal(stored.length,a.sidecar.artifacts.length);
 for(const saved of a.sidecar.artifacts){
  const rows=stored.filter((x:any)=>x.id===saved.id);assert.equal(rows.length,1);
  const {logicalKey,bodyRepresentation,rawBodySha256,redactionDescriptors,...metadata}=saved;
  assert.deepEqual(rows[0],{...metadata,redactionCommitmentSha256:rawBodySha256??saved.sha256},'SANOFI_ARCHIVE_SQL_METADATA');
  assert.equal(saved.captureToolName,saved===independentArtifacts[0]?original.validatorImplementationId:replay.fetchEvidence.captureTool.name);
  assert.equal(saved.captureToolVersion,saved===independentArtifacts[0]?'2':replay.fetchEvidence.captureTool.version);
 }
}
if(ab){assert.equal(replay.fetchEvidence.artifacts.length,mainArtifacts.length,'EXACT_RAW_ARTIFACT_SET');for(const [index,artifact] of replay.fetchEvidence.artifacts.entries()){const saved=mainArtifacts[index];assert.equal(artifact.logicalKey,saved.logicalKey);assert.equal(sha(artifact.body),saved.sha256,'EXACT_RAW_OR_DERIVED_BODY');assert.equal(artifact.requestedUrl,saved.requestedUrl,'EXACT_REPLAY_REQUESTED_URL');assert.equal(artifact.capturedAt,saved.capturedAt);if(moka||sanofi){assert.equal(artifact.finalUrl,saved.finalUrl,'MOKA_EXACT_FINAL_EVIDENCE_URL');assert.equal(artifact.extractorLocator,saved.extractorLocator,'MOKA_EXACT_REQUEST_LOCATOR');}}}const ctx=await loadPilotContext(d.context,d.plan,ab);const native=await runSourceCrawl(d.plan,{fetch:async()=>replay,isBaseline:!ctx.baselineCompletedBeforeCrawl});assert.deepEqual(native.truth,{transportSuccess:true,adapterSuccess:true,completenessVerified:true});
let certificateReplay:any;
if(ab){
 const {reviewOriginalABCertificate}=await import('./original-ab-certificate-review.mts');
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
assert.equal(digest.digest(replay.fetchEvidence),d.receipt.legacyCertificate.sourceEvidenceSha256,'EXACT_SOURCE_EVIDENCE_DIGEST');assert.equal(digest.jobRecordsDigest(native.jobs),d.receipt.legacyCertificate.output.jobsSha256,'EXACT_NATIVE_JOBS');
verifySourceQualityReceipt({receipt:d.receipt.legacyCertificate,receiptSha256:d.receipt.legacyCertificateSha256,expected:{releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceResultId:d.terminal.id,sourceId:d.terminal.sourceId,sourceConfigSha256:d.terminal.sourceConfigHash,adapterVersion:d.terminal.adapterVersion}});
}
let independentDomReview;
if(bi){
 const {reviewBiDomHttp}=await import('./bi-dom-http-review.mts');
 const {replayBiUiSemanticContract}=await import(V+'/src/crawler/biUiSemanticContract.ts');
 const script=replay.fetchEvidence.artifacts.find((a:any)=>a.logicalKey==='51job-ui-script');
 independentDomReview=reviewBiDomHttp({dom:JSON.parse(fs.readFileSync(run+'/independent-dom/dom-capture.json','utf8')),plan:d.plan,replayedEvidence:replay.fetchEvidence,uiContract:replayBiUiSemanticContract(script.body),now:new Date().toISOString(),dispatchBefore:JSON.parse(fs.readFileSync(run+'/review/PACKET_REVIEW.json','utf8')).dispatchBefore});
}
if(d.terminal.sourceId==='source-cspc-social'){
 const {reviewCspcDomHttp}=await import('./cspc-dom-http-review.mts');
 const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
 independentDomReview=reviewCspcDomHttp({dom:read(run+'/independent-dom/navigation-evidence.json'),applications:read(run+'/independent-dom/application-observations.json'),plan:d.plan,replayedEvidence:replay.fetchEvidence,runStartedAt:read(run+'/run-start.json').runStartedAt,dispatchBefore:read(run+'/review/PACKET_REVIEW.json').dispatchBefore,now:new Date().toISOString()});
}
const auditArtifact=replay.fetchEvidence.artifacts.find((item:any)=>item.logicalKey==='novartis-partitions-audit');
const partitionAudit=auditArtifact?JSON.parse(auditArtifact.body):undefined;
const unknownLosses=(replay.fetchEvidence.fetchLosses??[]).filter((loss:any)=>loss.details?.code==='PFIZER_LIST_ROW_UNKNOWN');
const sourceAudit=partitionAudit?{noOmissionVerified:partitionAudit.noOmissionVerified,anomalyCodes:partitionAudit.anomalyCodes,indexDeclaredTotal:partitionAudit.indexDeclaredTotal,primaryUniqueCount:partitionAudit.primaryUniqueCount,observedUniqueCount:partitionAudit.observedUniqueCount}:unknownLosses.length?{noOmissionVerified:false,anomalyCodes:['PFIZER_LIST_ROW_UNKNOWN'],unknownRecordCount:unknownLosses.length}:undefined;
const report={...(sourceAudit?{sourceAudit}:{}),status:'PASS',classification:'ORIGINAL_NATIVE_ARCHIVE_EXACT_REPLAY',...(independentDomReview?{independentDomReview}:{}),sourceId:d.terminal.sourceId,capturedAt:capture,requests,jobCount:native.jobs.length,allRawHashesVerified:true,exactNativeEvidenceAndJobsDigests:!ab,originalStrictQualityReplay:!ab||jnj,...(certificateReplay?{certificateReplay}:{}),networkUsed:false};fs.writeFileSync(run+'/review/NATIVE_RAW_REPLAY.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
