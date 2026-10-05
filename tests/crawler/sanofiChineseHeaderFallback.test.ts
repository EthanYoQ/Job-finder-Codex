// @vitest-environment node
import {describe,it,expect} from "vitest";
import {load} from "cheerio";
import {bindSanofiChineseIndependentArtifact,parseSanofiChineseDetail,parseSanofiChineseMainDetail,parseSanofiChineseNative,replaySanofiChineseNative,sanofiHash} from "../../src/crawler/sanofiChineseNative";
import {captureSanofiChineseIndependent} from "../../src/crawler/sanofiChineseRenderedTraversal";
import {row,req,apply,jd,nativeId,detail,native,collect,http,dom,AT} from "../helpers/sanofiHeaderFixture";

describe("Sanofi main-only foreign-header fallback",()=>{
 it("retains both original identities and complete hashes while keeping independent parsing strict",async()=>{
  const html=detail(1,true),parsed=parseSanofiChineseMainDetail(html,row());
  expect(()=>parseSanofiChineseDetail(html,row())).toThrow();
  expect(parsed.headerAnomaly).toMatchObject({code:"SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY",id:"101",reqId:req(),officialUrl:row().url,applyUrl:apply(),title:row().title,mainArtifactBodySha256:sanofiHash(html),foreignId:"102",foreignReq:req(2),foreignTitle:row(2).title,foreignApplyUrl:apply(2),foreignDescriptionSha256:sanofiHash(jd(2))});
  expect(parseSanofiChineseNative(native(),parsed)).toMatchObject({state:"PUBLISHING",nativePositionId:nativeId(),cities:["北京"],nativeDescriptionSha256:sanofiHash(jd())});
  const {p,result}=await collect();expect(result.status).toBe("SUCCESS");expect(result.jobs).toHaveLength(2);
  const replay=replaySanofiChineseNative(p,result.fetchEvidence!,false);expect(replay.anomalies).toEqual([parsed.headerAnomaly]);expect(replay.decisions).toHaveLength(2);
  for(const kind of ["missing","hash","foreign","extra"]){const evidence=structuredClone(result.fetchEvidence!),artifact=evidence.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2")!;
   const audit=JSON.parse(String(artifact.body));if(kind==="missing")audit.entries=[];if(kind==="hash")audit.entries[0].mainArtifactBodySha256="f".repeat(64);if(kind==="foreign")audit.entries[0].foreignReq=req(1);if(kind==="extra")audit.entries[0].extra=true;artifact.body=JSON.stringify(audit);expect(()=>replaySanofiChineseNative(p,evidence,false),kind).toThrow();}
  await expect(captureSanofiChineseIndependent({dom:dom(),http:http(true),now:()=>new Date(AT)})).rejects.toThrow();
 });
 it.each(["missing-meta","duplicate-meta","conflict-meta","wrong-req","wrong-domain","query-extra","schema-req","meta-req","schema-title","schema-url","duplicate-schema","own-header-id","foreign-header-id","missing-header-id","missing-bottom-id","foreign-bottom-id","foreign-bottom-req","foreign-data-apply","missing-JD","duplicate-JD","duplicate-header","replacement"])("rejects %s without widening the main exception",kind=>{
  const $=load(detail(1,true)),meta=$('meta[name="search-job-apply-url"]');
  if(kind==="missing-meta")meta.remove();if(kind==="duplicate-meta")meta.after(meta.clone());if(kind==="conflict-meta")meta.after('<meta name="search-job-apply-url" content="'+apply(2)+'">');
  if(kind==="wrong-req")meta.attr("content",apply(2));if(kind==="wrong-domain")meta.attr("content",apply().replace("tupu360.com","evil.example"));if(kind==="query-extra")meta.attr("content",apply()+"&x=1");
  if(kind.startsWith("schema-")||kind==="replacement"){const s=JSON.parse($('script[type="application/ld+json"]').html()!);if(kind==="schema-req")s.identifier.value=req(2);if(kind==="schema-title")s.title=row(2).title;if(kind==="schema-url")s.url=row(2).url;if(kind==="replacement")s.description="完整���职责";$('script[type="application/ld+json"]').text(JSON.stringify(s));}
  if(kind==="meta-req")$('meta[name="job-ats-req-id"]').attr("content",req(2));if(kind==="duplicate-schema")$('script[type="application/ld+json"]').after($('script[type="application/ld+json"]').clone());
  if(kind==="own-header-id")$('.section7-title').attr("data-job-id","101");if(kind==="foreign-header-id")$('.section7-title a').attr("data-job-id","103");if(kind==="missing-header-id")$(".section7-title a").removeAttr("data-job-id");if(kind==="missing-bottom-id")$(".section7-details a").removeAttr("data-job-id");if(kind==="foreign-bottom-id")$('.section7-details a').attr("data-job-id","103");if(kind==="foreign-bottom-req")$('.section7-details a').attr("href",apply(3));if(kind==="foreign-data-apply")$('.section7-title a').attr("data-apply-url",apply(3));
  if(kind==="missing-JD")$('.ats-description').remove();if(kind==="duplicate-JD")$('.ats-description').after($('.ats-description').clone());if(kind==="duplicate-header")$('.section7-title').after($('.section7-title').clone());
  expect(()=>parseSanofiChineseMainDetail($.html(),row()),kind).toThrow();
 });
 it.each(["closed","tombstone","unknown","title","visible-title","alias","JD","native-id","duplicate-id","binding","city","unknown-city","duplicate-city","internship"])("rejects native %s for the foreign header",kind=>{
  const d=parseSanofiChineseMainDetail(detail(1,true),row()),$=load(native());
  if(kind==="closed")$('#positionStatus').attr("value","CLOSED");if(kind==="unknown")$('#positionStatus').attr("value","UNKNOWN");if(kind==="title")$('#positionName').attr("value",row(2).title);if(kind==="visible-title")$('.position-header h4').text(row(2).title);
  if(kind==="alias"){d.title="DBU Regional Manager HZ";$('#positionName').attr("value","Regional Manager");$('.position-header h4').text("Regional Manager");}
  if(kind==="JD")$('.position-description').append("不同职责");if(kind==="native-id")$('#positionId').attr("value",nativeId(2));if(kind==="duplicate-id")$('#positionId').after($('#positionId').clone());if(kind==="binding")$('script').remove();
  if(kind==="city")$('.city').text("中国台湾-台北");if(kind==="unknown-city")$('.city').text("中国");if(kind==="duplicate-city")$('.city').after($('.city').clone());if(kind==="internship")$('#recruitmentType').attr("value","INTERNSHIPRECRUITMENT");
  const html=kind==="tombstone"?'<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司"><div class="card-body">该职位已下线</div>':$.html();
  expect(()=>parseSanofiChineseNative(html,d),kind).toThrow();
 });
 it("binds the independent artifact only in a cloned derived audit before archival",async()=>{const {p,result}=await collect(),original=structuredClone(result.fetchEvidence!),bound=bindSanofiChineseIndependentArtifact(p,original,"a".repeat(64));
  expect(original).toEqual(result.fetchEvidence);expect(bound.artifacts.filter(a=>a.kind!=="ORACLE_RESULT")).toEqual(original.artifacts.filter(a=>a.kind!=="ORACLE_RESULT"));
  expect(JSON.parse(String(bound.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2")!.body)).independentArtifactSha256).toBe("a".repeat(64));
  expect(bindSanofiChineseIndependentArtifact(p,bound,"a".repeat(64))).toEqual(bound);expect(()=>bindSanofiChineseIndependentArtifact(p,bound,"b".repeat(64))).toThrow("REBIND_FORBIDDEN");
 });
 it.each(["header","module"])("rejects an explicit independent %s root identity conflict",kind=>{const $=load(detail());$(kind==="header"?".section7-title":".section7-details").attr("data-job-id","999");expect(()=>parseSanofiChineseDetail($.html(),row())).toThrow();});
 it("rejects a native redirect before projection",async()=>{const {result}=await collect(undefined,true);expect(result.status).toBe("FAILED");expect(result.jobs).toEqual([]);});
});
