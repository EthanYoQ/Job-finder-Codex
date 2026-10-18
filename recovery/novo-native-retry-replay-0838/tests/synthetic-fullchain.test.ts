// @vitest-environment node
// Synthetic control-flow and admission proof tests only. No retained web fixture
// is read or substituted, and no live acquisition or database operation occurs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { candidateCompanies } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/data/companyRegistry";
import { getPlanBySourceId, buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourcePlan";
import { runSourceCrawl, createSourceFetchAttemptTracker } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/runtimeAtomicEvidence";
import { NOVO_CHINA_ENDPOINT, replayNovoChinaRows } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/novoChinaQuality";
import { safeOfficialJsonEvidenceUrl } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/officialJsonEvidence";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation, OfficialHttpTimeoutError } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/officialHttpRuntimeLimits";
import type { SourceFetchArtifactDraft } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourceFetchEvidence";

const START = Date.parse("2026-10-18T08:41:00.000Z");
const BUDGET = 20 * 60_000;
import { ENTRY, detail, apply, final, listing, pages } from "/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source/tests/helpers/novoC60SyntheticFixture";
type Outcome = number | "timeout" | "bare-timeout" | "network" | "unknown" | "captcha" | "tls" | "late-posting" | "body-timeout" | "insufficient";
type Script = Record<string, Outcome[]>;
const directories: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const bodyJson = (a: SourceFetchArtifactDraft) => JSON.parse(String(a.body));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(START);
  vi.stubEnv("P0_SOURCE_HTTP_TIMEOUT_MS", "45000"); vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", "");
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException("Synthetic request deadline", "TimeoutError")), ms); return controller.signal;
  });
});
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

