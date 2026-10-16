// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { azDetail, azListCapture, azResponse, azRow } from '../helpers/astrazeneca';
import { acquireAstraZenecaDetails } from '../../src/crawler/astraZenecaDetailAcquisition';
import { issueAGradeOfficialTotalCertificate } from '../../src/crawler/completenessCertificate';
import { runSourceCrawl } from '../../src/crawler/runSourceCrawl';
import { sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
afterEach(()=>vi.unstubAllGlobals());
async function candidate() {
  const row=azRow(),{plan,fetched:list}=await azListCapture([row]);
  vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(row)));
  const fetched=await acquireAstraZenecaDetails(plan,list);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  const evidence=result.fetchEvidence!,artifact=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness?.artifactLogicalKey)!;
  return {plan,evidence,jobs:result.jobs,reconciliation:result.reconciliation!,paginationEvaluation:result.paginationEvaluation!,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,
    officialArtifactSha256:createHash('sha256').update(artifact.body).digest('hex'),binding:{releaseCandidateId:'synthetic-az-a',batchId:'synthetic-az-a',sourceResultId:'synthetic-az-a',sourceConfigSha256:sourcePlanConfigSha256(plan)}};
}
it('issues existing A only after complete native AstraZeneca detail replay',async()=>{
  const input=await candidate();
  expect(input.jobs[0]!.evidence.astraZenecaDetail?.postedDay?.precision).toBe('DAY');
  expect(issueAGradeOfficialTotalCertificate(input)).toMatchObject({status:'CERTIFIED',certificate:{grade:'A',counts:{officialTotal:1,finalUniqueJobCount:1}}});
});
it.each(['date','instant','city','missing','extra','country','cancelled','list-only'])('rejects %s alteration through the actual A generator',async(kind)=>{
  const input=await candidate();
  if(kind==='date')input.jobs[0]!.evidence.astraZenecaDetail!.postedDay!.calendarDay='2020-01-01';
  if(kind==='instant')input.jobs[0]!.officialPublishedAt='2026-09-01T00:00:00.000Z';
  if(kind==='city')input.jobs[0]!.cities=['北京'];
  if(kind==='missing')input.evidence.artifacts.pop();
  if(kind==='extra')input.evidence.artifacts.push({...input.evidence.artifacts[1]!,id:'extra',logicalKey:'extra'});
  if(kind==='country')input.evidence.artifacts[1]!.body=Buffer.from(Buffer.from(input.evidence.artifacts[1]!.body).toString().replace('"addressCountry":"CN"','"addressCountry":"US"'));
  if(kind==='cancelled')input.evidence.astraZenecaDetails!.entries[0]!.outcome={ok:false,code:'DETAIL_CANCELLED'};
  if(kind==='list-only'){delete input.evidence.astraZenecaDetails;input.evidence.artifacts.pop();}
  expect(issueAGradeOfficialTotalCertificate(input).status).toBe('REJECTED');
});
