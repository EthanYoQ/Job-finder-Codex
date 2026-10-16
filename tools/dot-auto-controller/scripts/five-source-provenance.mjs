/** Strict new fifth-source host layer over the complete sealed e478 integration. Source-only. */
import {createHash} from 'node:crypto';
import {fourSourceProvenance} from './four-source-provenance.mjs';
export const FIVE_BASE_COMMIT="e47896671e3b5bb100ac41f5211bb805be7818dc";
export const FIVE_DERIVATIVE_CLASS='FIVE_SOURCE_SEQUENCE_SOURCE_DERIVATIVE';
export const FIVE_SOURCE_PATHS=Object.freeze(["ops/cloud-pilot-host/connector-host-binding.mjs", "ops/cloud-pilot-host/connector-host-launch.py"]);
export const FIVE_EXPECTED=Object.freeze(Object.fromEntries(Object.entries({"ops/cloud-pilot-host/connector-host-binding.mjs":{"path":"ops/cloud-pilot-host/connector-host-binding.mjs","classification":"FIVE_SOURCE_SEQUENCE_SOURCE_DERIVATIVE","originCommit":null,"sourceStatus":"LOCAL_UNREGISTERED","productionQualified":false,"derivativeBaseCommit":"e47896671e3b5bb100ac41f5211bb805be7818dc","derivativeBaseSha256":"b5b75d6fe4f7dc513365f0107c8eb13d0f74f2bf28de61e174acab7531c46639","priorProvenanceSha256":"adef908e92a9cee6dddcc7a91c0f39ccd4e289f38e5d0aee979222fae92d3997","sha256":"3631d591f1118b207666c45c66a76e56513167e9ec44cd55e122b107291f3e88","bytes":12194},"ops/cloud-pilot-host/connector-host-launch.py":{"path":"ops/cloud-pilot-host/connector-host-launch.py","classification":"FIVE_SOURCE_SEQUENCE_SOURCE_DERIVATIVE","originCommit":null,"sourceStatus":"LOCAL_UNREGISTERED","productionQualified":false,"derivativeBaseCommit":"e47896671e3b5bb100ac41f5211bb805be7818dc","derivativeBaseSha256":"0ee2accb36315f6b7614563c36e1cd79a8c8f319a2583cbfb70530ca268c2323","priorProvenanceSha256":"83a9847e4653ab5d5a65fb53d24f0de0e8b149761b4a5f9c214c29cde8d0c445","sha256":"a71a1a465e73bc968c3a0e633784135e21c7d0f099186a3b6baed48cbce14145","bytes":4572}}).map(([path,value])=>[path,Object.freeze(value)])));
const sha=b=>createHash('sha256').update(b).digest('hex');
export function fiveSourceProvenance(file){
 if(file.classification!==FIVE_DERIVATIVE_CLASS)return null;
 const expected=FIVE_EXPECTED[file.path];if(!expected)throw Error('FIVE_SOURCE_FOREIGN_PATH');
 const allowed=[...Object.keys(expected),'priorProvenance'];
 if(Object.keys(file).length!==allowed.length||Object.keys(file).some(k=>!allowed.includes(k)))throw Error('FIVE_SOURCE_EXACT_KEYS');
 for(const [key,value] of Object.entries(expected))if(file[key]!==value)throw Error('FIVE_SOURCE_EXACT_'+key);
 if(sha(JSON.stringify(file.priorProvenance))!==file.priorProvenanceSha256||file.priorProvenance?.path!==file.path||file.priorProvenance.sha256!==file.derivativeBaseSha256||!fourSourceProvenance(file.priorProvenance))throw Error('FIVE_SOURCE_EXACT_E478_ANCESTRY');
 return {kind:'five-source-sequence-source-derivative',...file,newBuildQualificationRequired:true};
}

export const FIVE_BASE_MANIFEST_SHA256="2447f5a804c4ae1c6ea7c82da40c1bf1b648cf69d878e59213341eef1f069f9c";
/** Refresh validates the complete current/base sets and bytes before returning a new document. */
export function refreshFiveSourceManifest({baseManifest,currentManifest,readSource}){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=code=>{throw Error('FIVE_SOURCE_REFRESH_'+code);};
 if(sha(JSON.stringify(baseManifest))!==FIVE_BASE_MANIFEST_SHA256)fail('EXACT_BASE_MANIFEST');
 if(!currentManifest||!Array.isArray(currentManifest.files))fail('CURRENT_MANIFEST');
 const {files:currentFiles,...currentMeta}=currentManifest,{files:baseFiles,...baseMeta}=baseManifest;
 if(!same(currentMeta,baseMeta)||!same(currentFiles.map(f=>f.path),baseFiles.map(f=>f.path))||new Set(currentFiles.map(f=>f.path)).size!==baseFiles.length)fail('FULL_CLOSED_SET');
 const files=currentFiles.map((record,index)=>{
  const prior=baseFiles[index],bytes=readSource(record.path);
  if(!FIVE_SOURCE_PATHS.includes(record.path)){
   if(!same(record,prior)||sha(bytes)!==prior.sha256||bytes.length!==prior.bytes)fail('UNRELATED_RECORD_OR_BYTES');return structuredClone(record);
  }
  if(!same(record,prior)){if(!fiveSourceProvenance(record)||!same(record.priorProvenance,prior))fail('CURRENT_HOST_RECORD');}
  const next={...FIVE_EXPECTED[record.path],priorProvenance:structuredClone(prior)};fiveSourceProvenance(next);
  if(sha(bytes)!==next.sha256||bytes.length!==next.bytes)fail('HOST_CURRENT_BYTES');return next;
 });
 const result={...structuredClone(baseMeta),files},restored={...result,files:files.map(f=>FIVE_SOURCE_PATHS.includes(f.path)?f.priorProvenance:f)};
 if(!same(restored,baseManifest))fail('FULL_PRIOR_RESTORE');return result;
}
