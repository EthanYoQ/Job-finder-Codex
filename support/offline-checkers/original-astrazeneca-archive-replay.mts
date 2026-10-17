import assert from 'node:assert/strict';
// Restore the original owned envelope; runSourceCrawl and the A issuer replay every native detail.
export async function restoreOriginalAstraZeneca(V:string,saved:any,sidecar:any,bodies:Map<string,Buffer>){
 const {parsePersistentSourceFetchEvidence}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
 const {assertVerifiedArchivedEvidenceMetadata}=await import(V+'/src/crawler/artifactArchive.ts');
 const {bindRuntimeEvidenceArtifactIds}=await import(V+'/src/crawler/runtimeAtomicEvidence.ts');
 assert(saved.evidence.astraZenecaDetails,'ASTRAZENECA_ORIGINAL_ENVELOPE_MISSING');
 assert.equal(sidecar.sourceId,'source-astrazeneca-social');
 assert.equal(saved.evidence.artifacts.length,sidecar.artifacts.length,'ASTRAZENECA_ARCHIVE_SET');
 const evidence=parsePersistentSourceFetchEvidence({...saved.evidence,artifacts:saved.evidence.artifacts.map(({binary,...artifact}:any)=>{
  const matches=sidecar.artifacts.filter((a:any)=>a.logicalKey===artifact.logicalKey);assert.equal(matches.length,1,'ASTRAZENECA_ARCHIVE_IDENTITY');
  const bytes=bodies.get(matches[0].path);assert(bytes,'ASTRAZENECA_RAW_MISSING');
  return {...artifact,body:binary?bytes:bytes.toString('utf8')};
 })});
 assertVerifiedArchivedEvidenceMetadata({...sidecar,artifacts:sidecar.artifacts.map((a:any)=>({...a,capturedAt:new Date(a.capturedAt)}))},bindRuntimeEvidenceArtifactIds({...sidecar,artifacts:evidence.artifacts}));
 const list=evidence.artifacts.find((a:any)=>a.logicalKey===evidence.astraZenecaDetails!.listArtifactLogicalKeys[0]);
 assert(list&&typeof list.body==='string','ASTRAZENECA_LIST_BODY');
 return {ok:true,capturedAt:saved.capturedAt,html:list.body,fetchEvidence:evidence,paginationEvaluation:saved.paginationEvaluation};
}
