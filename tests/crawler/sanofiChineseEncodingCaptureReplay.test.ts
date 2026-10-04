// @vitest-environment node
// Optional private original replay. Supply the two local capture directories;
// original HTTP bodies are read in place and never copied into repository fixtures.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deserialize } from "node:v8";
import { describe, it, expect } from "vitest";
import { parseSanofiChineseDetail, parseSanofiChineseNative, sanofiHash, type SanofiDescriptionAnomaly } from "../../src/crawler/sanofiChineseNative";
import { validateSanofiChineseDom, type SanofiChineseDomCapture } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { sanitizeEvidenceHttpUrl } from "../../src/crawler/sourceFetchEvidence";
import type { SourceFetchResult } from "../../src/crawler/runSourceCrawl";
const mainDir=process.env.SANOFI_MAIN_CAPTURE_DIR,independentDir=process.env.SANOFI_INDEPENDENT_CAPTURE_DIR;
describe.skipIf(!mainDir||!independentDir)("Sanofi private stopped capture encoding replay",()=>{
  it("replays every saved pair, agrees on the single exception, and leaves both incomplete originals byte-identical",()=>{
    const files=[...readdirSync(mainDir!).map(f=>join(mainDir!,f)),...readdirSync(independentDir!).map(f=>join(independentDir!,f))];
    const originalHashes=files.map(f=>sanofiHash(readFileSync(f).toString("base64")));
    const dom=JSON.parse(readFileSync(join(independentDir!,"dom-capture.json"),"utf8")) as SanofiChineseDomCapture;
    const {rows,total}=validateSanofiChineseDom(dom),allRows=rows.flat();
    const fetched=deserialize(readFileSync(join(mainDir!,"sourceFetchResult.v8"))) as SourceFetchResult;
    expect(fetched.ok).toBe(false);
    const artifacts=fetched.fetchEvidence!.artifacts;
    const receipts=readdirSync(independentDir!).filter(f=>/^independent-http-\d+\.json$/u.test(f)).map(f=>JSON.parse(readFileSync(join(independentDir!,f),"utf8")));
    const replay=(route:"main"|"independent")=>{
      let detailCount=0,nativeCount=0;const anomalies:SanofiDescriptionAnomaly[]=[];
      for(const row of allRows){
        const detailReceipt=route==="main"?artifacts.find(a=>a.logicalKey===`sanofi-cn-detail-${row.id}`):receipts.find(r=>r.url===row.url);
        if(!detailReceipt)continue;
        expect(detailReceipt.finalUrl).toBe(row.url);expect(route==="main"?detailReceipt.httpStatus:detailReceipt.status).toBe(200);
        const html=String(detailReceipt.body);if(route==="independent")expect(sanofiHash(html)).toBe(detailReceipt.bodySha256);
        const detail=parseSanofiChineseDetail(html,row);detailCount++;
        if(detail.countryScope!=="MAINLAND")continue;
        const nativeReceipt=route==="main"?artifacts.find(a=>a.logicalKey===`sanofi-cn-tupu-${detail.reqId}`):receipts.find(r=>r.url===detail.applyUrl);
        expect(nativeReceipt,`missing saved native counterpart: ${route} ${row.id}`).toBeDefined();
        expect(nativeReceipt.finalUrl).toBe(route==="main"?sanitizeEvidenceHttpUrl(detail.applyUrl):detail.applyUrl);expect(route==="main"?nativeReceipt.httpStatus:nativeReceipt.status).toBe(200);
        const nativeHtml=String(nativeReceipt.body);if(route==="independent")expect(sanofiHash(nativeHtml)).toBe(nativeReceipt.bodySha256);
        const parsed=parseSanofiChineseNative(nativeHtml,detail);nativeCount++;
        if(parsed.descriptionAnomaly){
          expect(parsed).toMatchObject({state:"PUBLISHING",cities:["沈阳"]});anomalies.push(parsed.descriptionAnomaly);
        }
      }
      expect(detailCount).toBeGreaterThan(0);expect(detailCount).toBeLessThan(total);
      expect(anomalies).toHaveLength(1);expect(anomalies[0]).toMatchObject({id:"44747763584",reqId:"R2869307",nativePositionId:"6aaa09c37280da28da079ca1",replacementCharacterCount:3,nativeCharacterCount:1});
      return {route,detailCount,nativeCount,total,anomalies};
    };
    const main=replay("main"),independent=replay("independent");expect(main.anomalies).toEqual(independent.anomalies);
    expect(files.map(f=>sanofiHash(readFileSync(f).toString("base64")))).toEqual(originalHashes);
    console.info("SANOFI_STOPPED_CAPTURE_READ_ONLY_REPLAY",JSON.stringify({main,independent,originalFilesUnchanged:files.length,fullTraversalCertified:false}));
  });
});
