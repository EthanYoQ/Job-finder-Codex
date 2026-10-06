/** Package actual same-request cloud-browser observations; never fetches a URL,
 * summarizes content, changes timestamps, or fabricates an HTTP response. */
import { link,readFile,unlink,writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { assertHansohSubstantiveDom,hansohDomHash,hansohGraceDigest,hansohGraceRequestSchema,hansohGraceResponseSchema } from "../src/crawler/hansohGraceDomEvidence";
import { hasUniqueJsonObjectKeys } from "../src/crawler/strictJsonObjectKeys";
const observationsSchema=z.array(z.object({requestedUrl:z.string().url(),finalUrl:z.string().url(),capturedAt:z.string().datetime(),documentHtml:z.string().min(1).max(4_000_000)}).strict()).min(1).max(1000);
export async function prepareHansohGraceDomResponse(requestPath:string,observationsPath:string):Promise<string>{
  if(!requestPath.endsWith(".request.json"))throw Error("HANSOH_GRACE_REQUEST_PATH_INVALID");
  const requestBytes=await readFile(requestPath,"utf8"),observationBytes=await readFile(observationsPath,"utf8");
  if(!hasUniqueJsonObjectKeys(requestBytes)||!hasUniqueJsonObjectKeys(observationBytes))throw Error("HANSOH_GRACE_JSON_INVALID");
  const request=hansohGraceRequestSchema.parse(JSON.parse(requestBytes)),observations=observationsSchema.parse(JSON.parse(observationBytes)),now=Date.now();
  if(now>Date.parse(request.deadlineAt)||Date.parse(request.deadlineAt)-Date.parse(request.requestedAt)>20*60_000||observations.length!==request.targets.length)throw Error("HANSOH_GRACE_REQUEST_EXPIRED_OR_INCOMPLETE");
  const captures=observations.map((c,i)=>{const target=request.targets[i]!,time=Date.parse(c.capturedAt);
    if(c.requestedUrl!==target.officialUrl||c.finalUrl!==target.officialUrl||time<Date.parse(request.requestedAt)||time>now||time>Date.parse(request.deadlineAt))throw Error("HANSOH_GRACE_OBSERVATION_BINDING_INVALID");
    assertHansohSubstantiveDom(c.documentHtml,target);return {...c,documentHtmlSha256:hansohDomHash(c.documentHtml)};
  });
  const response=hansohGraceResponseSchema.parse({schemaVersion:1,kind:"BROWSER_UI_DOM_OBSERVATION_NOT_HTTP",captureTool:{name:"dot-cloud-browser-dom",version:"1"},requestSha256:hansohGraceDigest(request),captures});
  const bytes=JSON.stringify(response);if(Buffer.byteLength(bytes)>16*1024*1024)throw Error("HANSOH_GRACE_RESPONSE_TOO_LARGE");
  const destination=requestPath.replace(/\.request\.json$/u,".response.json"),temporary=`${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary,bytes,{flag:"wx",mode:0o600});
  try{await link(temporary,destination);}finally{await unlink(temporary);}
  return destination;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [request,observations,...extra]=process.argv.slice(2);
  if(!request||!observations||extra.length){console.error("Usage: p0-hansoh-grace-dom-response.ts <nonce.request.json> <actual-browser-observations.json>");process.exitCode=2;}
  else try{console.log(await prepareHansohGraceDomResponse(resolve(request),resolve(observations)));}catch(error){console.error(error instanceof Error?error.message:"HANSOH_GRACE_RESPONSE_FAILED");process.exitCode=1;}
}
