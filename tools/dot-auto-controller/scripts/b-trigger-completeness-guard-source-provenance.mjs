/** Exact local f7c011 ancestry for the single B-trigger completeness guard change. */
import {createHash} from 'node:crypto';

export const B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT='f7c0118b5c7acb165c267430216af33a1ea9809b';
export const B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS='B_TRIGGER_COMPLETENESS_GUARD_SOURCE_DERIVATIVE';
export const B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS=Object.freeze([
 'src/db/ingestionRepository.ts',
]);
export const B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES=Object.freeze({
 'src/db/ingestionRepository.ts':'eb86ba50cf06e37ecdede78f80b22fb4e3048df06103ea1cb288d5e24089f640',
});
export const B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES=Object.freeze({
 'src/db/ingestionRepository.ts':'ab2cf7577293a13af2e6e4c7657b0ba0035d3a2630574811ba79f427062d36df',
});
const baseManifestHash='765e84b115f9cd01b8bb60f9bb4f4e410a486cc69374795d9ad861784bd1f25b';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function bTriggerCompletenessGuardSourceProvenance(source){
 if(source.classification!==B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS)return null;
 if(source.originCommit!==null||source.originSha256!==undefined||source.ancestorOriginCommit!==undefined||source.productionQualified!==false)throw Error('B_TRIGGER_COMPLETENESS_GUARD_SOURCE_LOCAL_ONLY:'+source.path);
 if(!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT||source.derivativeBaseSha256!==B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||source.priorProvenanceSha256!==B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[source.path]||digest(JSON.stringify(source.priorProvenance))!==source.priorProvenanceSha256)throw Error('B_TRIGGER_COMPLETENESS_GUARD_EXACT_F7C011_ANCESTRY:'+source.path);
 if(!/^[a-f0-9]{64}$/.test(source.sha256)||source.sha256===source.derivativeBaseSha256||!Number.isSafeInteger(source.bytes)||source.bytes<=0)throw Error('B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_BYTES_REQUIRED:'+source.path);
 return {kind:'b-trigger-completeness-guard-source-derivative',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenanceSha256:source.priorProvenanceSha256,priorProvenance:source.priorProvenance,productionQualified:false,newBuildQualificationRequired:true};
}

/** Exactly one record may change; all other records, bytes and metadata stay exact. */
export function refreshBTriggerCompletenessGuardSourceManifest({baseManifest,currentManifest,readSource}){
 if(digest(JSON.stringify(baseManifest))!==baseManifestHash)throw Error('B_TRIGGER_COMPLETENESS_GUARD_EXACT_BASE_MANIFEST_REQUIRED');
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('B_TRIGGER_COMPLETENESS_GUARD_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('B_TRIGGER_COMPLETENESS_GUARD_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path))throw Error('B_TRIGGER_COMPLETENESS_GUARD_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('B_TRIGGER_COMPLETENESS_GUARD_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('B_TRIGGER_COMPLETENESS_GUARD_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('B_TRIGGER_COMPLETENESS_GUARD_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(current.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS){
   bTriggerCompletenessGuardSourceProvenance(current);
   if(!same(current.priorProvenance,base))throw Error('B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_CHANGED:'+base.path);
  }else if(!same(current,base))throw Error('B_TRIGGER_COMPLETENESS_GUARD_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS,originCommit:null,productionQualified:false,derivativeBaseCommit:B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenanceSha256:B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[base.path],priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 return {...structuredClone(baseManifest),files};
}
