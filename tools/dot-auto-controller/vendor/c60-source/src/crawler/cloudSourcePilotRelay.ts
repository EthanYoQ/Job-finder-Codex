/** Local one-shot transport. This module never calls MCP, Library or a database. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { publishRelayRequest } from "../../ops/cloud-pilot-host/relay-request-ready.mjs";
import { acquirePortableCrawlLease, releasePortableCrawlLease, assertPortableCrawlLeaseOwned, type PortableCrawlLease, type PortableLeaseDatabase } from "./portableCrawlLease";
import { verifyArchivedSourceEvidence, type VerifyArchivedEvidenceRequest } from "./artifactArchive";
export const sha256=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
export const PILOT_BUDGET=Object.freeze({initialMs:290000,totalMs:550000,controlMs:60000,controlCompletionMs:25000,publishDbMs:120000,publishTransportMs:45000,leaseReserveMs:40000});
const SHA=z.string().regex(/^[a-f0-9]{64}$/);
const sqlResult=z.discriminatedUnion("status",[
  z.object({status:z.literal("SUCCEEDED"),rows:z.array(z.record(z.unknown()))}).strict(),
  z.object({status:z.literal("FAILED"),code:z.string().min(1),outcome:z.enum(["ROLLED_BACK","NOT_DISPATCHED","UNKNOWN"])}).strict()
]);
export class PilotSqlFailure extends Error {
  readonly outcome:"ROLLED_BACK"|"NOT_DISPATCHED"|"UNKNOWN";
  constructor(outcome:PilotSqlFailure["outcome"],readonly code:string){
    super(`RELAY_SQL_FAILED:${code}`);this.name="PilotSqlFailure";
    // Only a database-reported, known rollback SQLSTATE establishes rollback.
    // Connection/statement-completion ambiguity remains UNKNOWN even if mislabeled.
    this.outcome=outcome==="ROLLED_BACK"&&(!/^(?:(?:22|23|25|40|42|44|53|54|55|P0)[A-Z0-9]{3}|57014)$/.test(code)||code==="40003")?"UNKNOWN":outcome;
  }
}
export type PilotRequestKind="LEASE_ACQUIRE"|"LEASE_RENEW"|"LEASE_RELEASE"|"CREATE_PENDING"|"READ_CONTEXT"|"READ_PUBLICATION_CONTEXT"|"ARCHIVE_STORE"|"PUBLISH"|"READ_OUTCOME";
/** Fixed, default-unselected Takeda candidate path. No callback can approve SQL. */
export type TakedaOwnedPipeSelection={mode:"TAKEDA_OWNED_PIPE_CANDIDATE_V1";launchChallenge:string};
type TakedaGate=Awaited<ReturnType<typeof import("../../../../connector-gate/takeda-publication-review.mts").prepareTakedaConnectorPublicationReview>>;
export type OwnedTakedaPublication=Readonly<{packet:TakedaGate["packet"]}>;
const ownedTakedaPublications=new WeakMap<object,{relay:FilePilotRelay;gate:TakedaGate;launchChallenge:string}>();
const ownedTakedaOutcomes=new WeakMap<object,{relay:FilePilotRelay;packet:TakedaGate["packet"];publishAttempted:boolean;publishRequestSha256?:string;readAttempted:boolean;outerDeadline:number}>();
/** Fixed, default-unselected Biogen candidate path. No callback can approve SQL. */
export type BiogenOwnedPipeSelection={mode:"BIOGEN_OWNED_PIPE_CANDIDATE_V1";launchChallenge:string};
type BiogenGate=Awaited<ReturnType<typeof import("../../../../connector-gate/biogen-publication-review.mts").prepareBiogenConnectorPublicationReview>>;
export type OwnedBiogenPublication=Readonly<{packet:BiogenGate["packet"]}>;
const ownedBiogenPublications=new WeakMap<object,{relay:FilePilotRelay;gate:BiogenGate;launchChallenge:string}>();
const ownedBiogenOutcomes=new WeakMap<object,{relay:FilePilotRelay;packet:BiogenGate["packet"];publishAttempted:boolean;publishRequestSha256?:string;readAttempted:boolean;outerDeadline:number}>();
/** Fixed, default-unselected Hengrui candidate path. No callback can approve SQL. */
export type HengruiOwnedPipeSelection={mode:"HENGRUI_OWNED_PIPE_CANDIDATE_V1";launchChallenge:string};
type HengruiGate=Awaited<ReturnType<typeof import("../../../../connector-gate/hengrui-publication-review.mts").prepareHengruiConnectorPublicationReview>>;
export type OwnedHengruiPublication=Readonly<{packet:HengruiGate["packet"]}>;
const ownedHengruiPublications=new WeakMap<object,{relay:FilePilotRelay;gate:HengruiGate;launchChallenge:string}>();
const ownedHengruiOutcomes=new WeakMap<object,{relay:FilePilotRelay;packet:HengruiGate["packet"];publishAttempted:boolean;publishRequestSha256?:string;readAttempted:boolean;outerDeadline:number}>();
export class FilePilotRelay {
  constructor(readonly directory:string){}
  async request<T>(kind:PilotRequestKind,payload:unknown,deadline:number,parse:(v:unknown)=>T,signal?:AbortSignal):Promise<T>{
    const prepared=await this.createRequest(kind,payload,deadline,signal);
    await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
    return this.waitResponse(prepared,parse,signal);
  }
  private async createRequest(kind:PilotRequestKind,payload:unknown,deadline:number,signal?:AbortSignal){
    signal?.throwIfAborted();if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
    if(kind==="CREATE_PENDING"||kind==="READ_CONTEXT"){
      const dispatchBefore=deadline-PILOT_BUDGET.controlCompletionMs;
      if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
      payload={...z.record(z.unknown()).parse(payload),dispatchBefore:new Date(dispatchBefore).toISOString()};
    }
    await mkdir(this.directory,{recursive:true});
    const requestId=randomUUID(),body={schemaVersion:1,requestId,kind,expiresAt:new Date(deadline).toISOString(),payload};
    const requestSha256=sha256(JSON.stringify(body)),base=join(this.directory,requestId);
    const request={...body,requestSha256};
    return {base,deadline,request,serializedRequest:JSON.stringify(request),responseSha256:undefined as string|undefined};
  }
  private async waitResponse<T>(prepared:Awaited<ReturnType<FilePilotRelay["createRequest"]>>,parse:(v:unknown)=>T,signal?:AbortSignal):Promise<T>{
    const {base,deadline,request:{requestId,requestSha256,kind}}=prepared;
    while(Date.now()<deadline){
      signal?.throwIfAborted();
      try{
        const rawBytes=await readFile(base+".response.json"),raw=rawBytes.toString("utf8");
        const response=z.object({schemaVersion:z.literal(1),requestId:z.literal(requestId),requestSha256:z.literal(requestSha256),kind:z.literal(kind),result:z.unknown()}).strict().safeParse(JSON.parse(raw));
        if(!response.success)throw Error("RELAY_RESPONSE_BINDING");
        if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
        const value=parse(response.data.result);prepared.responseSha256=sha256(rawBytes);return value;
      }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      await delay(Math.min(25,Math.max(1,deadline-Date.now())),undefined,signal?{signal}:{});
    }
    throw Error("RELAY_DEADLINE");
  }
  async prepareOwnedTakedaPublish(input:import("../../../../connector-gate/takeda-publication-review.mts").TakedaReviewInput,selection:TakedaOwnedPipeSelection):Promise<OwnedTakedaPublication>{
    const fixed=z.object({mode:z.literal("TAKEDA_OWNED_PIPE_CANDIDATE_V1"),launchChallenge:SHA}).strict().parse(selection);
    if(!process.send||!process.connected)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
    const {prepareTakedaConnectorPublicationReview}=await import("../../../../connector-gate/takeda-publication-review.mts");
    const gate=await prepareTakedaConnectorPublicationReview(input),handle=Object.freeze({packet:gate.packet});
    // Default path remains untouched. This optional, fixed TEST_ONLY data export
    // reads only the exact packet AFTER original full review; it grants no authority.
    if(process.env.JOBFINDER_FIXED_PROJECTION_MODE!==undefined){
      const {writeReviewedJobProjectionSidecar}=await import("./fixedJobProjectionSidecar");
      await writeReviewedJobProjectionSidecar(gate.packet,this.directory);
    }
    ownedTakedaPublications.set(handle,{relay:this,gate,launchChallenge:fixed.launchChallenge});
    ownedTakedaOutcomes.set(handle,{relay:this,packet:gate.packet,publishAttempted:false,readAttempted:false,outerDeadline:input.outerDeadline});return handle;
  }
  async publishOwnedTakeda(handle:OwnedTakedaPublication,signal?:AbortSignal){
    const owned=ownedTakedaPublications.get(handle);
    if(!owned||owned.relay!==this)throw Error("RELAY_SAME_PROCESS_REVIEW_REQUIRED");
    ownedTakedaPublications.delete(handle); // claim before any await; no retry after ambiguity
    const outcomeBinding=ownedTakedaOutcomes.get(handle)!;outcomeBinding.publishAttempted=true;
    const {sql,expiresAt}=owned.gate.packet,deadline=Date.parse(expiresAt);
    const dispatchBefore=deadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
    if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
    const prepared=await this.createRequest("PUBLISH",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
    outcomeBinding.publishRequestSha256=prepared.request.requestSha256;
    const token=await owned.gate.review(prepared.request);
    signal?.throwIfAborted();if(Date.now()>=dispatchBefore)throw Error("RELAY_DISPATCH_BUDGET");
    await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
    const {emitConsumedProducerReview}=await import("../../../../connector-gate/producer-adapter.mts");
    await emitConsumedProducerReview(token,prepared.request as import("../../../../connector-gate/takeda-publication-review.mts").ConnectorPublishRequest,owned.launchChallenge);
    return this.waitResponse(prepared,value=>{
      const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;
    },signal);
  }
  /** One original tuple read. The original inspector/batch/holder gates are run
   * here from module-owned packet data; no external boolean/result is accepted. */
  async readAndVerifyOwnedTakedaOutcome(handle:OwnedTakedaPublication,deadline:number,signal?:AbortSignal){
    const binding=ownedTakedaOutcomes.get(handle);
    if(!binding||binding.relay!==this||!binding.publishAttempted||!binding.publishRequestSha256||binding.readAttempted)throw Error("RELAY_OWNED_OUTCOME_REQUIRED");
    binding.readAttempted=true; // no concurrent/duplicate read or completion event
    if(!Number.isSafeInteger(deadline)||deadline>binding.outerDeadline-PILOT_BUDGET.controlMs||deadline>Date.now()+PILOT_BUDGET.controlMs)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    const packet=binding.packet,sourceResult=packet.commit.sourceResult;
    const literal=(value:string)=>`E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
    const sql=`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${literal(sourceResult.id)}) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${literal(sourceResult.batchId)}) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`;
    const dispatchBefore=deadline-PILOT_BUDGET.controlCompletionMs;
    if(Date.now()>=dispatchBefore)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    let prepared:Awaited<ReturnType<FilePilotRelay["createRequest"]>>,rows:Record<string,unknown>[];
    try{
      prepared=await this.createRequest("READ_OUTCOME",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
      await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
      rows=await this.waitResponse(prepared,value=>{const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;},signal);
      if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
    }catch(cause){throw new Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION",{cause});}
    if(rows.length!==1)throw Error("PILOT_OUTCOME_ROW_COUNT");
    const persisted=rows[0]!.row===null?null:reviveUtcFields(z.record(z.unknown()).parse(rows[0]!.row),['startedAt','finishedAt']);
    const {inspectPersistedAtomicCommitOutcome}=await import("../db/ingestionRepository");
    const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error("PILOT_OUTCOME_FIND_MANY_FORBIDDEN");}}});
    if(outcome.state==='COMMITTED_EXACT'){
      const batch=z.record(z.unknown()).parse(rows[0]!.batch);
      if(batch.id!==sourceResult.batchId||batch.releaseCandidateId!==sourceResult.releaseCandidateId||batch.status!=='SUCCESS'||batch.atomicCommittedCount!==1||batch.completenessVerifiedCount!==1||rows[0]!.holderId===packet.holderId)throw Error('PILOT_DB_STARTED_TERMINAL_NOT_EXACT');
      if(!process.send||!process.connected||!prepared.responseSha256)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
      const event={type:"PRODUCER_OUTCOME_VERIFIED_V1",tuple:{releaseCandidateId:sourceResult.releaseCandidateId,batchId:sourceResult.batchId,sourceId:sourceResult.sourceId,sourceResultId:sourceResult.id},readRequestSha256:prepared.request.requestSha256,responseSha256:prepared.responseSha256};
      await new Promise<void>((resolve,reject)=>process.send!(event,error=>error?reject(error):resolve()));
    }
    return outcome;
  }
  async prepareOwnedBiogenPublish(input:import("../../../../connector-gate/biogen-publication-review.mts").BiogenReviewInput,selection:BiogenOwnedPipeSelection):Promise<OwnedBiogenPublication>{
    const fixed=z.object({mode:z.literal("BIOGEN_OWNED_PIPE_CANDIDATE_V1"),launchChallenge:SHA}).strict().parse(selection);
    if(!process.send||!process.connected)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
    const {prepareBiogenConnectorPublicationReview}=await import("../../../../connector-gate/biogen-publication-review.mts");
    const gate=await prepareBiogenConnectorPublicationReview(input),handle=Object.freeze({packet:gate.packet});
    // Source-fixed data export only after the original full Biogen review.
    // The sidecar is never permission to publish and owns no DB/tool calls.
    if(process.env.JOBFINDER_FIXED_PROJECTION_MODE!==undefined){
      const {writeReviewedJobProjectionSidecar}=await import("./biogenFixedJobProjectionSidecar");
      await writeReviewedJobProjectionSidecar(gate.packet,this.directory);
    }
    ownedBiogenPublications.set(handle,{relay:this,gate,launchChallenge:fixed.launchChallenge});
    ownedBiogenOutcomes.set(handle,{relay:this,packet:gate.packet,publishAttempted:false,readAttempted:false,outerDeadline:input.outerDeadline});return handle;
  }
  async publishOwnedBiogen(handle:OwnedBiogenPublication,signal?:AbortSignal){
    const owned=ownedBiogenPublications.get(handle);
    if(!owned||owned.relay!==this)throw Error("RELAY_SAME_PROCESS_REVIEW_REQUIRED");
    ownedBiogenPublications.delete(handle); // claim before any await; no retry after ambiguity
    const outcomeBinding=ownedBiogenOutcomes.get(handle)!;outcomeBinding.publishAttempted=true;
    const {sql,expiresAt}=owned.gate.packet,deadline=Date.parse(expiresAt);
    const dispatchBefore=deadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
    if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
    const prepared=await this.createRequest("PUBLISH",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
    outcomeBinding.publishRequestSha256=prepared.request.requestSha256;
    const token=await owned.gate.review(prepared.request);
    signal?.throwIfAborted();if(Date.now()>=dispatchBefore)throw Error("RELAY_DISPATCH_BUDGET");
    await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
    const {emitConsumedBiogenProducerReview}=await import("../../../../connector-gate/biogen-producer-adapter.mts");
    await emitConsumedBiogenProducerReview(token,prepared.request as import("../../../../connector-gate/biogen-publication-review.mts").ConnectorPublishRequest,owned.launchChallenge);
    return this.waitResponse(prepared,value=>{
      const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;
    },signal);
  }
  /** One original tuple read. The original inspector/batch/holder gates are run
   * here from module-owned packet data; no external boolean/result is accepted. */
  async readAndVerifyOwnedBiogenOutcome(handle:OwnedBiogenPublication,deadline:number,signal?:AbortSignal){
    const binding=ownedBiogenOutcomes.get(handle);
    if(!binding||binding.relay!==this||!binding.publishAttempted||!binding.publishRequestSha256||binding.readAttempted)throw Error("RELAY_OWNED_OUTCOME_REQUIRED");
    binding.readAttempted=true; // no concurrent/duplicate read or completion event
    if(!Number.isSafeInteger(deadline)||deadline>binding.outerDeadline-PILOT_BUDGET.controlMs||deadline>Date.now()+PILOT_BUDGET.controlMs)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    const packet=binding.packet,sourceResult=packet.commit.sourceResult;
    const literal=(value:string)=>`E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
    const sql=`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${literal(sourceResult.id)}) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${literal(sourceResult.batchId)}) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`;
    const dispatchBefore=deadline-PILOT_BUDGET.controlCompletionMs;
    if(Date.now()>=dispatchBefore)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    let prepared:Awaited<ReturnType<FilePilotRelay["createRequest"]>>,rows:Record<string,unknown>[];
    try{
      prepared=await this.createRequest("READ_OUTCOME",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
      await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
      rows=await this.waitResponse(prepared,value=>{const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;},signal);
      if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
    }catch(cause){throw new Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION",{cause});}
    if(rows.length!==1)throw Error("PILOT_OUTCOME_ROW_COUNT");
    const persisted=rows[0]!.row===null?null:reviveUtcFields(z.record(z.unknown()).parse(rows[0]!.row),['startedAt','finishedAt']);
    const {inspectPersistedAtomicCommitOutcome}=await import("../db/ingestionRepository");
    const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error("PILOT_OUTCOME_FIND_MANY_FORBIDDEN");}}});
    if(outcome.state==='COMMITTED_EXACT'){
      const batch=z.record(z.unknown()).parse(rows[0]!.batch);
      if(batch.id!==sourceResult.batchId||batch.releaseCandidateId!==sourceResult.releaseCandidateId||batch.status!=='SUCCESS'||batch.atomicCommittedCount!==1||batch.completenessVerifiedCount!==1||rows[0]!.holderId===packet.holderId)throw Error('PILOT_DB_STARTED_TERMINAL_NOT_EXACT');
      if(!process.send||!process.connected||!prepared.responseSha256)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
      const event={type:"PRODUCER_OUTCOME_VERIFIED_V1",tuple:{releaseCandidateId:sourceResult.releaseCandidateId,batchId:sourceResult.batchId,sourceId:sourceResult.sourceId,sourceResultId:sourceResult.id},readRequestSha256:prepared.request.requestSha256,responseSha256:prepared.responseSha256};
      await new Promise<void>((resolve,reject)=>process.send!(event,error=>error?reject(error):resolve()));
    }
    return outcome;
  }
  async prepareOwnedHengruiPublish(input:import("../../../../connector-gate/hengrui-publication-review.mts").HengruiReviewInput,selection:HengruiOwnedPipeSelection):Promise<OwnedHengruiPublication>{
    const fixed=z.object({mode:z.literal("HENGRUI_OWNED_PIPE_CANDIDATE_V1"),launchChallenge:SHA}).strict().parse(selection);
    if(!process.send||!process.connected)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
    const {prepareHengruiConnectorPublicationReview}=await import("../../../../connector-gate/hengrui-publication-review.mts");
    const gate=await prepareHengruiConnectorPublicationReview(input),handle=Object.freeze({packet:gate.packet});
    // Source-fixed data export only after the original full Hengrui review.
    // The sidecar is never permission to publish and owns no DB/tool calls.
    if(process.env.JOBFINDER_FIXED_PROJECTION_MODE!==undefined){
      const {writeReviewedJobProjectionSidecar}=await import("./hengruiFixedJobProjectionSidecar");
      await writeReviewedJobProjectionSidecar(gate.packet,this.directory);
    }
    ownedHengruiPublications.set(handle,{relay:this,gate,launchChallenge:fixed.launchChallenge});
    ownedHengruiOutcomes.set(handle,{relay:this,packet:gate.packet,publishAttempted:false,readAttempted:false,outerDeadline:input.outerDeadline});return handle;
  }
  async publishOwnedHengrui(handle:OwnedHengruiPublication,signal?:AbortSignal){
    const owned=ownedHengruiPublications.get(handle);
    if(!owned||owned.relay!==this)throw Error("RELAY_SAME_PROCESS_REVIEW_REQUIRED");
    ownedHengruiPublications.delete(handle); // claim before any await; no retry after ambiguity
    const outcomeBinding=ownedHengruiOutcomes.get(handle)!;outcomeBinding.publishAttempted=true;
    const {sql,expiresAt}=owned.gate.packet,deadline=Date.parse(expiresAt);
    const dispatchBefore=deadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
    if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
    const prepared=await this.createRequest("PUBLISH",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
    outcomeBinding.publishRequestSha256=prepared.request.requestSha256;
    const token=await owned.gate.review(prepared.request);
    signal?.throwIfAborted();if(Date.now()>=dispatchBefore)throw Error("RELAY_DISPATCH_BUDGET");
    await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
    const {emitConsumedHengruiProducerReview}=await import("../../../../connector-gate/hengrui-producer-adapter.mts");
    await emitConsumedHengruiProducerReview(token,prepared.request as import("../../../../connector-gate/hengrui-publication-review.mts").ConnectorPublishRequest,owned.launchChallenge);
    return this.waitResponse(prepared,value=>{
      const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;
    },signal);
  }
  /** One original tuple read. The original inspector/batch/holder gates are run
   * here from module-owned packet data; no external boolean/result is accepted. */
  async readAndVerifyOwnedHengruiOutcome(handle:OwnedHengruiPublication,deadline:number,signal?:AbortSignal){
    const binding=ownedHengruiOutcomes.get(handle);
    if(!binding||binding.relay!==this||!binding.publishAttempted||!binding.publishRequestSha256||binding.readAttempted)throw Error("RELAY_OWNED_OUTCOME_REQUIRED");
    binding.readAttempted=true; // no concurrent/duplicate read or completion event
    if(!Number.isSafeInteger(deadline)||deadline>binding.outerDeadline-PILOT_BUDGET.controlMs||deadline>Date.now()+PILOT_BUDGET.controlMs)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    const packet=binding.packet,sourceResult=packet.commit.sourceResult;
    const literal=(value:string)=>`E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
    const sql=`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${literal(sourceResult.id)}) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${literal(sourceResult.batchId)}) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`;
    const dispatchBefore=deadline-PILOT_BUDGET.controlCompletionMs;
    if(Date.now()>=dispatchBefore)throw Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION");
    let prepared:Awaited<ReturnType<FilePilotRelay["createRequest"]>>,rows:Record<string,unknown>[];
    try{
      prepared=await this.createRequest("READ_OUTCOME",{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,signal);
      await publishRelayRequest(prepared.base+".request.json",prepared.serializedRequest,{deadline:prepared.deadline,dispatchBefore:(prepared.request.payload as {dispatchBefore?:string}|null)?.dispatchBefore===undefined?undefined:Date.parse((prepared.request.payload as {dispatchBefore:string}).dispatchBefore),signal});
      rows=await this.waitResponse(prepared,value=>{const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;},signal);
      if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
    }catch(cause){throw new Error("PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION",{cause});}
    if(rows.length!==1)throw Error("PILOT_OUTCOME_ROW_COUNT");
    const persisted=rows[0]!.row===null?null:reviveUtcFields(z.record(z.unknown()).parse(rows[0]!.row),['startedAt','finishedAt']);
    const {inspectPersistedAtomicCommitOutcome}=await import("../db/ingestionRepository");
    const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error("PILOT_OUTCOME_FIND_MANY_FORBIDDEN");}}});
    if(outcome.state==='COMMITTED_EXACT'){
      const batch=z.record(z.unknown()).parse(rows[0]!.batch);
      if(batch.id!==sourceResult.batchId||batch.releaseCandidateId!==sourceResult.releaseCandidateId||batch.status!=='SUCCESS'||batch.atomicCommittedCount!==1||batch.completenessVerifiedCount!==1||rows[0]!.holderId===packet.holderId)throw Error('PILOT_DB_STARTED_TERMINAL_NOT_EXACT');
      if(!process.send||!process.connected||!prepared.responseSha256)throw Error("RELAY_OWNED_CHILD_IPC_REQUIRED");
      const event={type:"PRODUCER_OUTCOME_VERIFIED_V1",tuple:{releaseCandidateId:sourceResult.releaseCandidateId,batchId:sourceResult.batchId,sourceId:sourceResult.sourceId,sourceResultId:sourceResult.id},readRequestSha256:prepared.request.requestSha256,responseSha256:prepared.responseSha256};
      await new Promise<void>((resolve,reject)=>process.send!(event,error=>error?reject(error):resolve()));
    }
    return outcome;
  }
  sql(kind:Exclude<PilotRequestKind,"ARCHIVE_STORE"|"READ_CONTEXT"|"CREATE_PENDING">,sql:string,deadline:number,signal?:AbortSignal){
    const dispatchBefore=kind==="PUBLISH"?deadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs:deadline-PILOT_BUDGET.controlCompletionMs;
    if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
    return this.request(kind,{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,value=>{
      const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;
    },signal);
  }
}
const normalize=(s:string)=>s.replace(/\s+/g," ").trim();
const ACQUIRE=normalize(`INSERT INTO "CrawlCoordinatorLock" ("id", "holderId", "acquiredAt", "heartbeatAt", "metadata")
 VALUES ($1, $2, clock_timestamp(), clock_timestamp(), 'portable-quality-sync-v1')
 ON CONFLICT ("id") DO UPDATE SET "holderId" = EXCLUDED."holderId",
 "acquiredAt" = clock_timestamp(), "heartbeatAt" = clock_timestamp(), "metadata" = EXCLUDED."metadata"
 WHERE "CrawlCoordinatorLock"."holderId" = '' OR "CrawlCoordinatorLock"."heartbeatAt" <= clock_timestamp() - ($3 * interval '1 millisecond') RETURNING "holderId"`);
const RELEASE=normalize(`UPDATE "CrawlCoordinatorLock" SET "holderId" = '', "heartbeatAt" = clock_timestamp(),
 "metadata" = 'portable-quality-sync-v1:released' WHERE "id" = $1 AND "holderId" = $2 RETURNING "holderId"`);
/** Pure whitelist seam; the transaction adapter itself remains private. */
export function prepareLeaseStatement(query:string,values:unknown[]){
  const text=normalize(query),kind=text===ACQUIRE?"LEASE_ACQUIRE":text===RELEASE?"LEASE_RELEASE":null;
  if(!kind||values.length!==(kind==="LEASE_ACQUIRE"?3:2)||values[0]!=="formal-crawl"||
    typeof values[1]!=="string"||!z.string().uuid().safeParse(values[1]).success||
    (kind==="LEASE_ACQUIRE"&&values[2]!==300000))throw Error("LEASE_SQL_NOT_ALLOWED");
  return {kind,sql:text.replace(/\$(\d)/g,(_,n:string)=>Number(n)===1?"'formal-crawl'":Number(n)===2?`'${values[1]}'`:"300000")} as const;
}
/** One fixed transaction, never an arbitrary multi-query adapter. The second
 * statement checks fresh DB time after the row lock, so an expired owner cannot revive. */
export function prepareCloudPilotRenewalSql(lease:PortableCrawlLease,deadline:number):string{
  assertPortableCrawlLeaseOwned(lease);
  const holder=z.string().uuid().parse(lease.holderId),expiresAt=new Date(deadline).toISOString();
  return `BEGIN;
