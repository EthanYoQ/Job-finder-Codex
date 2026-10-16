/** Exact local 48e ancestry for the Ucb bridge. This is not live qualification. */
import {createHash} from 'node:crypto';

export const UCB_BASE_COMMIT='48e56500bfe6a77ed712abfd54a98154cf963032';
export const UCB_DERIVATIVE_CLASS='UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE';
export const UCB_NEW_SOURCE_CLASS='UCB_OWNED_BRIDGE_NEW_SOURCE';
export const UCB_SHARED_SOURCE_PATHS=Object.freeze([
 'scripts/p0-cloud-portable-source-pilot.ts',
 'src/crawler/cloudDbStartedPilot.ts',
 'src/crawler/cloudSourcePilotRelay.ts',
]);
export const UCB_NEW_SOURCE_PATH='src/crawler/ucbFixedJobProjectionSidecar.ts';
export const UCB_BASE_HASHES=Object.freeze({
  "scripts/p0-cloud-portable-source-pilot.ts": "93b7c38704df5d3270190c2f13d6c29071379c06443172e76cd52f9911713efb",
  "src/crawler/cloudDbStartedPilot.ts": "6dcfa1c504bb1d8bcd7ece80e1fa43010c42b877bcd9f11bc44df2ee73b7281b",
  "src/crawler/cloudSourcePilotRelay.ts": "821e7b687e304f78273d191027a51ad5e020e361d592bec01ad14d12e896c4ce"
});
const baseProvenanceHashes=Object.freeze({
  "scripts/p0-cloud-portable-source-pilot.ts": "ffe8092a35c1db6f425b7a388d14c002fd4d29dcea11fb3dc2ffaa9571eab99c",
  "src/crawler/cloudDbStartedPilot.ts": "eb1cc0f3b693a37419317143e55b83dde61ff0eefe7a93efb4f7b2c6dbf6d7c9",
  "src/crawler/cloudSourcePilotRelay.ts": "7528ff30d3356305820d4db7b263b04d6d231415bd8a91cadce308a358c945e0"
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function ucbSourceProvenance(source){
 if(![UCB_DERIVATIVE_CLASS,UCB_NEW_SOURCE_CLASS].includes(source.classification))return null;
 if(source.originCommit!==null||source.originSha256!==undefined||source.ancestorOriginCommit!==undefined||source.productionQualified!==false)throw Error('UCB_SOURCE_LOCAL_ONLY:'+source.path);
 const derivative=source.classification===UCB_DERIVATIVE_CLASS;
 if(derivative){
  if(!UCB_SHARED_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==UCB_BASE_COMMIT||source.derivativeBaseSha256!==UCB_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||digest(JSON.stringify(source.priorProvenance))!==baseProvenanceHashes[source.path])throw Error('UCB_SOURCE_48E_BASE_REQUIRED:'+source.path);
 }else if(source.path!==UCB_NEW_SOURCE_PATH||source.derivativeBaseCommit!==undefined||source.derivativeBaseSha256!==undefined||source.priorProvenance!==undefined)throw Error('UCB_NEW_SOURCE_HAS_NO_ANCESTOR:'+source.path);
 return {kind:derivative?'ucb-owned-bridge-source-derivative':'new-ucb-owned-bridge-source',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',...(derivative?{derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenance:source.priorProvenance}:{}),productionQualified:false,newBuildQualificationRequired:true};
}

/** Only these four records may change. Unrelated metadata and hashes are immutable. */
export function refreshUcbSourceManifest({baseManifest,currentManifest,readSource}){
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 if(baseByPath.size!==baseManifest.files.length||baseByPath.has(UCB_NEW_SOURCE_PATH))throw Error('UCB_BASE_MANIFEST_INVALID');
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('UCB_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('UCB_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path)&&source.path!==UCB_NEW_SOURCE_PATH)throw Error('UCB_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('UCB_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!UCB_SHARED_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('UCB_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('UCB_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(base.sha256!==UCB_BASE_HASHES[base.path])throw Error('UCB_EXACT_48E_BASE_REQUIRED:'+base.path);
  if(current.classification===UCB_DERIVATIVE_CLASS){ucbSourceProvenance(current);if(!same(current.priorProvenance,base))throw Error('UCB_PRIOR_PROVENANCE_CHANGED:'+base.path);}
  else if(!same(current,base))throw Error('UCB_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('UCB_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:UCB_DERIVATIVE_CLASS,originCommit:null,productionQualified:false,derivativeBaseCommit:UCB_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 if(currentByPath.has(UCB_NEW_SOURCE_PATH))ucbSourceProvenance(currentByPath.get(UCB_NEW_SOURCE_PATH));
 const bytes=readSource(UCB_NEW_SOURCE_PATH);
 files.push({path:UCB_NEW_SOURCE_PATH,classification:UCB_NEW_SOURCE_CLASS,originCommit:null,productionQualified:false,sha256:digest(bytes),bytes:bytes.length});
 return {...structuredClone(baseManifest),files};
}
