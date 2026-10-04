import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {deserialize} from "node:v8";
import {z} from "zod";
import {sourcePlanConfigSha256, type SourceCrawlPlan} from "./sourcePlan";
import type {SourceFetchFunction, SourceFetchResult} from "./runSourceCrawl";

const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema=z.object({schemaVersion:z.literal(2),sourceId:z.string(),sourceConfigSha256:digest,
  startedAt:z.string().datetime(),finishedAt:z.string().datetime(),fetched:z.object({path:z.string(),sha256:digest,encoding:z.literal("v8")}).strict()}).strict();
/** An exact recent worker response, never an admission or a new observation.
 * Normal source parsing and the existing A/B issuer must still replay all bytes. */
export async function readCurrentWorkerCapture(reference:{path:string;sha256:string},plan:SourceCrawlPlan,now=new Date()):Promise<{startedAt:Date;fetch:SourceFetchFunction}>{
  const manifestBytes=await readFile(reference.path);
  if(manifestBytes.length>100_000||sha(manifestBytes)!==digest.parse(reference.sha256))throw Error("CURRENT_CAPTURE_MANIFEST_HASH");
  const manifest=manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const startedAt=new Date(manifest.startedAt),end=Date.parse(manifest.finishedAt),current=now.getTime();
  if(manifest.sourceId!==plan.source.id||manifest.sourceConfigSha256!==sourcePlanConfigSha256(plan))throw Error("CURRENT_CAPTURE_SOURCE_CONFIG");
  if(!Number.isFinite(current)||startedAt.getTime()>end||end>current||current-startedAt.getTime()>=30*60_000)throw Error("CURRENT_CAPTURE_TIME_WINDOW");
  const bytes=await readFile(manifest.fetched.path);
  if(bytes.length>64*1024*1024||sha(bytes)!==manifest.fetched.sha256)throw Error("CURRENT_CAPTURE_RESPONSE_HASH");
  const fetched=deserialize(bytes) as SourceFetchResult;
  if(!fetched||typeof fetched!=="object"||fetched.ok!==true||!fetched.fetchEvidence?.artifacts.length)throw Error("CURRENT_CAPTURE_SUCCESS_REQUIRED");
  const times=[fetched.capturedAt,...fetched.fetchEvidence.artifacts.map(artifact=>artifact.capturedAt)].map(value=>Date.parse(value));
  if(times.some(time=>!Number.isFinite(time)||time<startedAt.getTime()||time>end))throw Error("CURRENT_CAPTURE_ORIGINAL_TIMES");
  let used=false;
  return {startedAt,fetch:async requested=>{
    if(used||requested.source.id!==plan.source.id||sourcePlanConfigSha256(requested)!==manifest.sourceConfigSha256)throw Error("CURRENT_CAPTURE_SINGLE_BOUND_REPLAY");
    used=true;return structuredClone(fetched);
  }};
}
