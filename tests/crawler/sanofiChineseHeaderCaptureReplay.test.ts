// @vitest-environment node
// Optional local diagnostic originals only. Never copied, rewritten, or qualified.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {load} from "cheerio";
import {describe,it,expect} from "vitest";
import {parseSanofiChineseMainDetail,parseSanofiChineseDetail,parseSanofiChineseNative,sanofiChineseDecision,sanofiHash} from "../../src/crawler/sanofiChineseNative";
import {replaySanofiChineseIndependent} from "../../src/crawler/sanofiChineseRenderedTraversal";
const root=process.env.SANOFI_HEADER_CAPTURE_ROOT;
describe.skipIf(!root)("Sanofi saved foreign-header diagnostics",()=>{
 it("replays the original wrong header with the independently correct Chinese/native pair, preserving every byte and old time",()=>{
  const paths=["main-20261004T1728Z/response-0097.json","main-20261004T1737Z/response-0097.json","independent-20261004T1731Z/independent-http-0084.json","independent-20261004T1731Z/independent-http-0087.json","independent-20261004T1731Z/independent-http-0090.json","independent-20261004T1731Z/ui-traversal.json"].map(p=>join(root!,p));
  const bytes=paths.map(p=>readFileSync(p)),hashes=bytes.map(b=>sanofiHash(b.toString("base64"))),[main,repeated,correct,native,foreign,traversal]=bytes.map(b=>JSON.parse(b.toString("utf8")));
  const row={id:"44221810880",url:main.request.url,title:"MS Quality Compliance Manager Beijing",listLocation:"北京, 中国"};
  expect(main.bodySha256).toBe("06d74ce56f8e54700abe5ce9a80eebc55717d1f2b5ced7cc03742fd4219efdb3");expect(sanofiHash(main.response.body)).toBe(main.bodySha256);expect(repeated.bodySha256).toBe(main.bodySha256);
  expect(()=>parseSanofiChineseDetail(main.response.body,row)).toThrow();
  const own=parseSanofiChineseMainDetail(main.response.body,row),strict=parseSanofiChineseDetail(correct.body,row),mainNative=parseSanofiChineseNative(native.body,own),independentNative=parseSanofiChineseNative(native.body,strict);
  expect(sanofiChineseDecision(own,mainNative)).toEqual(sanofiChineseDecision(strict,independentNative));expect(mainNative).toMatchObject({state:"PUBLISHING",nativePositionId:"6a9e9cc17280da28da0795c3",cities:["北京"]});
  const foreignDetail=parseSanofiChineseDetail(foreign.body,{id:"43989732544",url:foreign.url,title:"普药事业部 医学信息沟通代表 天津",listLocation:"北京, 中国"});
  expect(own.headerAnomaly).toMatchObject({reqId:"R2870607",foreignId:foreignDetail.id,foreignReq:foreignDetail.reqId,foreignTitle:foreignDetail.title,foreignApplyUrl:foreignDetail.applyUrl,foreignDescriptionSha256:sanofiHash(foreignDetail.description),mainArtifactBodySha256:main.bodySha256});
  const replay=replaySanofiChineseIndependent(traversal.pages);expect(replay.rawCount).toBe(101);expect(replay.matchKeys).toHaveLength(87);expect(replay.decisions.filter(d=>d.state==="OUTSIDE")).toHaveLength(13);expect(replay.decisions.filter(d=>d.state==="CLOSED")).toHaveLength(1);
  expect(main.response.capturedAt).toBe("2026-10-04T17:30:25.141Z");
  for(const change of ["missing-meta","duplicate-meta","wrong-req","foreign-id"]){const $=load(main.response.body),meta=$('meta[name="search-job-apply-url"]');if(change==="missing-meta")meta.remove();if(change==="duplicate-meta")meta.after(meta.clone());if(change==="wrong-req")meta.attr("content",foreignDetail.applyUrl);if(change==="foreign-id")$('.section7-details').attr("data-job-id",row.id);expect(()=>parseSanofiChineseMainDetail($.html(),row),change).toThrow();}
  expect(paths.map(p=>sanofiHash(readFileSync(p).toString("base64")))).toEqual(hashes);
  console.info("SANOFI_HEADER_DIAGNOSTIC_REPLAY",JSON.stringify({originalFilesUnchanged:paths.length,independentRaw:101,independentPublishing:87,mainCaptureStillIncomplete:true,freshQualification:false}));
 });
});
