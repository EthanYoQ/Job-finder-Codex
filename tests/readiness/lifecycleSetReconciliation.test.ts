import {describe,expect,it} from "vitest";
import {canonicalStringSetSha256} from "../../src/crawler/sourceFetchEvidence";
import {reconcileLifecycleSets,type LifecycleSetEvidence} from "../../src/readiness/lifecycleSetReconciliation";
const tuple={releaseCandidateId:"rc-1",batchId:"batch-1",sourceResultId:"result-1",sourceId:"source-1"};
const entry=(key:string,status:"ACTIVE"|"SUSPECTED_OFFLINE"|"OFFLINE",count:number)=>({...tuple,key,status,missingSuccessfulCrawlCount:count});
function valid():LifecycleSetEvidence{const currentKeys=["current"],graceEntries=[entry("grace","ACTIVE",1)],visibleKeys=["current","grace"];
 return {...tuple,currentKeys,currentSha256:canonicalStringSetSha256(currentKeys),graceEntries,graceSha256:canonicalStringSetSha256(["grace"]),visibleKeys,
 visibleSha256:canonicalStringSetSha256(visibleKeys),lifecycleEntries:[entry("current","ACTIVE",0),...graceEntries,entry("suspected","SUSPECTED_OFFLINE",2),entry("offline","OFFLINE",3)]};}
describe("lifecycle set reconciliation",()=>{
 it("passes legal first-miss grace and derives counts",()=>expect(reconcileLifecycleSets(valid())).toMatchObject({currentCount:1,graceCount:1,visibleCount:2}));
 it.each([
  ["suspected count two","suspected",2],
  ["offline count three","offline",3],
  ["offline count four","offline",4]
 ])("accepts legal hidden %s",(_name,key,count)=>{const value:any=structuredClone(valid());value.lifecycleEntries.find((e:any)=>e.key===key).missingSuccessfulCrawlCount=count;expect(reconcileLifecycleSets(value)).toMatchObject({visibleCount:2})});
 it.each([
  ["equal-count replacement",(x:any)=>{x.visibleKeys=["current","replacement"];x.visibleSha256=canonicalStringSetSha256(x.visibleKeys)}],
  ["tampered hash",(x:any)=>{x.visibleSha256="a".repeat(64)}],
  ["duplicate",(x:any)=>{x.currentKeys.push("current")}],
  ["current/grace overlap",(x:any)=>{x.currentKeys=["current","grace"];x.currentSha256=canonicalStringSetSha256(x.currentKeys)}],
  ["mixed tuple",(x:any)=>{x.graceEntries[0].batchId="other"}],
  ["hidden visible",(x:any)=>{x.visibleKeys=["current","grace","offline"];x.visibleSha256=canonicalStringSetSha256(x.visibleKeys)}],
  ["invalid grace",(x:any)=>{x.graceEntries[0].missingSuccessfulCrawlCount=2}]
  ,["orphan active zero",(x:any)=>{x.lifecycleEntries.push(entry("orphan","ACTIVE",0))}]
  ,["active count two",(x:any)=>{x.lifecycleEntries.push(entry("bad-active","ACTIVE",2))}]
  ,["suspected count one",(x:any)=>{x.lifecycleEntries.find((e:any)=>e.key==="suspected").missingSuccessfulCrawlCount=1}]
  ,["suspected count three",(x:any)=>{x.lifecycleEntries.find((e:any)=>e.key==="suspected").missingSuccessfulCrawlCount=3}]
  ,["offline count two",(x:any)=>{x.lifecycleEntries.find((e:any)=>e.key==="offline").missingSuccessfulCrawlCount=2}]
  ,["suspected hidden membership",(x:any)=>{x.visibleKeys.push("suspected");x.visibleSha256=canonicalStringSetSha256(x.visibleKeys)}]
  ,["offline hidden membership",(x:any)=>{x.visibleKeys.push("offline");x.visibleSha256=canonicalStringSetSha256(x.visibleKeys)}]
 ])("rejects %s",(_name,mutate)=>{const value:any=structuredClone(valid());mutate(value);expect(()=>reconcileLifecycleSets(value)).toThrow()});
});
