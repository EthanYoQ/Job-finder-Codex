/** Cloud-local candidate capture only. The sole publisher owns real certification and database writes. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {serialize} from 'node:v8';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../src/crawler/sourcePlan';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch';
import {createAstraZenecaDetailSourceFetch} from '../src/crawler/astraZenecaDetailAcquisition';
import {runSourceCrawl,type SourceFetchResult} from '../src/crawler/runSourceCrawl';
import {runWithOfficialSourceAttemptTimeout} from '../src/crawler/officialHttpRuntimeLimits';
const [sourceId,destination,...extra]=process.argv.slice(2);
if(!sourceId||!destination||extra.length||!['source-cttq-social','source-shanghai-pharma-social','source-daiichi-sankyo-china-social','source-astrazeneca-social'].includes(sourceId))throw Error('Usage: capture-domestic-a-source.ts <source-id> <new-private-directory>');
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId)!;
const root=resolve(destination);await mkdir(root,{mode:0o700});
const put=(name:string,data:string|Uint8Array)=>writeFile(join(root,name),data,{flag:'wx',mode:0o600});
const capture=sourceId==='source-astrazeneca-social'?createAstraZenecaDetailSourceFetch():createOfficialJsonSourceFetch({allowBrowserFallback:false});
const startedAt=new Date().toISOString();let fetched:SourceFetchResult|undefined;let fetchedBytes:Buffer|undefined;
await put('plan.json',JSON.stringify(plan,null,2));
const result=await runWithOfficialSourceAttemptTimeout(()=>runSourceCrawl(plan,{fetch:async(p,t)=>{
  fetched=await capture(p,t);fetchedBytes=serialize(fetched);await put('sourceFetchResult.v8',fetchedBytes);return fetched;
},isBaseline:false}),20*60_000);
const finishedAt=new Date().toISOString();
await put('result.v8',serialize(result));await put('records.json',JSON.stringify(result.jobs,null,2));
if(fetchedBytes){const bytes=fetchedBytes;await put('reviewed-worker-capture.json',JSON.stringify({schemaVersion:2,sourceId,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt,finishedAt,fetched:{path:join(root,'sourceFetchResult.v8'),sha256:createHash('sha256').update(bytes).digest('hex'),encoding:'v8'}},null,2));}
const summary={purpose:'NON_CERTIFYING_CANDIDATE_CAPTURE',sourceId,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt,finishedAt,status:result.status,truth:result.truth,count:result.jobs.length,dates:result.jobs.filter(j=>j.officialPublishedAt).length,fetchCounts:result.fetchEvidence?.fetchCounts};
await put('capture-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
if(!result.truth.transportSuccess||!result.truth.adapterSuccess||!result.truth.completenessVerified)process.exitCode=1;
