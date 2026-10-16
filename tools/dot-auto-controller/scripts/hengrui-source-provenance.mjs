/** Exact local c53 ancestry for the Hengrui bridge. This is not live qualification. */
import {createHash} from 'node:crypto';

export const HENGRUI_BASE_COMMIT='c53de6e43569febc515c445ca74292eac355f569';
export const HENGRUI_DERIVATIVE_CLASS='HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE';
export const HENGRUI_NEW_SOURCE_CLASS='HENGRUI_OWNED_BRIDGE_NEW_SOURCE';
export const HENGRUI_SHARED_SOURCE_PATHS=Object.freeze([
 'scripts/p0-cloud-portable-source-pilot.ts',
 'src/crawler/cloudDbStartedPilot.ts',
 'src/crawler/cloudSourcePilotRelay.ts',
]);
export const HENGRUI_NEW_SOURCE_PATH='src/crawler/hengruiFixedJobProjectionSidecar.ts';
export const HENGRUI_BASE_HASHES=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'0d1cb9a6181cbfd230202d05cb78191845e7629d75f8a5b876ae38e1d2a0dfef',
 'src/crawler/cloudDbStartedPilot.ts':'8440d0b5e08203aecca5e9c4e9aead822ea7b242e1cec11f7eae4cdd70a2ebc1',
 'src/crawler/cloudSourcePilotRelay.ts':'f9d94fec7d2f5b12229802d32445045a6701715aaba9910172dc8090863abe6f',
});
const baseProvenanceHashes=Object.freeze({
 'scripts/p0-cloud-portable-source-pilot.ts':'8fc297cdc3487ad8a3767514d19330fbbfcf377843644518b2aff9c5be8e9db4',
 'src/crawler/cloudDbStartedPilot.ts':'c95748a2427b0b7ab5d4f1237842baac663b179138186b02ce4a0615ac2ddc8f',
 'src/crawler/cloudSourcePilotRelay.ts':'2b59b6739d54822507be139c358934745b9e9c54fd28d77e8ca361274eba855c',
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function hengruiSourceProvenance(source){
 if(![HENGRUI_DERIVATIVE_CLASS,HENGRUI_NEW_SOURCE_CLASS].includes(source.classification))return null;
 if(source.originCommit!==null||source.originSha256!==undefined||source.ancestorOriginCommit!==undefined||source.productionQualified!==false)throw Error('HENGRUI_SOURCE_LOCAL_ONLY:'+source.path);
 const derivative=source.classification===HENGRUI_DERIVATIVE_CLASS;
 if(derivative){
  if(!HENGRUI_SHARED_SOURCE_PATHS.includes(source.path)||source.derivativeBaseCommit!==HENGRUI_BASE_COMMIT||source.derivativeBaseSha256!==HENGRUI_BASE_HASHES[source.path]||source.priorProvenance?.path!==source.path||source.priorProvenance?.sha256!==source.derivativeBaseSha256||digest(JSON.stringify(source.priorProvenance))!==baseProvenanceHashes[source.path])throw Error('HENGRUI_SOURCE_C53_BASE_REQUIRED:'+source.path);
 }else if(source.path!==HENGRUI_NEW_SOURCE_PATH||source.derivativeBaseCommit!==undefined||source.derivativeBaseSha256!==undefined||source.priorProvenance!==undefined)throw Error('HENGRUI_NEW_SOURCE_HAS_NO_ANCESTOR:'+source.path);
 return {kind:derivative?'hengrui-owned-bridge-source-derivative':'new-hengrui-owned-bridge-source',originCommit:null,path:source.path,sourceStatus:'LOCAL_UNREGISTERED',...(derivative?{derivativeBaseCommit:source.derivativeBaseCommit,derivativeBaseSha256:source.derivativeBaseSha256,priorProvenance:source.priorProvenance}:{}),productionQualified:false,newBuildQualificationRequired:true};
}

/** Only these four records may change. Unrelated metadata and hashes are immutable. */
export function refreshHengruiSourceManifest({baseManifest,currentManifest,readSource}){
 const baseByPath=new Map(baseManifest.files.map(file=>[file.path,file]));
 if(baseByPath.size!==baseManifest.files.length||baseByPath.has(HENGRUI_NEW_SOURCE_PATH))throw Error('HENGRUI_BASE_MANIFEST_INVALID');
 const currentByPath=new Map(currentManifest.files.map(file=>[file.path,file]));
 if(currentByPath.size!==currentManifest.files.length)throw Error('HENGRUI_DUPLICATE_SOURCE_ENTRY');
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 if(!same(metadata(currentManifest),metadata(baseManifest)))throw Error('HENGRUI_UNRELATED_MANIFEST_METADATA_CHANGED');
 for(const source of currentManifest.files)if(!baseByPath.has(source.path)&&source.path!==HENGRUI_NEW_SOURCE_PATH)throw Error('HENGRUI_UNRELATED_NEW_SOURCE_ENTRY:'+source.path);
 const files=baseManifest.files.map(base=>{
  const current=currentByPath.get(base.path);
  if(!current)throw Error('HENGRUI_EXISTING_SOURCE_ENTRY_REMOVED:'+base.path);
  const bytes=readSource(base.path),sha256=digest(bytes);
  if(!HENGRUI_SHARED_SOURCE_PATHS.includes(base.path)){
   if(!same(current,base))throw Error('HENGRUI_UNRELATED_PROVENANCE_CHANGED:'+base.path);
   if(sha256!==base.sha256||bytes.length!==base.bytes)throw Error('HENGRUI_UNRELATED_SOURCE_CHANGED:'+base.path);
   return structuredClone(base);
  }
  if(base.sha256!==HENGRUI_BASE_HASHES[base.path])throw Error('HENGRUI_EXACT_C53_BASE_REQUIRED:'+base.path);
  if(current.classification===HENGRUI_DERIVATIVE_CLASS){hengruiSourceProvenance(current);if(!same(current.priorProvenance,base))throw Error('HENGRUI_PRIOR_PROVENANCE_CHANGED:'+base.path);}
  else if(!same(current,base))throw Error('HENGRUI_UNREVIEWED_SOURCE_PROVENANCE:'+base.path);
  if(sha256===base.sha256)throw Error('HENGRUI_DERIVATIVE_MUST_CHANGE_BYTES:'+base.path);
  return {path:base.path,classification:HENGRUI_DERIVATIVE_CLASS,originCommit:null,productionQualified:false,derivativeBaseCommit:HENGRUI_BASE_COMMIT,derivativeBaseSha256:base.sha256,priorProvenance:structuredClone(base),sha256,bytes:bytes.length};
 });
 if(currentByPath.has(HENGRUI_NEW_SOURCE_PATH))hengruiSourceProvenance(currentByPath.get(HENGRUI_NEW_SOURCE_PATH));
 const bytes=readSource(HENGRUI_NEW_SOURCE_PATH);
 files.push({path:HENGRUI_NEW_SOURCE_PATH,classification:HENGRUI_NEW_SOURCE_CLASS,originCommit:null,productionQualified:false,sha256:digest(bytes),bytes:bytes.length});
 return {...structuredClone(baseManifest),files};
}
