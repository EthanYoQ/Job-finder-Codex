/** Hash-checked source-local replay into the existing current-worker capture format.
 * Does not collect, write a database, acquire a lease, or publish. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { serialize } from "node:v8";
import { createHash } from "node:crypto";
import { z } from "zod";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createJnjCareersDomSourceFetch, auditJnjCareersDomObservations } from "../src/crawler/jnjCareersDomEvidence";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../src/crawler/completenessCertificate";
import { JNJ_DOM_SOURCE } from "../src/crawler/jnjCareersDomContract";
const [directory, expectedManifestSha, output, ...extra] = process.argv.slice(2);
if (!directory || !output || !expectedManifestSha || extra.length) throw Error("Usage: prepare-jnj-dom-current-capture.ts <original-directory> <original-manifest-sha256> <output-directory>");
const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const input=resolve(directory),out=resolve(output),manifestBytes=await readFile(join(input,"manifest.json"));
if(hash(manifestBytes)!==z.string().regex(/^[a-f0-9]{64}$/u).parse(expectedManifestSha))throw Error("JNJ_ORIGINAL_MANIFEST_HASH");
const manifest=z.object({kind:z.literal("BROWSER_UI_DOM_EVIDENCE_NOT_HTTP"),files:z.array(z.object({file:z.string(),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/u)}))}).passthrough().parse(JSON.parse(manifestBytes.toString("utf8")));
const lists=manifest.files.filter(f=>/^jnj-list-page-[1-9][0-9]*\.json$/u.test(f.file)).sort((a,b)=>Number(a.file.match(/\d+/u)![0])-Number(b.file.match(/\d+/u)![0]));
const details=manifest.files.filter(f=>/^r-\d+\.json$/u.test(f.file));
if(new Set([...lists,...details].map(f=>f.file)).size!==lists.length+details.length)throw Error("JNJ_ORIGINAL_FILE_DUPLICATE");
async function original(f:(typeof lists)[number]){const bytes=await readFile(join(input,f.file));if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw Error("JNJ_ORIGINAL_BODY_HASH");return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
const raw={lists:await Promise.all(lists.map(original)),details:await Promise.all(details.map(original))};
const audit=auditJnjCareersDomObservations(raw.lists,raw.details),plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===JNJ_DOM_SOURCE)!;
const fetched=await createJnjCareersDomSourceFetch(raw)(plan),result=await runSourceCrawl(plan,{fetch:async()=>fetched});
if(!fetched.ok||!result.truth.completenessVerified||!result.fetchEvidence||!result.reconciliation||!result.paginationEvaluation)throw Error("JNJ_DOM_REPLAY_REJECTED");
const certificate=issueAGradeOfficialTotalCertificate({plan,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:hash(result.fetchEvidence.artifacts[0]!.body),binding:{releaseCandidateId:"jnj-dom-replay-diagnostic",batchId:"jnj-dom-replay-diagnostic",sourceResultId:"jnj-dom-replay-diagnostic",sourceConfigSha256:sourcePlanConfigSha256(plan)}});
if(certificate.status!=="CERTIFIED")throw Error("JNJ_DOM_A_REPLAY_REJECTED");
await mkdir(out,{recursive:true,mode:0o700});
const fetchedBytes=serialize(fetched),fetchedPath=join(out,"fetched.v8");await writeFile(fetchedPath,fetchedBytes,{flag:"wx",mode:0o600});
const current={schemaVersion:2,sourceId:JNJ_DOM_SOURCE,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt:audit.startedAt,finishedAt:audit.finishedAt,fetched:{path:fetchedPath,sha256:hash(fetchedBytes),encoding:"v8"}};
const currentBytes=JSON.stringify(current,null,2),currentPath=join(out,"current-capture.json");await writeFile(currentPath,currentBytes,{flag:"wx",mode:0o600});
const report={purpose:"SOURCE_LOCAL_REPLAY_NOT_DATABASE_PUBLICATION",sourceId:JNJ_DOM_SOURCE,jobCount:result.jobs.length,pageCount:audit.evidence.pages.length,detailCount:details.length,startedAt:audit.startedAt,finishedAt:audit.finishedAt,originalManifestSha256:expectedManifestSha,originalFiles:[...lists,...details],certificateStatus:certificate.status,currentCapture:{path:currentPath,sha256:hash(currentBytes)},applicationEvidence:"VISIBLE_NATIVE_APPLY_LINK_ONLY_DESTINATIONS_NOT_VISITED",httpEvidence:false};
await writeFile(join(out,"replay-report.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify({...report,originalFiles:report.originalFiles.length},null,2));