SET LOCAL statement_timeout = '8000ms';
SET LOCAL lock_timeout = '1000ms';
DO $pilot_renew$
DECLARE affected bigint;
BEGIN
  IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN RAISE EXCEPTION 'PILOT_REQUEST_EXPIRED'; END IF;
  PERFORM 1 FROM public."CrawlCoordinatorLock" WHERE "id" = 'formal-crawl' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;
  UPDATE public."CrawlCoordinatorLock" SET "heartbeatAt" = clock_timestamp()
    WHERE "id" = 'formal-crawl' AND "holderId" = '${holder}'
      AND "heartbeatAt" > clock_timestamp() - interval '300 seconds';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;
  IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN RAISE EXCEPTION 'PILOT_REQUEST_EXPIRED'; END IF;
END;
$pilot_renew$;
SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE "id" = 'formal-crawl' AND "holderId" = '${holder}';
COMMIT;`;
}
export async function acquireCloudPilotLease(relay:FilePilotRelay,deadline:number,signal?:AbortSignal){
  const overallDeadline=deadline-PILOT_BUDGET.initialMs+PILOT_BUDGET.totalMs;
  let renewalUsed=false;
  const db:PortableLeaseDatabase={$transaction:async<T>(work:Parameters<PortableLeaseDatabase["$transaction"]>[0])=>{
    const calls:Array<ReturnType<typeof prepareLeaseStatement>>=[];
    const marker=Object.freeze({});
    // Preflight the private callbacks without dispatching anything. Only a
    // callback returning its sole query unchanged is a supported transaction.
    const result=await work({$queryRawUnsafe:async<R>(query:string,...values:unknown[])=>{
      calls.push(prepareLeaseStatement(query,values));return marker as R;
    }});
    if(calls.length!==1||result!==marker)throw Error("LEASE_SINGLE_QUERY_REQUIRED");
    // Cleanup alone gets a fresh <=60s wait, even after an unknown renewal.
    // Its unchanged exact-holder UPDATE cannot revive ownership or clear a newer owner.
    const call=calls[0]!,rows=await relay.sql(call.kind,call.sql,Math.min(call.kind==="LEASE_RELEASE"?overallDeadline:deadline,Date.now()+PILOT_BUDGET.controlMs),
      call.kind==="LEASE_ACQUIRE"?signal:undefined);
    return z.array(z.object({holderId:z.string()}).strict()).max(1).parse(rows) as T;
  }};
  const handle=await acquirePortableCrawlLease(db);
  return {handle,release:()=>releasePortableCrawlLease(db,handle),renewOnce:async(renewalSignal?:AbortSignal)=>{
    if(renewalUsed)throw Error("PILOT_RENEWAL_ALREADY_USED");
    renewalUsed=true;assertPortableCrawlLeaseOwned(handle);renewalSignal?.throwIfAborted();
    const started=Date.now();
    if(started>=deadline-PILOT_BUDGET.controlMs)throw Error("PILOT_RENEWAL_BUDGET_EXHAUSTED");
    const renewalDeadline=started+PILOT_BUDGET.controlMs;
    const rows=await relay.sql("LEASE_RENEW",prepareCloudPilotRenewalSql(handle,renewalDeadline),renewalDeadline,renewalSignal);
    if(Date.now()>=renewalDeadline)throw Error("RELAY_DEADLINE");
    renewalSignal?.throwIfAborted();assertPortableCrawlLeaseOwned(handle);
    z.array(z.object({holderId:z.literal(handle.holderId)}).strict()).length(1).parse(rows);
    // Only this exact successful acknowledgement extends the local budget.
    // Anchor to request START, never to a delayed acknowledgement or DB clock conversion.
    return Math.min(overallDeadline,started+PILOT_BUDGET.initialMs);
  }};
}
/** PostgreSQL timestamp-without-time-zone is explicitly interpreted as UTC.
 * Only selected top-level DB fields are revived; nested receipt JSON is untouched. */
export function reviveUtcFields<T extends object,K extends keyof T>(row:T,keys:readonly K[]):Omit<T,K>&Record<K,Date>{
  const out={...row} as Record<keyof T,unknown>;
  for(const key of keys){const value=out[key];if(value===null)continue;
    if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?$/.test(value))throw Error("UTC_TIMESTAMP_REQUIRED");
    const date=new Date(value.endsWith("Z")?value:value+"Z");if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==value.slice(0,19))throw Error("UTC_TIMESTAMP_INVALID");out[key]=date;
  }
  return out as Omit<T,K>&Record<K,Date>;
}
const fileSchema=z.object({path:z.string(),sha256:SHA,byteCount:z.number().int().nonnegative(),chunks:z.array(z.string()).min(1)}).strict();
const bundleSchema=z.object({schemaVersion:z.literal(1),sidecar:z.object({releaseCandidateId:z.string(),batchId:z.string(),sourceId:z.string(),sourceResultId:z.string(),evidenceSubdirectory:z.string(),artifacts:z.array(z.record(z.unknown()))}).strict(),files:z.array(fileSchema).min(1)}).strict();
export type ArchiveBundle=z.infer<typeof bundleSchema>;
export async function makeArchiveBundle(request:VerifyArchivedEvidenceRequest):Promise<ArchiveBundle>{
  const artifacts=await verifyArchivedSourceEvidence(request);
  const files=await Promise.all(artifacts.map(async artifact=>{
    const bytes=await readFile(join(request.workspaceRoot,artifact.path)),chunks:string[]=[];
    for(let n=0;n<bytes.length;n+=576)chunks.push(bytes.subarray(n,n+576).toString("base64"));
    return {path:artifact.path,sha256:sha256(bytes),byteCount:bytes.length,chunks:chunks.length?chunks:[""]};
  }));
  const {releaseCandidateId,batchId,sourceId,sourceResultId,evidenceSubdirectory}=request;
  return bundleSchema.parse({schemaVersion:1,sidecar:{releaseCandidateId,batchId,sourceId,sourceResultId,evidenceSubdirectory,artifacts:JSON.parse(JSON.stringify(artifacts))},files});
}
/** The caller must supply a newly created empty directory. Never overwrites. */
export async function restoreArchiveBundle(value:unknown,workspaceRoot:string){
  const bundle=bundleSchema.parse(value);
  if((await lstat(workspaceRoot)).isSymbolicLink()||(await readdir(workspaceRoot)).length)throw Error("ARCHIVE_RESTORE_NOT_FRESH");
  if(bundle.files.length!==bundle.sidecar.artifacts.length||new Set(bundle.files.map(f=>f.path)).size!==bundle.files.length)throw Error("ARCHIVE_FILE_SET_MISMATCH");
  for(const file of bundle.files){
    if(isAbsolute(file.path)||file.path.split(/[\\/]/).some(p=>!p||p===".."||p==="."))throw Error("ARCHIVE_PATH_INVALID");
    const bytes=Buffer.concat(file.chunks.map(chunk=>{const b=Buffer.from(chunk,"base64");if(b.toString("base64")!==chunk)throw Error("ARCHIVE_BASE64_INVALID");return b;}));
    if(bytes.length!==file.byteCount||sha256(bytes)!==file.sha256)throw Error("ARCHIVE_BYTES_MISMATCH");
    const artifact=bundle.sidecar.artifacts.find(a=>a.path===file.path);
    if(artifact?.sha256!==file.sha256||artifact?.byteCount!==file.byteCount)throw Error("ARCHIVE_SIDECAR_MISMATCH");
    const target=resolve(workspaceRoot,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx",mode:0o600});
  }
  const artifacts=bundle.sidecar.artifacts.map(a=>reviveUtcFields(a,["capturedAt"]));
  return verifyArchivedSourceEvidence({...bundle.sidecar,workspaceRoot,artifacts} as unknown as VerifyArchivedEvidenceRequest);
}
