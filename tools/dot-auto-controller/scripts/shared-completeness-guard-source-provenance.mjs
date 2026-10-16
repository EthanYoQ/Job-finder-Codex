/** Exact local 962979 ancestry for the three shared completeness guard changes. */
import {createHash} from 'node:crypto';

export const SHARED_COMPLETENESS_GUARD_BASE_COMMIT='9629790860e68df0a8f09fb14f7ab05e1a2fbbfa';
export const SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS='SHARED_COMPLETENESS_GUARD_SOURCE_DERIVATIVE';
export const SHARED_COMPLETENESS_GUARD_SOURCE_PATHS=Object.freeze([
 'src/crawler/completenessAnomalyPolicy.ts',
 'src/crawler/runCrawlBatch.ts',
 'src/db/ingestionRepository.ts',
]);
export const SHARED_COMPLETENESS_GUARD_BASE_HASHES=Object.freeze({
 'src/crawler/completenessAnomalyPolicy.ts':'ca58a779b0d4f673f8a76657e17db0d71aef9a65533bdbe37128800e99909ff7',
 'src/crawler/runCrawlBatch.ts':'eea47ce762ae619a25c372d35cfaee85c289ba53b506419d3cc572a43e6f401b',
 'src/db/ingestionRepository.ts':'4155b8e974cc8316ecd15f72203bb15b847169b5b40c6a353d1ad9192b9a6a6d',
});
export const SHARED_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES=Object.freeze({
 'src/crawler/completenessAnomalyPolicy.ts':'691324ade19ddc3e2c337be6ba3df68d0850e9d085a83e056409636deed4ee27',
 'src/crawler/runCrawlBatch.ts':'a4a59c3b86da20bb9d2e15994707f45ae2f75e13acdb90e66f8d618326371058',
 'src/db/ingestionRepository.ts':'be63ed1f198c2fed995091f51e315be399656f95f9ba8b880b61fc99c20d72ff',
});
const baseManifestHash='630f55f956e95b1bc6c39786d0397a4a72e874e4a568d29bf2ceb49161064a33';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function sharedCompletenessGuardSourceProvenance(source){
 if(source.classification!==SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS)return null;
 if(source.originCommit!==null||source.originSha256!==undefined||source.ancestorOriginCommit!==undefined||source.productionQualified!==false)throw Error('SHARED_COMPLETENESS_GUARD_SOURCE_LOCAL_ONLY:'+source.path);
 if(!SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==SHARED_COMPLETENESS_GUARD_BASE_COMMIT||source.derivativeBaseSha256!==SHARED_COMPLETENESS_GUARD_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||source.priorProvenanceSha256!==SHARED_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[source.path]||digest(JSON.stringify(source.priorProvenance))!==source.priorProvenanceSha256)throw Error('SHARED_COMPLETENESS_GUARD_EXACT_962979_ANCESTRY:'+source.path);
 if(!/^[a-f0-9]{64}$/.test(source.sha256)||source.sha256===source.derivativeBaseSha256||!Number.isSafeInteger(source.bytes)||source.bytes<=0)throw Error('SHARED_COMPLETENESS_GUARD_DERIVATIVE_BYTES_REQUIRED:'+source.path);
 return {kind:'shared-completeness-guard-source-derivative',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenanceSha256:source.priorProvenanceSha256,priorProvenance:source.priorProvenance,productionQualified:false,newBuildQualificationRequired:true};
}

/** Exactly three records may change; all other records, bytes and metadata stay exact. */
export function refreshSharedCompletenessGuardSourceManifest({baseManifest,currentManifest,readSource}){
 if(digest(JSON.stringify(baseManifest))!==baseManifestHash)throw Error('SHARED_COMPLETENESS_GUARD_EXACT_BASE_MANIFEST_REQUIRED');
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('SHARED_COMPLETENESS_GUARD_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('SHARED_COMPLETENESS_GUARD_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path))throw Error('SHARED_COMPLETENESS_GUARD_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('SHARED_COMPLETENESS_GUARD_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('SHARED_COMPLETENESS_GUARD_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('SHARED_COMPLETENESS_GUARD_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(current.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS){
   sharedCompletenessGuardSourceProvenance(current);
   if(!same(current.priorProvenance,base))throw Error('SHARED_COMPLETENESS_GUARD_PRIOR_PROVENANCE_CHANGED:'+base.path);
  }else if(!same(current,base))throw Error('SHARED_COMPLETENESS_GUARD_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('SHARED_COMPLETENESS_GUARD_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,originCommit:null,productionQualified:false,derivativeBaseCommit:SHARED_COMPLETENESS_GUARD_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenanceSha256:SHARED_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[base.path],priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 return {...structuredClone(baseManifest),files};
}
