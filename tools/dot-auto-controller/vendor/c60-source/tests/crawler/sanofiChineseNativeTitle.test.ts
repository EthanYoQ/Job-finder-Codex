// @vitest-environment node
import {describe,it,expect} from "vitest";
import {load} from "cheerio";
import {parseSanofiChineseDetail,parseSanofiChineseMainDetail,parseSanofiChineseNative,sanofiChineseDecision,replaySanofiChineseNative,bindSanofiChineseIndependentArtifact,sanofiHash} from "../../src/crawler/sanofiChineseNative";
import {captureSanofiChineseIndependent,replaySanofiChineseIndependent} from "../../src/crawler/sanofiChineseRenderedTraversal";
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt} from "../../src/crawler/traversalCertificate";
import {sourcePlanConfigSha256} from "../../src/crawler/sourcePlan";
import {canonicalStringSetSha256} from "../../src/crawler/sourceFetchEvidence";
import {row,detail,native,collect,http,dom,AT,LATER} from "../helpers/sanofiHeaderFixture";
const nativeTitle="Native role two",chineseTitle=row(2).title;
const nativeBody=()=>native(2).replaceAll(chineseTitle,nativeTitle);
const change=(url:string,body:string)=>url.endsWith("exid=R9000002")?body.replaceAll(chineseTitle,nativeTitle):body;
const canonical=(v:any):string=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.entries(v).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
async function receipt(){
 const {p,result}=await collect(change),independent=http(false,change);expect(result.status).toBe("SUCCESS");expect(result.jobs.some(j=>j.officialTitle===nativeTitle)).toBe(true);
 const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await independent(r),capturedAt:LATER}),now:()=>new Date(LATER)});
 const validation=createOfficialJsonRenderedTraversalValidation({sourceId:"source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:"2026-10-04T17:30:00.000Z"});
 result.fetchEvidence=bindSanofiChineseIndependentArtifact(p,result.fetchEvidence!,validation.artifactSha256);
 const binding={releaseCandidateId:"synthetic-title",batchId:"synthetic-title-batch",sourceResultId:"synthetic-title-result",sourceConfigSha256:sourcePlanConfigSha256(p)};
 const issued=issueBGradeTraversalCertificate({plan:p,binding,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation,validationExecution:"CURRENT_RUN",trigger:"INITIAL_QUALIFICATION",now:new Date(LATER)});
 expect(issued.status).toBe("CERTIFIED");if(issued.status!=="CERTIFIED")throw Error("Expected synthetic B");
 const input={certificate:issued.certificate,certificateSha256:issued.certificateSha256,now:new Date(LATER),expected:{...binding,sourceId:p.source.id,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(replaySanofiChineseIndependent(captured.pages).rawEvidenceIds),sanofiArtifacts:result.fetchEvidence!.artifacts.map(a=>({...binding,sourceId:p.source.id,kind:a.kind,extractorLocator:a.extractorLocator,sha256:sanofiHash(String(a.body))}))}};return {p,result,captured,input};
}
describe("Sanofi same-requisition title conflict record",()=>{
 it("keeps both titles and uses native title only after the original exact chain agrees",()=>{
  const d=parseSanofiChineseDetail(detail(2),row(2)),raw=nativeBody(),n=parseSanofiChineseNative(raw,d);
  expect(n.titleConflict).toEqual({chineseTitle,nativeTitle});expect(sanofiChineseDecision(d,n)).toMatchObject({title:nativeTitle,titleConflict:{chineseTitle,nativeTitle}});expect(d.title).toBe(chineseTitle);expect(raw).toBe(nativeBody());
 });
 it("replays both titles through main, independent and the strict B reader",async()=>{
  const {p,result,captured,input}=await receipt(),main=replaySanofiChineseNative(p,result.fetchEvidence!,false),independent=replaySanofiChineseIndependent(captured.pages);
  expect(main.decisions).toEqual(independent.decisions);expect(main.decisions.find(d=>d.id===row(2).id)).toMatchObject({title:nativeTitle,titleConflict:{chineseTitle,nativeTitle}});expect(verifyBGradeTraversalCertificateReceipt(input)).toMatchObject({status:"PASS",finalUniqueJobCount:2});
  const bad=structuredClone(input),oracle=JSON.parse(bad.certificate.mainTraversal.sanofiIdentityProof!.oracleBody);oracle.decisions.find((d:any)=>d.id===row(2).id).titleConflict.chineseTitle="invented";
  bad.certificate.mainTraversal.sanofiIdentityProof!.oracleBody=JSON.stringify(oracle);bad.certificateSha256=sanofiHash(canonical(bad.certificate));expect(()=>verifyBGradeTraversalCertificateReceipt(bad)).toThrow("SANOFI_CN_INDEPENDENT_IDENTITY_MISMATCH");
 });
 it.each(["wrong-req","extra-query","wrong-domain","outside","different-description","closed","visible-conflict","missing-visible","duplicate-visible","foreign-header","foreign-module"])("rejects %s without granting native authority",kind=>{
  let d=parseSanofiChineseDetail(detail(2),row(2));const $=load(nativeBody());
  if(kind==="wrong-req")d.reqId="R9000009";if(kind==="extra-query")d.applyUrl+="&x=1";if(kind==="wrong-domain")d.applyUrl=d.applyUrl.replace("tupu360.com","example.invalid");if(kind==="outside")d.countryScope="OUTSIDE";
  if(kind==="different-description")$(".position-description").append("different");if(kind==="closed")$("#positionStatus").attr("value","CLOSED");if(kind==="visible-conflict")$(".position-header h4.name").text("not the hidden title");if(kind==="missing-visible")$(".position-header h4.name").remove();if(kind==="duplicate-visible")$(".position-header h4.name").after($(".position-header h4.name").clone());
  if(kind==="foreign-header")d=parseSanofiChineseMainDetail(detail(1,true),row(1));if(kind==="foreign-module")d.anomaly={code:"SANOFI_CN_FOREIGN_MAIN_MODULE",id:d.id,reqId:d.reqId,foreignId:"999",foreignReq:"R999",foreignApplyUrl:"https://example.invalid",mainDescriptionSha256:"a".repeat(64)};
  expect(()=>parseSanofiChineseNative($.html(),d)).toThrow();
 });
 it("retains both existing alias behaviors",()=>{
  const d=parseSanofiChineseDetail(detail(2),row(2));for(const [original,mapped] of [["DBU Regional Manager HZ","Regional Manager"],["Access Strategy Project Manager","Market Access-(Sr.) Access Strategy Project Manager-Shanghai"]]){
   const n=parseSanofiChineseNative(native(2).replaceAll(chineseTitle,mapped!),{...d,title:original!});expect(n.titleConflict).toBeUndefined();expect(sanofiChineseDecision({...d,title:original!},n).title).toBe(original);
  }
 });
});
