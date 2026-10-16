/** Exact local a889c0 ancestry for the single legacy completeness guard change. */
import {createHash} from 'node:crypto';

export const LEGACY_COMPLETENESS_GUARD_BASE_COMMIT='a889c044d70edce569bf12e6971bcc7b64b0bcd3';
export const LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS='LEGACY_COMPLETENESS_GUARD_SOURCE_DERIVATIVE';
export const LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS=Object.freeze([
 'scripts/p0-cloud-portable-source-pilot.ts',
]);
export const LEGACY_COMPLETENESS_GUARD_BASE_HASHES=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'f0114fea872ebf53b66686ffbb041aabc5bdda8be650a72b153dc929536ee9dc',
});
export const LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'14483cc3c6077d10bc71d3b0d0857beb07ca5c580d5fd6e360987edeedd5dc25',
});
const baseManifestHash='15a306a6b4e2da3ca2e6ded5d5463da84add4f288fd4a48dc336dd76a701388a';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function legacyCompletenessGuardSourceProvenance(source){
 if(source.classification!==LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS)return null;
 if(source.originCommit!==null||source.originSha256!==undefined||source.ancestorOriginCommit!==undefined||source.productionQualified!==false)throw Error('LEGACY_COMPLETENESS_GUARD_SOURCE_LOCAL_ONLY:'+source.path);
 if(!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==LEGACY_COMPLETENESS_GUARD_BASE_COMMIT||source.derivativeBaseSha256!==LEGACY_COMPLETENESS_GUARD_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||source.priorProvenanceSha256!==LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[source.path]||digest(JSON.stringify(source.priorProvenance))!==source.priorProvenanceSha256)throw Error('LEGACY_COMPLETENESS_GUARD_EXACT_A889C0_ANCESTRY:'+source.path);
 if(!/^[a-f0-9]{64}$/.test(source.sha256)||source.sha256===source.derivativeBaseSha256||!Number.isSafeInteger(source.bytes)||source.bytes<=0)throw Error('LEGACY_COMPLETENESS_GUARD_DERIVATIVE_BYTES_REQUIRED:'+source.path);
 return {kind:'legacy-completeness-guard-source-derivative',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenanceSha256:source.priorProvenanceSha256,priorProvenance:source.priorProvenance,productionQualified:false,newBuildQualificationRequired:true};
}

/** Exactly one record may change; all other records, bytes and metadata stay exact. */
export function refreshLegacyCompletenessGuardSourceManifest({baseManifest,currentManifest,readSource}){
 if(digest(JSON.stringify(baseManifest))!==baseManifestHash)throw Error('LEGACY_COMPLETENESS_GUARD_EXACT_BASE_MANIFEST_REQUIRED');
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('LEGACY_COMPLETENESS_GUARD_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('LEGACY_COMPLETENESS_GUARD_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path))throw Error('LEGACY_COMPLETENESS_GUARD_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('LEGACY_COMPLETENESS_GUARD_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('LEGACY_COMPLETENESS_GUARD_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('LEGACY_COMPLETENESS_GUARD_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(current.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS){
   legacyCompletenessGuardSourceProvenance(current);
   if(!same(current.priorProvenance,base))throw Error('LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_CHANGED:'+base.path);
  }else if(!same(current,base))throw Error('LEGACY_COMPLETENESS_GUARD_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('LEGACY_COMPLETENESS_GUARD_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS,originCommit:null,productionQualified:false,derivativeBaseCommit:LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenanceSha256:LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[base.path],priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 return {...structuredClone(baseManifest),files};
}
