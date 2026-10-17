import assert from 'node:assert/strict';
export async function restoreOriginalAstellas(V:string,saved:any,archived:any[],bodies:Map<string,Buffer>){
 const {parsePersistentSourceFetchEvidence}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
 assert(saved.evidence.astellasPdfLocations,'ASTELLAS_ORIGINAL_ENVELOPE_MISSING');
 assert.equal(saved.evidence.artifacts.length,archived.length,'ASTELLAS_ARCHIVE_SET');
 const evidence=parsePersistentSourceFetchEvidence({...saved.evidence,artifacts:saved.evidence.artifacts.map(({binary,...artifact}:any)=>{
  const matches=archived.filter(a=>a.logicalKey===artifact.logicalKey);assert.equal(matches.length,1,'ASTELLAS_ARCHIVE_IDENTITY');
  const raw=matches[0];assert.equal(raw.capturedAt,artifact.capturedAt);assert.equal(raw.requestedUrl,artifact.requestedUrl);
  const bytes=bodies.get(raw.path);assert(bytes,'ASTELLAS_RAW_MISSING');
  return {...artifact,body:binary?bytes:bytes.toString('utf8')};
 })});
 const list=evidence.artifacts.find((a:any)=>a.logicalKey===evidence.astellasPdfLocations.listArtifactLogicalKey);
 assert(list&&typeof list.body==='string','ASTELLAS_LIST_BODY');
 return {ok:true,capturedAt:saved.capturedAt,html:list.body,fetchEvidence:evidence,paginationEvaluation:saved.paginationEvaluation};
}
