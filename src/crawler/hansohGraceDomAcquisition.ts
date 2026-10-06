import { randomUUID } from "node:crypto";
import { mkdir, readFile, lstat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { HANSOH_GRACE_DOM_KEY,HANSOH_GRACE_DOM_LOCATOR,hansohGraceBindingSchema,hansohGraceContextHash,hansohGraceDigest,hansohGraceRequestSchema,hansohGraceResponseSchema,hansohGraceTargets,replayHansohGraceDom,type HansohGraceBinding,type HansohGracePreviousContext } from "./hansohGraceDomEvidence";
import { hasStrictHansohNativeWindowPlan } from "./hansohNativeWindowEvidence";
import { runSourceCrawl, type SourceFetchResult } from "./runSourceCrawl";
import { parsePersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export interface HansohGraceDomAcquisition extends HansohGracePreviousContext {
  directory:string;binding:HansohGraceBinding;signal?:AbortSignal;
}
/** The collector requests only same-run absent grace targets, after replaying the
 * original native list. A trusted dot cloud browser answers this one-time file
 * request with its actual documentElement.outerHTML. No imported ready-made
 * protected IDs, transport callback, Apply click, API guess or HTTP claim. */
export async function acquireHansohGraceDom(plan:SourceCrawlPlan,fetched:SourceFetchResult,input:HansohGraceDomAcquisition,startedAt:string):Promise<SourceFetchResult>{
  if(!hasStrictHansohNativeWindowPlan(plan))throw Error("HANSOH_GRACE_PLAN_REQUIRED");
  if(!fetched.ok||!fetched.fetchEvidence)return fetched;
  const main=await runSourceCrawl(plan,{fetch:()=>structuredClone(fetched),isBaseline:false});
  if(!main.truth.completenessVerified)throw Error("HANSOH_GRACE_NATIVE_LIST_REQUIRED");
  const context=structuredClone({previousJobs:input.previousJobs,visibilityFloor:input.visibilityFloor});
  const targets=hansohGraceTargets(context,main.jobs);
  if(!targets.length)return fetched;
  const binding=hansohGraceBindingSchema.parse(input.binding),requestedAt=new Date().toISOString(),deadlineAt=new Date(Date.parse(startedAt)+20*60_000).toISOString();
  const request=hansohGraceRequestSchema.parse({schemaVersion:1,kind:"HANSOH_GRACE_FRESH_DOM_REQUEST",nonce:randomUUID(),binding,companyId:plan.company.id,contextSha256:hansohGraceContextHash(context),listEvidenceSha256:hansohGraceDigest(fetched.fetchEvidence),requestedAt,deadlineAt,targets});
  const directory=resolve(input.directory);await mkdir(directory,{recursive:true,mode:0o700});
  const base=join(directory,request.nonce);
  await writeFile(`${base}.request.json`,JSON.stringify(request,null,2),{flag:"wx",mode:0o600});
  const signal=AbortSignal.any([AbortSignal.timeout(Math.max(1,Date.parse(deadlineAt)-Date.now())),...(input.signal?[input.signal]:[])]);
  let bytes:Buffer;
  while(true){
    signal.throwIfAborted();
    try{const info=await lstat(`${base}.response.json`);if(info.size>16*1024*1024||!info.isFile())throw Error("HANSOH_GRACE_RESPONSE_FILE_INVALID");bytes=await readFile(`${base}.response.json`);if(bytes.length>16*1024*1024)throw Error("HANSOH_GRACE_RESPONSE_FILE_INVALID");break;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;await setTimeout(250,undefined,{signal});}
  }
  if(!hasUniqueJsonObjectKeys(bytes.toString("utf8")))throw Error("HANSOH_GRACE_RESPONSE_JSON_INVALID");
  const response=hansohGraceResponseSchema.parse(JSON.parse(bytes.toString("utf8")));
  const times=response.captures.map(c=>Date.parse(c.capturedAt));
  if(times.some(t=>t>Date.now()))throw Error("HANSOH_GRACE_FUTURE_CAPTURE");
  const evidence=parsePersistentSourceFetchEvidence({...fetched.fetchEvidence,artifacts:[...fetched.fetchEvidence.artifacts,{id:HANSOH_GRACE_DOM_KEY,logicalKey:HANSOH_GRACE_DOM_KEY,kind:"COMMAND_OUTPUT",capturedAt:new Date(Math.max(...times)).toISOString(),bodyRepresentation:"EXACT",extractorLocator:HANSOH_GRACE_DOM_LOCATOR,body:JSON.stringify({request,response})}]});
  replayHansohGraceDom(plan,evidence,main.jobs,binding,context);
  return {...fetched,fetchEvidence:evidence};
}
