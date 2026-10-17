import assert from 'node:assert/strict';
import {requestContractV2Matches} from '/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/strictPageRequestContract.ts';
import {sanitizeEvidenceHttpUrl} from '/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourceFetchEvidence.ts';

export function assertMokaArchivedRequest(plan:any,req:any,artifact:any,index:number):void {
 if(index===0){
  assert.equal(artifact.logicalKey,'moka-entry-0000');
  assert.equal(req.method,'GET');assert.equal(req.body,undefined);
  assert.equal(req.url,plan.source.officialEntryUrl,'MOKA_EXACT_ENTRY_REQUEST');
  // The native fetcher regenerates its credential-safe entry projection; the caller compares that artifact exactly.
  return;
 }
 assert.equal(sanitizeEvidenceHttpUrl(req.url),artifact.requestedUrl);
 assert.equal(req.method,'POST');
 const page=/^moka-page-(\d{4})$/.exec(artifact.logicalKey),detail=/^moka-detail-(\d{4})-(\d{4})$/.exec(artifact.logicalKey);
 assert(page||detail,'MOKA_REQUEST_ROLE');
 const coordinate=page?{sequence:Number(page[1]),requestedOffset:Number(page[1])*50,requestedPage:null,requestedPageSize:50}:{sequence:Number(detail![1]),recordIndex:Number(detail![2])};
 assert(requestContractV2Matches(artifact.extractorLocator,{family:'moka',role:page?'page':'detail',method:req.method,url:req.url,body:req.body,coordinate}),'MOKA_EXACT_REQUEST_CONTRACT');
}
