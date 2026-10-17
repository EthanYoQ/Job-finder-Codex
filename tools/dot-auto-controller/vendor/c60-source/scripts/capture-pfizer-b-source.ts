/** Candidate evidence only. The sole publisher owns final B issuance and SQL47. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { serialize } from "node:v8";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createWorkdaySourceFetch } from "../src/crawler/workdaySourceFetch";
import { runSourceCrawl, type SourceFetchResult } from "../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation } from "../src/crawler/traversalCertificate";
import { captureOfficialJsonRenderedTraversal, OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES } from "../src/crawler/officialJsonRenderedTraversalValidator";
import { pfizerDomPacketsToPages } from "../src/crawler/pfizerRenderedTraversal";
import { runWithOfficialSourceAttemptTimeout, fetchWithOfficialTimeout } from "../src/crawler/officialHttpRuntimeLimits";

const [mode, directory, domFile, ...extra] = process.argv.slice(2);
if (!["main", "dom", "browser"].includes(mode ?? "") || !directory || extra.length || mode === "dom" && !domFile || mode !== "dom" && domFile) throw Error("Usage: capture-pfizer-b-source.ts main <new-private-dir> | dom <new-private-dir> <actual-managed-browser-capture.json> | browser <new-private-dir>");
const root = resolve(directory); await mkdir(root, {mode:0o700});
const put = (name:string,data:string|Uint8Array) => writeFile(join(root,name),data,{flag:"wx",mode:0o600});
const sourceId = "source-pfizer-china-social", plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId)!;
const sourceConfigSha256 = sourcePlanConfigSha256(plan), startedAt = new Date().toISOString();
await put("plan.json",JSON.stringify(plan,null,2));
if (mode === "main") {
    let fetched: SourceFetchResult | undefined, responseNumber = 0;
    // Same per-response write-before-validation pattern as the existing Amgen captures.
    const captureHttp = async (request:{url:string;method:"GET"|"POST";headers:Record<string,string>;body?:string}) => {
        const number = responseNumber++, requestedAt = new Date().toISOString();
        const response = await fetchWithOfficialTimeout(request.url,{method:request.method,
            headers:{...request.headers,"User-Agent":"job-search-crawler/0.1"},...(request.body===undefined?{}:{body:request.body})});
        const body = await response.text();
        const captured = {status:response.status,body,finalUrl:response.url,contentType:response.headers.get("content-type")??"",capturedAt:new Date().toISOString()};
        await put(`response-${String(number).padStart(4,"0")}.json`,JSON.stringify({requestedAt,
            request:{url:request.url,method:request.method,...(request.body===undefined?{}:{body:request.body})},
            response:captured,bodySha256:createHash("sha256").update(body).digest("hex")},null,2));
        return captured;
    };
    const result = await runWithOfficialSourceAttemptTimeout(()=>runSourceCrawl(plan,{isBaseline:false,fetch:async(p,t)=>{
        fetched=await createWorkdaySourceFetch({http:captureHttp,detailHttp:captureHttp})(p,t);await put("sourceFetchResult.v8",serialize(fetched));return fetched;
    }}),20*60_000);
    await put("result.v8",serialize(result));await put("records.json",JSON.stringify(result.jobs,null,2));
    const finishedAt = new Date().toISOString();
    await put("reviewed-worker-capture.json",JSON.stringify({schemaVersion:2,sourceId,sourceConfigSha256,startedAt,finishedAt,
        fetched:{path:join(root,"sourceFetchResult.v8"),sha256:createHash("sha256").update(serialize(fetched)).digest("hex"),encoding:"v8"}},null,2));
    const summary={purpose:"NON_CERTIFYING_CANDIDATE_CAPTURE",sourceId,sourceConfigSha256,startedAt,finishedAt,status:result.status,truth:result.truth,count:result.jobs.length,fetchCounts:result.fetchEvidence?.fetchCounts,failureReason:result.status==="FAILED"?result.failureReason:undefined};
    await put("capture-summary.json",JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
    if(!result.truth.completenessVerified) process.exitCode=1;
} else {
    const captured=mode==="browser"?await captureOfficialJsonRenderedTraversal({sourceId,entryUrl:OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES[sourceId].entryUrl,signal:AbortSignal.timeout(20*60_000)}):undefined;
    const raw=captured?JSON.stringify({captureKind:"CLOUD_BROWSER_DOM_JSONLD",...captured}):await readFile(resolve(domFile!),"utf8"),capture=JSON.parse(raw);
    if(!captured&&(capture.captureKind!=="MANAGED_BROWSER_DOM_JSONLD"||typeof capture.observedAt!=="string"||!Number.isFinite(Date.parse(capture.observedAt))))throw Error("Expected a real managed-browser DOM capture with its original observedAt");
    await put("managed-browser-capture.json",raw);
    const rawCaptureSha256=createHash("sha256").update(raw).digest("hex");
    const pages=captured?.pages??pfizerDomPacketsToPages(capture.packets,rawCaptureSha256);
    const validation=createOfficialJsonRenderedTraversalValidation({sourceId,companyId:plan.company.id,sourceConfigSha256,surfaceIds:[plan.source.surfaceId!],channelIds:plan.expectedChannels!.map(c=>c.channelId),pages,observedAt:capture.observedAt,expiresAt:new Date(Date.parse(capture.observedAt)+7*24*60*60_000).toISOString()});
    await put("independent-validation.json",JSON.stringify(validation,null,2));
    const summary={purpose:"NON_CERTIFYING_INDEPENDENT_DOM_CAPTURE",sourceId,sourceConfigSha256,observedAt:capture.observedAt,finishedAt:new Date().toISOString(),rawCount:pages.reduce((n,p)=>n+p.rawRows.length,0),excludedCount:pages.flatMap(p=>p.rawRows).filter(r=>r.scopeDecision==="EXCLUDED_AUDITED").length,pageCount:pages.length,rawCaptureSha256,artifactSha256:validation.artifactSha256};
    await put("capture-summary.json",JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
