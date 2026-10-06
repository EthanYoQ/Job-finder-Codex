export default async function testSource(describe:any,it:any,expect:any){

const time="2026-10-02T14:00:00.000Z";
const row=(id=100)=>({pk:id,short_unique_id:`short${id}`,title:`Role ${id}`,company:{pk:13477,root_pk:13471},cities:["北京市","上海市"],
  url:`/job-detail-new/${id}/c/`,apply_url:`/apply-job-process/${id}/?company_id=13477`,job_visibility:"IE",show_apply:1,finish_apply:false,cant_applied:false,is_overseas:false});
const detail=(id=100)=>({code:200,data:{data:{is_in_china:true,company:{id:13477,root_company:{id:13471,name:"MSD"}},job:{id,root_company_id:13471,
  company:{id:13477},short_unique_id:`short${id}`,i18n_name:`Role ${id}`,description:"Will conduct early clinical studies in Immunology field.",job_visibility:"IE",
  job_locations:[{city:{cn_name:"上海市",name:"Shanghai"}},{city:{cn_name:"北京市",name:"Beijing"}}]}}}});
const apply=(id=100)=>({code:200,data:{show_apply:1,normal_share_url:`https://www.ajinga.com/recruiting/company/13477/job/${id}/job-detail`}});
describe("MSD official Ajinga source",()=>{
 it("retains exact short descriptions, date uncertainty and unordered city sets",()=>{
   expect(projectMsdAjingaJob(row(),detail(),apply())).toEqual({sourceJobId:"ajinga:100",title:"Role 100",officialUrl:"https://www.ajinga.com/job-detail-new/100/c/",locationRaw:"北京市、上海市",cities:["北京","上海"]});
 });
 it("binds localized list cities to the same official bilingual detail city objects",()=>{
   const r={...row(),cities:["Beijing","Shanghai"]};
   const d=detail();
   d.data.data.job.job_locations=[{city:{cn_name:"上海市",name:"Shanghai"}},{city:{cn_name:"北京市",name:"Beijing"}}];
   expect(projectMsdAjingaJob(r,d,apply())).toMatchObject({locationRaw:"Beijing、Shanghai",cities:["北京","上海"]});
   expect(projectMsdAjingaJob({...r,cities:["Beijing","Unknown"]},d,apply())).toBeUndefined();
   expect(projectMsdAjingaJob({...r,cities:["Beijing"]},d,apply())).toBeUndefined();
   const ambiguous=structuredClone(d);
   ambiguous.data.data.job.job_locations.push({city:{cn_name:"苏州市",name:"Beijing"}});
   expect(projectMsdAjingaJob(r,ambiguous,apply())).toBeUndefined();
   const outside=structuredClone(d);
   outside.data.data.job.job_locations=[{city:{cn_name:"台北市",name:"Beijing"}},{city:{cn_name:"上海市",name:"Shanghai"}}];
   expect(projectMsdAjingaJob(r,outside,apply())).toBeUndefined();
 });
 it.each(["wrong root","wrong id","closed","empty detail","foreign"])("rejects %s without inventing an exclusion",kind=>{
   const r=row(),d=detail(),a=apply();
   if(kind==="wrong root")d.data.data.job.root_company_id=9;
   if(kind==="wrong id")d.data.data.job.id=999;
   if(kind==="closed")a.data.show_apply=0;
   if(kind==="empty detail")d.data.data.job.description="";
   if(kind==="foreign")d.data.data.is_in_china=false;
   expect(projectMsdAjingaJob(r,d,a)).toBeUndefined();
 });
 it("preserves retryable entry HTTP failure for the existing source router",async()=>{
   const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-msd-china-social")!;
   const result=await createMsdAjingaSourceFetch({now:()=>new Date(time),http:async url=>({status:503,body:"unavailable",finalUrl:url,contentType:"text/html",capturedAt:time})})(plan);
   expect(result).toMatchObject({ok:false,transportFailure:{code:"OFFICIAL_HTTP_503",retryable:true}});
 });
 it("closes a dynamic paginated official total and emits genuine A with original timestamps",async()=>{
   const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-msd-china-social")!;
   const rows=Array.from({length:31},(_,i)=>row(100+i)),requests:string[]=[];
   rows[0]!.cities=["Beijing","Shanghai"];
   const fetcher=createMsdAjingaSourceFetch({now:()=>new Date(time),http:async url=>{
     requests.push(url);let body:string,contentType="application/json";
     if(url===MSD_AJINGA_CONFIG.entryUrl){body='<script src="https://static-c.ajinga.com/v-prod/js/app.123abc.js"></script>';contentType="text/html";}
     else if(url.startsWith("https://static-c.ajinga.com/")){body='const company={MSD:13471};const route="/msdchina/professionals";const api="/django_rest/job-list/";';contentType="application/javascript";}
     else if(url.includes("/job-list/?")){const page=Number(new URL(url).searchParams.get("page"));body=JSON.stringify({code:200,data:{count:31,list:rows.slice((page-1)*30,page*30),isLastPage:page===2,cant_applied:false}});}
     else {const id=Number((url.match(/short(\d+)/)??[])[1]);body=JSON.stringify(url.includes("apply-status")?apply(id):detail(id));}
     return {body,status:200,finalUrl:url,contentType,capturedAt:time};
   }});
   const result=await runSourceCrawl(plan,{fetch:fetcher});
   expect(result.truth).toMatchObject({transportSuccess:true,adapterSuccess:true,completenessVerified:true});
   expect(result.jobs).toHaveLength(31);expect(requests).toContain("https://www.ajinga.com/django_rest/job-list/?company_id=13471&page=2");
   const evidence=result.fetchEvidence!,original=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness!.artifactLogicalKey)!;
   const input={binding:{releaseCandidateId:"rc-msd",batchId:"batch-msd",sourceResultId:"result-msd",sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,
     transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,
     officialArtifactSha256:sha256Bytes(typeof original.body==="string"?Buffer.from(original.body):original.body).sha256};
   expect(issueAGradeOfficialTotalCertificate(input)).toMatchObject({status:"CERTIFIED",certificate:{counts:{officialTotal:31,finalUniqueJobCount:31}}});
   expect(issueAGradeOfficialTotalCertificate({...input,jobs:result.jobs.map(j=>({...j,officialTitle:"Forged"}))})).toMatchObject({status:"REJECTED"});
   expect(issueAGradeOfficialTotalCertificate({...input,jobs:result.jobs.map(j=>({...j,officialPublishedAt:time}))})).toMatchObject({status:"REJECTED"});
   for(const mutation of ["missing detail","query drift","closed apply","false total"]){
     const changed=structuredClone(evidence);
     if(mutation==="missing detail")changed.artifacts=changed.artifacts.filter(a=>a.logicalKey!=="msd-ajinga-detail-100");
     if(mutation==="query drift")changed.artifacts.find(a=>a.logicalKey==="msd-ajinga-detail-100")!.requestedUrl+="&other=1";
     if(mutation==="closed apply"){const a=changed.artifacts.find(a=>a.logicalKey==="msd-ajinga-apply-100")!;a.body=JSON.stringify({...apply(),data:{...apply().data,show_apply:0}});}
     if(mutation==="false total")changed.declaredCompleteness!.value=32;
     expect(issueAGradeOfficialTotalCertificate({...input,evidence:changed})).toMatchObject({status:"REJECTED"});
   }
 });
});

}
import {projectMsdAjingaJob,createMsdAjingaSourceFetch,MSD_AJINGA_CONFIG} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/crawler/msdAjingaSourceFetch.ts";
import {candidateCompanies} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/data/companyRegistry.ts";
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/crawler/sourcePlan.ts";
import {runSourceCrawl} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/crawler/runSourceCrawl.ts";
import {issueAGradeOfficialTotalCertificate} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/crawler/completenessCertificate.ts";
import {sha256Bytes} from "file:///workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/crawler/sourceFetchEvidence.ts";