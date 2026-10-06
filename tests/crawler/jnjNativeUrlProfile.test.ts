// @vitest-environment node
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";
import { compilePortableAtomicSourceEvidenceSql } from "../../src/db/ingestionRepository";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { jnjDomListUrl, jnjDomObservedUrlProfile, JNJ_DOM_MANUAL_ENTRY, JNJ_DOM_URL_PROFILES } from "../../src/crawler/jnjCareersDomUrlProfile";
import { auditJnjCareersDomObservations, createJnjCareersDomSourceFetch, replayJnjCareersDomEvidence } from "../../src/crawler/jnjCareersDomEvidence";
import { hasBoundJnjDomOfficialArtifact } from "../../src/db/jnjDomEvidenceAdmission";
import { syntheticJnjFixture, syntheticJnjCommit, syntheticJnjPlan, mutateSynthetic as mutate } from "../helpers/jnjNativeSyntheticFixture";
const native=(page:number)=>jnjDomListUrl("native-pagesize20-v2",page);
it("keeps the manual entry and accepts only the exact native form and page-one navigation variants",()=>{
 expect(JNJ_DOM_MANUAL_ENTRY).toBe("https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results");
 expect(jnjDomObservedUrlProfile("https://www.careers.jnj.com/en/jobs/?search=&country=China&pagesize=20#results",1)).toBe("native-pagesize20-v2");
 expect(jnjDomObservedUrlProfile(native(1),1)).toBe("native-pagesize20-v2");
});
it.each(JNJ_DOM_URL_PROFILES)("replays %s with its exact immutable bytes, profile identity and genuine A receipt",async profile=>{
 const {input,result,commit,plan}=await syntheticJnjCommit(profile);
 expect(result.fetchEvidence!.captureTool.version).toBe(profile==="native-pagesize20-v2"?"2":"1");
 expect(replayJnjCareersDomEvidence(plan,result.fetchEvidence!,result.jobs)).toBe(true);
 expect(hasBoundJnjDomOfficialArtifact(commit,commit.artifacts[0]!)).toBe(true);
 for(let i=0;i<input.lists.length;i++) {
   const artifact=result.fetchEvidence!.artifacts[i]!;
   expect(artifact.body).toBe(input.lists[i]);
   expect(result.fetchEvidence!.pages[i]!.responseFingerprintSha256).toBe(createHash("sha256").update(input.lists[i]!).digest("hex"));
 }
 expect(result.fetchEvidence!.pages[0]!.nextPageSignalAfter).toBe(jnjDomListUrl(profile,2));
 const forged=structuredClone(result.fetchEvidence!);forged.captureTool.version=profile==="native-pagesize20-v2"?"1":"2";
 expect(replayJnjCareersDomEvidence(plan,forged,result.jobs)).toBe(false);
});
it("admits exact six-page/106 synthetic traversal and correct Last 6, without claiming real observed equivalence",()=>{
 const f=syntheticJnjFixture(106),a=auditJnjCareersDomObservations(f.lists,f.details);
 expect(a.total).toBe(106);expect(a.evidence.pages).toHaveLength(6);expect(a.urlProfile).toBe("native-pagesize20-v2");
});
it("binds native single-page receipts to version 2 even without any next signal",async()=>{
 const {commit}=await syntheticJnjCommit("native-pagesize20-v2",1);
 expect(commit.pagination).toHaveLength(1);expect(commit.pagination[0]!.nextPageSignalAfter).toBeNull();
 expect(hasBoundJnjDomOfficialArtifact(commit,commit.artifacts[0]!)).toBe(true);
});
const changes: Array<[string,(f:ReturnType<typeof syntheticJnjFixture>)=>void]> = [
 ["mixed page URL profile",f=>f.lists[1]=mutate(f.lists[1]!,o=>o.url=jnjDomListUrl("legacy-origin-global-v1",2))],
 ["mixed native link profile",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.pagination.find((p:any)=>p.label==="Next page").url=jnjDomListUrl("legacy-origin-global-v1",2))],
 ["Last 79 on six-page scope",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.pagination.find((p:any)=>p.label==="Last page 6").label="Last page 79")],
 ["Last 6 pointing to 79",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.pagination.find((p:any)=>p.label==="Last page 6").url=native(6).replace("page=6","page=79"))],
 ["page 2 repeats Next 2",f=>f.lists[1]=mutate(f.lists[1]!,o=>o.pagination.find((p:any)=>p.label==="Next page").url=native(2))],
 ["duplicate Next",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.pagination.push(o.pagination.find((p:any)=>p.label==="Next page")))],
 ["duplicate country",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("#results","&country=China#results"))],
 ["unknown parameter",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("#results","&foo=bar#results"))],
 ["extra origin in native",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("#results","&origin=global#results"))],
 ["nonempty search",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("search=","search=medical"))],
 ["changed page size",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("pagesize=20","pagesize=100"))],
 ["changed country",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("China","Japan"))],
 ["multiple selected countries",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.filters[2].selectedOptions.push({text:"Japan",value:"Japan"}))],
 ["extra business filter",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.filters[0].selectedOptions=[{text:"MedTech",value:"MedTech"}])],
 ["foreign host",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("www.careers.jnj.com","example.invalid"))],
 ["foreign path",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.url=o.url.replace("/en/jobs/","/en/other/"))],
 ["missing page",f=>{f.lists.pop();}], ["missing detail",f=>{f.details.pop();}],
 ["false final identity comparison",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.sameIdentityOrderAsEarlier=false)],
 ["30 minute capture span",f=>f.lists[0]=mutate(f.lists[0]!,o=>o.observedAt="2026-10-03T05:30:00.000Z")],
 ["wrong Apply identity",f=>f.details[0]=mutate(f.details[0]!,o=>o.applyLinks[0].href=o.applyLinks[0].href.replace("R-000001","R-999999"))]
];
it.each(changes)("rejects native %s before any publication",async(_,change)=>{
 const f=syntheticJnjFixture(106);change(f);
 expect(await createJnjCareersDomSourceFetch(f)(syntheticJnjPlan)).toMatchObject({ok:false,failureReason:"JNJ_DOM_OBSERVATION_INVALID"});
});
it("rejects metadata profile mixing, profile spoofing and synthetic old-origin signal rewriting",async()=>{
 const {commit}=await syntheticJnjCommit();
 const cases=[(x:any)=>x.artifacts[1].captureToolVersion="1",(x:any)=>x.artifacts.forEach((a:any)=>a.captureToolVersion="1"),
   (x:any)=>x.pagination[0].nextPageSignalAfter=jnjDomListUrl("legacy-origin-global-v1",2),
   (x:any)=>x.artifacts.forEach((a:any)=>a.captureToolVersion="3")];
 for(const change of cases){const copy=structuredClone(commit);change(copy);expect(hasBoundJnjDomOfficialArtifact(copy,copy.artifacts[0]!)).toBe(false);}
});

it("compiles a native atomic candidate only offline, with real native signals retained",async()=>{
 const {commit}=await syntheticJnjCommit();
 const lease=await acquirePortableCrawlLease({$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})});
 const sql=await compilePortableAtomicSourceEvidenceSql(commit,lease);
 expect(sql).toContain("COMMAND_OUTPUT");expect(sql).toContain("pagesize=20#results");
 expect(commit.artifacts.every(a=>a.captureToolVersion==="2")).toBe(true);
});
