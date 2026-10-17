import {NOVO_CLOSURE_SOURCE,verifyNovoSingleClosure,novoClosureDetailsSchema,type NovoClosureDetails,type NovoClosureRecord,type NovoClosureArtifact} from "../domain/novoSingleJobClosure";
export interface NovoSingleClosureDb {
  lossLedgerEntry?:{findMany(args:unknown):PromiseLike<unknown[]>};
  evidenceArtifact?:{findMany(args:unknown):PromiseLike<unknown[]>};
}
/** No source selection, baseline, Job update or freshness authority is granted here. */
export async function readNovoSingleClosures(db:NovoSingleClosureDb,now:Date):Promise<NovoClosureDetails[]>{
  if(!db.lossLedgerEntry)return [];
  const records=await db.lossLedgerEntry.findMany({where:{sourceId:NOVO_CLOSURE_SOURCE,rawLocator:{startsWith:"novo-single-job-"},
    sourceResult:{is:{batch:{is:{kind:"JOB_VERIFICATION"}}}}},select:{releaseCandidateId:true,batchId:true,sourceId:true,sourceResultId:true,
    stage:true,reason:true,rawLocator:true,recordedAt:true,details:true,sourceResult:{select:{id:true,releaseCandidateId:true,batchId:true,sourceId:true,
      transportState:true,adapterState:true,completenessState:true,atomicCommitState:true,startedAt:true,finishedAt:true,
      completenessCertificate:true,completenessCertificateSha256:true,blockerCode:true,failureCode:true,failureReason:true,
      rawCount:true,parsedCount:true,validCount:true,dedupeOutputCount:true,validationDiscardCount:true,
      batch:{select:{id:true,kind:true,status:true}}}}}});
  if(!Array.isArray(records))throw Error("NOVO_SINGLE_CLOSURE_RECORD_SET_INVALID");
  if(records.length===0)return [];
  if(!db.evidenceArtifact)throw Error("NOVO_SINGLE_CLOSURE_ARTIFACTS_REQUIRED");
  const rows=records as NovoClosureRecord[];
  const details=rows.map(row=>novoClosureDetailsSchema.parse(row.details));
  const artifacts=await db.evidenceArtifact.findMany({where:{OR:[{sourceResultId:{in:rows.map(row=>row.sourceResultId)}},{id:{in:details.map(d=>d.previousApplicationArtifactId)}}]},
    select:{id:true,releaseCandidateId:true,batchId:true,sourceId:true,sourceResultId:true,kind:true,requestedUrl:true,finalUrl:true,httpStatus:true,
      contentType:true,capturedAt:true,sha256:true,extractorLocator:true}});
  if(!Array.isArray(artifacts))throw Error("NOVO_SINGLE_CLOSURE_ARTIFACTS_REQUIRED");
  return rows.map(record=>verifyNovoSingleClosure(record,artifacts as NovoClosureArtifact[],now));
}
