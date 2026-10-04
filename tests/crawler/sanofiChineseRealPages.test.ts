// @vitest-environment node
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe,it,expect } from "vitest";
import { parseSanofiChineseDetail,parseSanofiChineseNative,sanofiHash } from "../../src/crawler/sanofiChineseNative";
import { parseSanofiDetail } from "../../src/crawler/sanofiNativeQuality";
const fixtures=JSON.parse(gunzipSync(readFileSync("tests/fixtures/sanofi/chinese-native-semantics-20261004.json.gz")).toString("utf8")).fixtures as Array<{
  id:string;url:string;title:string;semanticHtml:string;semanticSha256:string;originalBodySha256:string;nativeHtml?:string;nativeSemanticSha256?:string;nativeOriginalBodySha256?:string
}>;
describe("Sanofi archived Chinese-only semantic evidence",()=>{
  it("binds the actual Nanning top link, Chinese schema JD and native open Nanning job while auditing the Jiujiang module",()=>{
    const f=fixtures.find(f=>f.id==="44967571328")!;expect(sanofiHash(f.semanticHtml)).toBe(f.semanticSha256);expect(sanofiHash(f.nativeHtml!)).toBe(f.nativeSemanticSha256);
    expect(f.originalBodySha256).toBe("fcd24656bfe758a2ad8b89e53892a1fc93e0dced29d372d8809469639fa149fc");expect(f.nativeOriginalBodySha256).toBe("4b7ba48439ae0eeac1d8b038f600738087f53e8ffeda47e7debcb61b54d538cd");
    expect(parseSanofiDetail(f.semanticHtml,f.url,f.id)).toBeUndefined();const detail=parseSanofiChineseDetail(f.semanticHtml,{...f,listLocation:"广州市, 中国"});
    expect(detail).toMatchObject({reqId:"R2872010",countryScope:"MAINLAND",applyUrl:"https://careersite.tupu360.com/sanofi/position/detail?exid=R2872010",anomaly:{foreignId:"45000489664",foreignReq:"R2872003"}});
    expect(parseSanofiChineseNative(f.nativeHtml!,detail)).toMatchObject({state:"PUBLISHING",locationRaw:"广西壮族自治区-南宁",cities:["南宁"]});
    expect(()=>parseSanofiChineseNative(f.nativeHtml!.replace('value="心血管和移植事业部 医学信息沟通代表 南宁"','value="普药事业部 医学信息沟通代表 九江"'),detail)).toThrow();
    expect(()=>parseSanofiChineseDetail(f.semanticHtml.replace('content="R2872010"','content="R2872003"'),{...f,listLocation:"广州市, 中国"})).toThrow();
  });
  it("audits the actual Taiwanese Chinese detail independently of the retired English set",()=>{
    const f=fixtures.find(f=>f.id==="45041447552")!;expect(sanofiHash(f.semanticHtml)).toBe(f.semanticSha256);
    expect(parseSanofiChineseDetail(f.semanticHtml,{...f,listLocation:"信宜"})).toMatchObject({reqId:"R2871504",countryScope:"OUTSIDE",applyUrl:"https://jobs.sanofi.cn/sys/apply/job/application/2649/45041447552"});
  });
  it("retains the actual foreign Chinese sys/apply ID without inventing its unavailable Req",()=>{
    const f=fixtures.find(f=>f.id==="39372820928")!;expect(sanofiHash(f.semanticHtml)).toBe(f.semanticSha256);
    const detail=parseSanofiChineseDetail(f.semanticHtml,{...f,listLocation:"中国"});
    expect(detail).toMatchObject({reqId:"R2859520",countryScope:"MAINLAND",anomaly:{foreignId:"39411593536",foreignReq:null,foreignApplyUrl:"https://jobs.sanofi.cn/sys/apply/job/application/2649/39411593536"}});
  });
});
