import {createHash} from 'node:crypto';
import {auditPublicHtml} from './audit-qilu-public-archive.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error('NOVO_PUBLIC_ARCHIVE_AUDIT:'+code);};
/** Privacy/retention only. Source scope and application validity are replayed by the owned issuer. */
export function auditNovoPublicArchive(bundle,{expected,sourceConfigSha256}){
 if(expected.sourceId!=='source-novo-nordisk-china-social'||sourceConfigSha256!=='40305820c3aa3f36e74f06873c0ddd1a52266cb74d277b3a36137c81fc5c604e'||bundle.schemaVersion!==1)fail('SOURCE');
 const side=bundle.sidecar;
 for(const key of ['releaseCandidateId','batchId','sourceId','sourceResultId','evidenceSubdirectory'])if(side[key]!==expected[key])fail('TUPLE');
 if(!Array.isArray(side.artifacts)||!Array.isArray(bundle.files)||side.artifacts.length!==bundle.files.length)fail('FILE_SET');
 const artifacts=new Map(side.artifacts.map(a=>[a.path,a]));if(artifacts.size!==bundle.files.length)fail('DUPLICATE');
 let bodyBytes=0;const seen=new Set();
 for(const file of bundle.files){
  const a=artifacts.get(file.path);if(!a||seen.has(file.path))fail('FILE_SET');seen.add(file.path);
  for(const key of ['releaseCandidateId','batchId','sourceId','sourceResultId'])if(a[key]!==side[key])fail('TUPLE');
  if((a.bodyRepresentation!==undefined&&a.bodyRepresentation!=='EXACT')||a.redactionCommitmentSha256!==undefined||a.httpStatus!==200||!['ATS_API_RESPONSE','OFFICIAL_COMPANY_PAGE'].includes(a.kind))fail('PUBLIC_RESPONSE');
  for(const value of [a.requestedUrl,a.finalUrl]){
   const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['www.novonordisk.com.cn','career2.successfactors.eu','careers.novonordisk.com'].includes(u.hostname))fail('PUBLIC_ORIGIN');
  }
  const bytes=Buffer.concat(file.chunks.map(c=>Buffer.from(c,'base64')));
  if(bytes.length!==file.byteCount||bytes.length!==a.byteCount||sha(bytes)!==file.sha256||file.sha256!==a.sha256)fail('BODY_HASH');
  bodyBytes+=bytes.length;
  if(a.logicalKey==='official-json-page-0000'){
   const data=JSON.parse(bytes.toString('utf8'));
   if(JSON.stringify(Object.keys(data).sort())!==JSON.stringify(['data','message','status']))fail('JSON_ENVELOPE');
   const allowed=['executionTimeMs','totalMatches','keywordParam','localeParam','countriesParam','categoriesParam','subCategories','states','cities','jobs'];
   if(Object.keys(data.data).some(k=>!allowed.includes(k)))fail('JSON_FIELDS');
   const rowKeys=['jobId','jobTitle','jobLocale','jobLocationLabel','jobCountry','jobCategory','jobSubCategory','jobState','jobCity'];
   if(!Array.isArray(data.data.jobs)||data.data.jobs.some(j=>Object.keys(j).some(k=>!rowKeys.includes(k))))fail('JSON_ROW_FIELDS');
  }else if(a.logicalKey==='novo-native-entry'||/^novo-(?:detail|application)-\d{6}\.en_GB$/.test(a.logicalKey))auditPublicHtml(bytes,null);
  else fail('UNEXPECTED_BODY');
 }
 return {status:'PASS',artifactCount:seen.size,bodyBytes,htmlPrivacyScreened:true,originalBodyHashesRetained:true};
}
