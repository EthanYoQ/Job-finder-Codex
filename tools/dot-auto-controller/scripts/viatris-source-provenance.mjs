/** Exact local 962979 ancestry for the Viatris owned bridge. Never live qualification. */
import {createHash} from 'node:crypto';

export const VIATRIS_BASE_COMMIT='9629790860e68df0a8f09fb14f7ab05e1a2fbbfa';
export const VIATRIS_DERIVATIVE_CLASS='VIATRIS_OWNED_BRIDGE_SOURCE_DERIVATIVE';
export const VIATRIS_NEW_SOURCE_CLASS='VIATRIS_OWNED_BRIDGE_NEW_SOURCE';
export const VIATRIS_SHARED_SOURCE_PATHS=Object.freeze([
 'scripts/p0-cloud-portable-source-pilot.ts',
 'src/crawler/cloudDbStartedPilot.ts',
 'src/crawler/cloudSourcePilotRelay.ts',
]);
export const VIATRIS_NEW_SOURCE_PATH='src/crawler/viatrisFixedJobProjectionSidecar.ts';
export const VIATRIS_BASE_HASHES=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'f0114fea872ebf53b66686ffbb041aabc5bdda8be650a72b153dc929536ee9dc',
 'src/crawler/cloudDbStartedPilot.ts':'5c7edc8ab5fd54b176c4e7396b8aa16e1f50d907c0dc2e4f3a1495d2b21e5dc7',
 'src/crawler/cloudSourcePilotRelay.ts':'d82d920b0e2ed59af7032427840f6f5d1c5b05adbd85450c5ef93ad5de821333',
});
const baseProvenanceHashes=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'14483cc3c6077d10bc71d3b0d0857beb07ca5c580d5fd6e360987edeedd5dc25',
 'src/crawler/cloudDbStartedPilot.ts':'ce01e5a27c05f2efe0268afaf17df7f358eda87bbf538bd1f3f995c7c4532206',
 'src/crawler/cloudSourcePilotRelay.ts':'ee7ca4fe6dcd6c37f6e54ec8facfcb84eed54f19c060e82c48349968c068c668',
});
const baseManifestHash='630f55f956e95b1bc6c39786d0397a4a72e874e4a568d29bf2ceb49161064a33';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const commonKeys=['path','classification','originCommit','sourceStatus','productionQualified','sha256','bytes'];

export function viatrisSourceProvenance(source){
 if(![VIATRIS_DERIVATIVE_CLASS,VIATRIS_NEW_SOURCE_CLASS].includes(source.classification))return null;
 const derivative=source.classification===VIATRIS_DERIVATIVE_CLASS;
 const allowedKeys=derivative?[...commonKeys,'derivativeBaseCommit','derivativeBaseSha256','priorProvenance']:commonKeys;
 if(source.originCommit!==null||source.sourceStatus!=='LOCAL_UNREGISTERED'||source.productionQualified!==false||Object.keys(source).some(key=>!allowedKeys.includes(key)))throw Error('VIATRIS_SOURCE_LOCAL_ONLY:'+source.path);
 if(!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<=0)throw Error('VIATRIS_SOURCE_BYTES_REQUIRED:'+source.path);
 if(derivative){
  if(!VIATRIS_SHARED_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==VIATRIS_BASE_COMMIT||source.derivativeBaseSha256!==VIATRIS_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||digest(JSON.stringify(source.priorProvenance))!==baseProvenanceHashes[source.path])throw Error('VIATRIS_SOURCE_EXACT_962979_BASE_REQUIRED:'+source.path);
  if(source.sha256===source.derivativeBaseSha256)throw Error('VIATRIS_DERIVATIVE_MUST_CHANGE_BYTES:'+source.path);
 }else if(source.path!==VIATRIS_NEW_SOURCE_PATH)throw Error('VIATRIS_NEW_SOURCE_HAS_NO_ANCESTOR:'+source.path);
 return {kind:derivative?'viatris-owned-bridge-source-derivative':'new-viatris-owned-bridge-source',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',...(derivative?{derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenance:source.priorProvenance}:{}),productionQualified:false,newBuildQualificationRequired:true};
}

/** Only three derivatives and one new sidecar may change, relative to exact 962979. */
export function refreshViatrisSourceManifest({baseManifest,currentManifest,readSource}){
 if(digest(JSON.stringify(baseManifest))!==baseManifestHash)throw Error('VIATRIS_EXACT_962979_MANIFEST_REQUIRED');
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 if(baseByPath.size!==baseManifest.files.length||baseByPath.has(VIATRIS_NEW_SOURCE_PATH))throw Error('VIATRIS_BASE_MANIFEST_INVALID');
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('VIATRIS_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('VIATRIS_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path)&&source.path!==VIATRIS_NEW_SOURCE_PATH)throw Error('VIATRIS_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('VIATRIS_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!VIATRIS_SHARED_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('VIATRIS_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('VIATRIS_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(base.sha256!==VIATRIS_BASE_HASHES[base.path]||digest(JSON.stringify(base))!==baseProvenanceHashes[base.path])throw Error('VIATRIS_EXACT_962979_BASE_REQUIRED:'+base.path);
  if(current.classification===VIATRIS_DERIVATIVE_CLASS){viatrisSourceProvenance(current);if(!same(current.priorProvenance,base))throw Error('VIATRIS_PRIOR_PROVENANCE_CHANGED:'+base.path);}
  else if(!same(current,base))throw Error('VIATRIS_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('VIATRIS_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:VIATRIS_DERIVATIVE_CLASS,originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,derivativeBaseCommit:VIATRIS_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 if(currentByPath.has(VIATRIS_NEW_SOURCE_PATH))viatrisSourceProvenance(currentByPath.get(VIATRIS_NEW_SOURCE_PATH));
 const bytes=readSource(VIATRIS_NEW_SOURCE_PATH);
 const added={path:VIATRIS_NEW_SOURCE_PATH,classification:VIATRIS_NEW_SOURCE_CLASS,originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,sha256:digest(bytes),bytes:bytes.length};
 viatrisSourceProvenance(added);files.push(added);
 return {...structuredClone(baseManifest),files};
}
