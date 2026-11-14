import type { PrismaClient } from "@prisma/client";
import { NOVARTIS_UNRESOLVED_DISCOVERY_LOCATOR } from "../runner-candidate/src/crawler/novartisNativePartitions";
import { dailySlotMs } from "./frequency.mjs";

/** Coverage always uses the full catalog, even when this invocation retries a subset. */
export async function readRoundCoverage(db:Pick<PrismaClient,"crawlBatchSourceResult">,candidateId:string,slot:string|null,
  sourceIds:readonly string[],results:readonly {status:string;failedSourceCount?:number;blockedSourceCount?:number}[]) {
  const accepted=slot?await db.crawlBatchSourceResult.findMany({where:{
    releaseCandidateId:candidateId,sourceId:{in:[...sourceIds]},
    atomicCommitState:"COMMITTED",completenessState:"VERIFIED",
    finishedAt:{gte:new Date(Number(slot)),lt:new Date(Number(slot)+dailySlotMs)},
    batch:{is:{kind:"SCHEDULED",ownerId:"direct-scheduler"}}
  },select:{sourceId:true,batchId:true,_count:{select:{
    lossLedgerEntries:{where:{details:{path:['code'],equals:'JOB_QUARANTINED'}}},
    evidenceArtifacts:{where:{extractorLocator:NOVARTIS_UNRESOLVED_DISCOVERY_LOCATOR}}
  }}},orderBy:{finishedAt:"asc"}}):[];
  const captured=new Map(accepted.map(row=>[row.sourceId,row]));
  const complete=sourceIds.every(id=>captured.has(id))&&results.every(row=>row.status!=="FAILED"&&
    (!("failedSourceCount" in row)||row.failedSourceCount===0&&row.blockedSourceCount===0));
  const quarantinedJobCount=[...captured.values()].reduce((sum,row)=>sum+row._count.lossLedgerEntries,0);
  const unresolvedCoverage=[...captured.values()].some(row=>row._count.evidenceArtifacts>0);
  return {complete,quarantinedJobCount,unresolvedCoverage,capturedSources:[...captured.values()].map(({sourceId,batchId})=>({sourceId,batchId}))};
}
