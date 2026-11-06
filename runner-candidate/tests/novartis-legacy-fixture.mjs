import {sanitizeEvidenceHttpUrl,sha256Bytes} from '../src/crawler/sourceFetchEvidence.ts';

// Rebind synthetic URLs and their matching traces to a historical native sort.
export function legacySortEvidence(evidence,version,order){
 const encoded=encodeURIComponent,token=value=>new URL(sanitizeEvidenceHttpUrl(`https://www.novartis.com.cn/?order=${encoded(value)}`)).searchParams.get('order');
 const result=JSON.parse(JSON.stringify(evidence).replaceAll(encoded(token('发布日期')),encoded(token(order))).replaceAll(encoded('发布日期'),encoded(order)));
 result.captureTool.version=version;
 for(const page of result.pages){const artifact=result.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey);page.responseFingerprintSha256=sha256Bytes(Buffer.from(artifact.body)).sha256;}
 return result;
}
