import type { PrismaClient } from "@prisma/client";
import { NOVARTIS_PARTITION_AUDIT_LOCATOR, NOVARTIS_PARTITION_CAPTURE, NOVARTIS_UNRESOLVED_DISCOVERY_LOCATOR } from "../runner-candidate/src/crawler/novartisNativePartitions";
import { dailySlotMs } from "./frequency.mjs";

const pendingLossCodes = [
  "ROCHE_DETAIL_DENIED", "NOVO_DETAIL_INSUFFICIENT", "SERVIER_WORKPLACE_COUNTRY_UNKNOWN",
  "KELUN_GEOGRAPHY_UNKNOWN", "MAINLAND_COUNTRY_UNRESOLVED", "BIOGEN_LIST_GEOGRAPHY_UNRESOLVED"
];

function isCatastrophicQuarantineCollapse(validCount: number | undefined, quarantinedJobCount: number): boolean {
  if (quarantinedJobCount <= 0) return false;
  if (validCount === 0) return true;
  if (validCount === undefined) return quarantinedJobCount >= 10;
  return quarantinedJobCount >= 10 && quarantinedJobCount * 4 > validCount + quarantinedJobCount;
}

/** The latest committed capture owns completion within a slot; later failed attempts do not erase it. */
export async function readSourceCompletion(db:Pick<PrismaClient,"crawlBatchSourceResult">,candidateId:string,slot:string|null,
  sourceIds:readonly string[],sourceConfigHashes?:ReadonlyMap<string,string>) {
  if(!slot||sourceIds.length===0)return [];
  const configuredSources=sourceConfigHashes?sourceIds.map(sourceId=>{
    const sourceConfigHash=sourceConfigHashes.get(sourceId);
    if(!sourceConfigHash)throw Error(`SOURCE_CONFIG_HASH_REQUIRED:${sourceId}`);
    return {sourceId,sourceConfigHash};
  }):undefined;
  const rows=await db.crawlBatchSourceResult.findMany({where:{
    releaseCandidateId:candidateId,sourceId:{in:[...sourceIds]},
    ...(configuredSources?{OR:configuredSources}:{}),
    startedAt:{gte:new Date(Number(slot))},
    finishedAt:{gte:new Date(Number(slot)),lt:new Date(Number(slot)+dailySlotMs)},
    batch:{is:{kind:"SCHEDULED",ownerId:"direct-scheduler"}}
  },select:{sourceId:true,batchId:true,atomicCommitState:true,completenessState:true,
    validCount:true,
    failureCode:true,transportState:true,adapterState:true,
    lossLedgerEntries:{where:{OR:[
      ...pendingLossCodes.map(code=>({details:{path:['code'],equals:code}})),
      {details:{path:['noteCode'],equals:'NO_OMISSION_NOT_VERIFIED'}},
      {details:{path:['noteCode'],equals:'OFFICIAL_STATUS_OPEN_GEOGRAPHY_PENDING'}}
    ]},select:{id:true}},_count:{select:{
    lossLedgerEntries:{where:{details:{path:['code'],equals:'JOB_QUARANTINED'}}},
    evidenceArtifacts:{where:{OR:[
      {extractorLocator:NOVARTIS_UNRESOLVED_DISCOVERY_LOCATOR},
      {sourceId:'source-novartis-social',extractorLocator:NOVARTIS_PARTITION_AUDIT_LOCATOR,
        captureToolName:NOVARTIS_PARTITION_CAPTURE.name,captureToolVersion:{in:Array.from({length:10},(_,index)=>String(index+4))}}
    ]}}
  }}},orderBy:[{finishedAt:"asc"},{id:"asc"}]});
  const latest=new Map<string,(typeof rows)[number]>();
  const latestCommitted=new Map<string,(typeof rows)[number]>();
  for(const row of rows) {
    if(row.failureCode==="SOURCE_NOT_DUE"&&row.transportState==="SKIPPED"&&row.adapterState==="SKIPPED"&&
      row.atomicCommitState==="NOT_ATTEMPTED"&&row.completenessState==="FAILED")continue;
    latest.set(row.sourceId,row);
    if(row.atomicCommitState==="COMMITTED"&&row.completenessState==="VERIFIED") {
      latestCommitted.set(row.sourceId,row);
    }
  }
  return [...latest.entries()].map(([sourceId,lastAttempt])=>{
    const committedRow=latestCommitted.get(sourceId);
    const row=committedRow ?? lastAttempt;
    const committed=row.atomicCommitState==='COMMITTED'&&row.completenessState==='VERIFIED';
    const quarantinedJobCount=row._count.lossLedgerEntries;
    const collapse=isCatastrophicQuarantineCollapse(
      row.validCount ?? (row as {dedupeOutputCount?: number}).dedupeOutputCount,
      quarantinedJobCount
    );
    const captured=committed && !collapse;
    const unresolvedCoverage=row._count.evidenceArtifacts>0||row.lossLedgerEntries.length>0||
      (!captured && (lastAttempt._count.evidenceArtifacts>0||lastAttempt.lossLedgerEntries.length>0));
    return {sourceId:row.sourceId,batchId:row.batchId,committed,captured,
      complete:captured,quarantinedJobCount,unresolvedCoverage};
  });
}

/** Coverage always uses the full catalog, even when this invocation retries a subset. */
export async function readRoundCoverage(db:Pick<PrismaClient,"crawlBatchSourceResult">,candidateId:string,slot:string|null,
  sourceIds:readonly string[],results:readonly {status:string;failedSourceCount?:number;blockedSourceCount?:number}[],
  sourceConfigHashes?:ReadonlyMap<string,string>) {
  const completion=await readSourceCompletion(db,candidateId,slot,sourceIds,sourceConfigHashes);
  const committedRows=completion.filter(row=>row.committed);
  const complete=sourceIds.every(id=>completion.some(row=>row.sourceId===id&&row.complete))&&results.every(row=>row.status!=="FAILED"&&
    (!("failedSourceCount" in row)||row.failedSourceCount===0&&row.blockedSourceCount===0));
  const quarantinedJobCount=committedRows.reduce((sum,row)=>sum+row.quarantinedJobCount,0);
  const unresolvedCoverage=completion.some(row=>row.unresolvedCoverage);
  return {complete,quarantinedJobCount,unresolvedCoverage,
    capturedSources:completion.filter(row=>row.complete).map(({sourceId,batchId})=>({sourceId,batchId}))};
}
