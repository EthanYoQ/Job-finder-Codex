import type { PrismaClient } from "@prisma/client";

/** Coverage always uses the full catalog, even when this invocation retries a subset. */
export async function readRoundCoverage(db:Pick<PrismaClient,"crawlBatchSourceResult">,candidateId:string,slot:string|null,
  sourceIds:readonly string[],results:readonly {status:string;failedSourceCount?:number;blockedSourceCount?:number}[]) {
  const accepted=slot?await db.crawlBatchSourceResult.findMany({where:{
    releaseCandidateId:candidateId,sourceId:{in:[...sourceIds]},
    atomicCommitState:"COMMITTED",completenessState:"VERIFIED",
    finishedAt:{gte:new Date(Number(slot)),lt:new Date(Number(slot)+12*3600_000)},
    batch:{is:{kind:"SCHEDULED",ownerId:"direct-scheduler"}}
  },select:{sourceId:true,batchId:true},orderBy:{finishedAt:"asc"}}):[];
  const captured=new Map(accepted.map(row=>[row.sourceId,row.batchId]));
  const complete=sourceIds.every(id=>captured.has(id))&&results.every(row=>row.status!=="FAILED"&&
    (!("failedSourceCount" in row)||row.failedSourceCount===0&&row.blockedSourceCount===0));
  return {complete,capturedSources:[...captured].map(([sourceId,batchId])=>({sourceId,batchId}))};
}