async function capture(script: Script = {}, options: { retryAfter?: string; budgetMs?: number; cancelBackoff?: boolean; gatewayBeforeRedirect?: boolean; gatewayFinalUrl?: string } = {}) {
  const calls: string[] = [], counts = new Map<string, number>(), controller = new AbortController();
  const clock = vi.spyOn(globalThis, "setTimeout");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string" || !pages.has(input)) throw Error("Unexpected synthetic URL");
    expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
    calls.push(input); const count = (counts.get(input) ?? 0) + 1; counts.set(input, count);
    const action = script[input]?.[count - 1]; const page = pages.get(input)!;
    if (action === "bare-timeout") throw new OfficialHttpTimeoutError();
    if (action === "network") throw Object.assign(Error("Synthetic network error"), { code: "ECONNRESET" });
    if (action === "timeout") return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
    const status = typeof action === "number" ? action : action === "captcha" || action === "tls" ? 502 : 200;
    const body = action === "insufficient" ? page.body.replace(
      "Develop synthetic laboratory procedures and maintain documented quality controls for research teams.","*") : action === "unknown" ? "<html>Unknown application state</html>" : action === "captcha" ? "<html>Verify you are human</html>" :
      action === "tls" ? "<html>SSL certificate verify failed</html>" : status !== 200 ? "<html>Bad Gateway</html>" : page.body;
    const response = new Response(body, { status, headers: { "content-type": page.contentType,
      ...(options.retryAfter && status !== 200 ? { "retry-after": options.retryAfter } : {}) } });
    Object.defineProperty(response, "url", { value: action === "late-posting" ? "https://careers.novonordisk.com/job/Changed/999999/" :
      typeof action === "number" && options.gatewayFinalUrl ? options.gatewayFinalUrl :
      typeof action === "number" && options.gatewayBeforeRedirect ? input : page.finalUrl });
    if (action === "body-timeout") Object.defineProperty(response, "text", { value: () => new Promise<string>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true })) });
    if (options.cancelBackoff && typeof action === "number") setTimeout(() => controller.abort(Error("Synthetic owner cancellation")), 1000);
    return response;
  }));
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
  const tracker = createSourceFetchAttemptTracker();
  const operation = runWithOfficialSourceCancellation(controller.signal, () => runWithOfficialSourceAttemptTimeout(() => runSourceCrawl(plan, {
    fetch: createOwnedSourceQualityFetch(), isBaseline: true, attemptTracker: tracker
  }), options.budgetMs ?? BUDGET));
  const settled = operation.then(result => ({ result }), error => ({ error }));
  await vi.runAllTimersAsync();
  const outcome = await settled;
  const delays = clock.mock.calls.filter(c => c[1] === 10000).length;
  return { ...outcome, calls, counts, tracker, plan, delays };
}
type Capture = Awaited<ReturnType<typeof capture>>;
function successful(input: Capture,expected=2) {
  if (!("result" in input)) throw input.error;
  expect(input.result).toMatchObject({ status: "SUCCESS", truth: { completenessVerified: true } });
  expect(input.result.jobs).toHaveLength(expected);
  expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({ rawCount: 3, validCount: expected, validationDiscardCount: 3-expected });
  expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1);
  expect(input.tracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
  expect(replayNovoChinaRows(input.plan, input.result.fetchEvidence!, input.result.jobs, input.result.observation.crawledAt.toISOString())).toBe(true);
  return input.result;
}
async function admissionInput(input: Capture,expected=2) {
  const result = successful(input,expected), workspaceRoot = await mkdtemp(join(tmpdir(), "novo-c60-synthetic-")); directories.push(workspaceRoot);
  const identity = { releaseCandidateId: "novo-c60-synthetic", commitSha: "a".repeat(40), rosterSha256: "a".repeat(64), sourcePlanSha256: "a".repeat(64),
    sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const, ownerId: "synthetic-owner",
    expectedPlannedSourceIds: [input.plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1 };
  const pending = buildPendingRuntimeBatch("novo-c60-synthetic-batch", [input.plan], identity, new Date(START)).sources[0]!;
  const binding = { releaseCandidateId: identity.releaseCandidateId, batchId: "novo-c60-synthetic-batch", sourceResultId: pending.id,
    sourceConfigSha256: sourcePlanConfigSha256(input.plan), adapterVersion: pending.adapterVersion };
  const evidenceSubdirectory = "quality/runtime-evidence";
  const archived = await archiveSourceEvidence({ workspaceRoot, ...binding, sourceId: input.plan.source.id, evidenceSubdirectory,
    captureTool: result.fetchEvidence!.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({ ...binding, sourceId: input.plan.source.id, artifacts: result.fetchEvidence!.artifacts }) });
  return { plan: input.plan, result, binding, identity, pending, archive: { workspaceRoot, evidenceSubdirectory, artifacts: archived.artifacts } };
}


import { restoreOriginalNovo } from "../after/support/offline-checkers/original-novo-archive-replay.mts";
const V="/workspace/scratch/5e9614251709/inactive-novo-native-retry-replay-20261018T0838Z/runtime/tools/dot-auto-controller/vendor/c60-source";
async function restored(input:any,mutate?:(archived:any[],bodies:Map<string,string>)=>void){
 const archived=JSON.parse(JSON.stringify(input.archive.artifacts));
 const bodies=new Map<string,string>(await Promise.all(archived.map(async(a:any)=>[a.path,await readFile(join(input.archive.workspaceRoot,a.path),'utf8')])) as any);
 mutate?.(archived,bodies);
 const requests:any[]=[];
 const replay=await restoreOriginalNovo(V,input.plan,archived,bodies,input.result.observation.crawledAt.toISOString(),requests);
 const native=await runSourceCrawl(input.plan,{fetch:async()=>replay,isBaseline:true});
 expect(native.status).toBe('SUCCESS');expect(native.truth.completenessVerified).toBe(true);
 return {replay,native,requests};
}
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const B='/workspace/scratch/5e9614251709',E=B+'/inactive-novo-native-retry-replay-20261018T0838Z';
it.each(['gateway','timeout'] as const)('SYNTHETIC full original packet/raw/readers/project chain: %s',async mode=>{
 const captured=await capture({[apply(1)]:[mode==='gateway'?502:'timeout']},mode==='gateway'?{gatewayFinalUrl:'https://careers.novonordisk.com/job-invite/346001/?locale=en_GB'}:{});
 const result=successful(captured),plan=captured.plan;
 const {createBuildIdentity}=await import(V+'/src/readiness/buildIdentity.ts');
 const {deriveCurrentStagedScheduleExpectation}=await import(V+'/src/crawler/stagedScheduleAuthority.ts');
 const {hashCanonicalStringSet}=await import(V+'/src/crawler/runtimeBatchIdentity.ts');
 const {CLOUD_PILOT_SOURCE}=await import(V+'/src/db/cloudPilotSqlControl.ts');
 const {compileDbStartedCloudSourcePublication}=await import(V+'/src/db/ingestionRepository.ts');
 const {makeArchiveBundle}=await import(V+'/src/crawler/cloudSourcePilotRelay.ts');
 const build=createBuildIdentity(V,execFileSync('git',['rev-parse','HEAD'],{cwd:V,encoding:'utf8'}).trim()),e=deriveCurrentStagedScheduleExpectation(build);
 const previous=JSON.parse(fs.readFileSync(B+'/inactive-novo-closure-replay-20261018T0819Z/reconciled-host/READER_BEFORE.json','utf8'));
 const base=JSON.parse(fs.readFileSync(B+'/takeda-original-recovery-20261017T0417Z/novo-nordisk/control-base.json','utf8'));
 const candidate={id:'synthetic-novo-'+mode,goalId:'jobfinder-portable-required-40',version:1000001};
 const candidateRow={...candidate,...base.databaseIdentity,commitSha:e.commitSha,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,
  adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,oracleVersion:'staged-official-source-v1',minimumStableCompanyCount:e.minimumStableCompanyCount,status:'BUILDING'};
 const context={...previous.publicationContext,checkedAt:new Date().toISOString(),candidateRow,jobs:[],firstAccepted:null,latestAccepted:null};
 const host=E+'/synthetic-'+mode,batchId='SYNTHETIC-novo-'+mode,run=host+'/'+batchId;
 fs.mkdirSync(run+'/relay',{recursive:true});fs.mkdirSync(run+'/review',{recursive:true});fs.mkdirSync(run+'/artifacts',{recursive:true});
 const identity={releaseCandidateId:candidate.id,commitSha:e.commitSha,rosterSha256:e.rosterSha256,sourcePlanSha256:e.sourcePlanSha256,sourceConfigSha256:e.sourceConfigSha256,
  adapterBundleSha256:e.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:CLOUD_PILOT_SOURCE.ownerId,expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id]),expectedPlannedSourceCount:1};
 const planned=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(START)),pending=planned.sources[0]!;
 const tuple={releaseCandidateId:candidate.id,batchId,sourceId:plan.source.id,sourceResultId:pending.id},evidenceSubdirectory='synthetic/runtime-evidence';
 const archive=await archiveSourceEvidence({workspaceRoot:run+'/artifacts',...tuple,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
 const bundle=await makeArchiveBundle({workspaceRoot:run+'/artifacts',...tuple,evidenceSubdirectory,artifacts:archive.artifacts});
 const binding={...tuple,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion};
 const sourceQualityAdmission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot:run+'/artifacts',evidenceSubdirectory,artifacts:archive.artifacts}});expect(sourceQualityAdmission.status).toBe('ACCEPTED');
 const control={projectId:base.projectId,build,candidate,databaseIdentity:base.databaseIdentity,planned,context};
 const source={plan,result,pending,identity,batchId,artifacts:archive.artifacts,attemptTracker:captured.tracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1' as const,sourceQualityAdmission};
 const packet=await compileDbStartedCloudSourcePublication({source,control,jobProjectionDelta:true});
 const requestId=randomUUID(),requestBody={schemaVersion:1,requestId,kind:'PUBLISH',expiresAt:packet.expiresAt,payload:{projectId:base.projectId,sql:packet.sql,dispatchBefore:packet.expiresAt}};
 const request={...requestBody,requestSha256:sha(JSON.stringify(requestBody))};
 const write=(p:string,value:any)=>fs.writeFileSync(p,JSON.stringify(value,null,2));
 write(host+'/host-config.json',{mode:'NATIVE_PORTABLE_CONNECTOR_V1',sourceId:plan.source.id});
 write(host+'/control-base.json',{projectId:base.projectId,build,candidate,databaseIdentity:base.databaseIdentity});write(host+'/activation.json',{status:'REGISTERED_VERIFIED',candidate,build});write(host+'/expected-candidate.json',candidateRow);
 write(run+'/relay/'+requestId+'.request.json',request);fs.writeFileSync(run+'/relay/'+requestId+'.request.json.sql',packet.sql);write(run+'/artifacts/'+batchId+'.archive.json',bundle);
 const before={...previous,checkedAt:new Date().toISOString(),jobs:[],members:[],results:[],artifacts:[],closureRecords:[],writerInventory:[],publicationContext:context,
  inventory:Object.fromEntries(['jobs','members','results','artifacts'].map(k=>[k,{count:0,ids:[]}]))};write(host+'/READER_BEFORE.json',before);
 write(host+'/SYNTHETIC_ONLY.json',{synthetic:true,network:false,db:false,publication:false,source:'Original Novo synthetic pages and owned mocked native transport',runtime:V,realGitCommit:build.commitSha,realBuild:build,clock:new Date().toISOString()});
 fs.writeFileSync(host+'/clock.mjs',`const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[${Date.now()}]));}static now(){return ${Date.now()};}};`);
 fs.writeFileSync(host+'/review.mts',`import fs from 'node:fs';const run=${JSON.stringify(run)},host=${JSON.stringify(host)},read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const {reviewOriginalPortableSql}=await import(${JSON.stringify(E+'/test-checkers/original-portable-sql-review.mts')});
 const packet=await reviewOriginalPortableSql(run,${JSON.stringify(requestId)},run+'/review/PACKET_REVIEW.json',{originalOuterDeadline:${Date.parse(packet.expiresAt)}});
 const {replayOriginalPortableReaders}=await import(${JSON.stringify(E+'/test-checkers/original-portable-reader-replay.mts')});
 const readers=await replayOriginalPortableReaders({run,outputDirectory:run+'/review',before:read(host+'/READER_BEFORE.json'),packet});
 const api=await import(${JSON.stringify(E+'/runtime/tools/dot-auto-controller/vendor/reader-main/src/server/portablePublicationApi.ts')});
 const {candidateCompanies}=await import(${JSON.stringify(E+'/runtime/tools/dot-auto-controller/vendor/reader-main/src/data/companyRegistry.ts')});
 const source=readers.main.before,c=candidateCompanies.find(c=>c.id===source.companyId);
 const snapshot={sources:[source],companies:[{id:c.id,companyName:c.officialChineseName,pinyin:c.pinyinName,category:c.category,sourceIds:[source.sourceId],publishingSourceIds:[source.sourceId],required:true,exclusionReason:null,coverage:'COMPLETE',health:source.health,jobs:source.jobs}],lastUpdatedAt:source.lastSuccessAt,coverage:{requiredCompanyCount:1,excludedCompanyCount:0}};
 fs.writeFileSync(host+'/PUBLIC_BEFORE.json',JSON.stringify(api.searchPortableSnapshot({city:'全部城市',companyIds:[c.id],categories:[]},snapshot)));`);
 const node=B+'/job-finder-offline-runtime-20261009T1418Z/node-v22.23.3-linux-x64/bin/node',loader=V+'/node_modules/tsx/dist/loader.mjs';
 for(const script of [host+'/review.mts',E+'/test-checkers/replay-original-json-archive.mts',E+'/test-checkers/project-original-target-api.mts']){
  const output=execFileSync(node,['--import',host+'/clock.mjs','--import',loader,script,run],{cwd:V,encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:plan.source.id},timeout:60000});
  fs.appendFileSync(host+'/fullchain.log',output+'\n');
 }
 const raw=JSON.parse(fs.readFileSync(run+'/review/NATIVE_RAW_REPLAY.json','utf8'));expect(raw.status).toBe('PASS');expect(raw.jobCount).toBe(2);expect(raw.requests).toHaveLength(9);
 expect(JSON.parse(fs.readFileSync(run+'/review/ORIGINAL_DEPLOYED_READER_REPLAY.json','utf8')).status).toBe('PASS');
 expect(JSON.parse(fs.readFileSync(run+'/review/EXPECTED_TARGET_API.json','utf8')).after.jobs).toHaveLength(2);
},120000);
