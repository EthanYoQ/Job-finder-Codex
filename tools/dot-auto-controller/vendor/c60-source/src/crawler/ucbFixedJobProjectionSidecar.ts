/** Fixed local data sidecar. Never a publication authorization or DB adapter. */
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {jobPersistedProjectionForCommand} from '../db/ingestionRepository';
import {parseJobProjectionDeltaReceipt,hashJobPersistedProjection,canonicalProjectionJson} from '../domain/jobProjectionDeltaReceipt';
import type {IngestionCommand} from './ingestion';

export function reviewedPacketProjectionData(packet:{sql:string;commit:{sourceResult:any;commands:readonly IngestionCommand[]}}){
 const row=packet.commit.sourceResult;
 const receipt=parseJobProjectionDeltaReceipt(row.completenessCertificate,row.completenessCertificateSha256);
 const binding={releaseCandidateId:row.releaseCandidateId,batchId:row.batchId,sourceId:row.sourceId,sourceResultId:row.id};
 if(canonicalProjectionJson(binding)!==canonicalProjectionJson(receipt.binding))throw Error('FIXED_PROJECTION_TUPLE');
 const projections=packet.commit.commands.filter((c):c is Extract<IngestionCommand,{type:'UPSERT_JOB'}>=>c.type==='UPSERT_JOB'&&c.lifecycleStatus==='ACTIVE').map(jobPersistedProjectionForCommand);
 const members=receipt.members.filter(m=>m.setKind==='VISIBLE');
 if(projections.length!==members.length||new Set(projections.map(p=>p.dedupeKey)).size!==projections.length)throw Error('FIXED_PROJECTION_SET');
 for(const m of members){const matches=projections.filter(p=>p.dedupeKey===m.jobKey);
  if(matches.length!==1||hashJobPersistedProjection(matches[0]!)!==m.jobProjectionSha256||matches[0]!.sourceId!==binding.sourceId)throw Error('FIXED_PROJECTION_HASH');}
 return {schemaVersion:1,kind:'REVIEWED_PACKET_PROJECTION_DATA',binding,receiptSha256:row.completenessCertificateSha256,sqlSha256:createHash('sha256').update(packet.sql).digest('hex'),projections};
}

export async function writeReviewedJobProjectionSidecar(packet:Parameters<typeof reviewedPacketProjectionData>[0],relayDirectory:string){
 const mode=process.env.JOBFINDER_FIXED_PROJECTION_MODE;
 if(!['TEST_ONLY','LIVE'].includes(mode??'')||process.env.JOBFINDER_OWNED_PIPE_MODE!==mode)throw Error('FIXED_PROJECTION_MODE');
 const {TASK_ROOT,RELAY_ROOT,readChecked,loadBinding}=await import('../../ops/cloud-pilot-host/connector-host-binding.mjs');
 if(relayDirectory!==RELAY_ROOT)throw Error('FIXED_PROJECTION_PATH');
 const binding=loadBinding(),seed=JSON.parse(readChecked(join(TASK_ROOT,'fixed-seed.json')).bytes.toString('utf8'));
 const data=reviewedPacketProjectionData(packet);
 if(binding.control.candidate.id!==seed.candidateId||binding.control.build.contentSha256!==seed.buildSha256||seed.sourceId!=='source-ucb-china-social'||seed.projectId!=='yiopvxysxrtrnvqxwgbx'||data.binding.releaseCandidateId!==seed.candidateId||data.binding.batchId!==seed.batchId||data.binding.sourceId!==seed.sourceId||data.binding.sourceResultId!==seed.batchId+'--'+seed.sourceId)throw Error('FIXED_PROJECTION_SEED');
 // readChecked above applies the original owner/no-follow/private-dir guards.
 // wx refuses an existing file or symlink and never replaces previous evidence.
 const projectionBytes=JSON.stringify(data);
 await writeFile(join(TASK_ROOT,'reviewed-projections.json'),projectionBytes,{flag:'wx',mode:0o600});
 const packetData={schemaVersion:1,kind:'REVIEWED_PUBLICATION_DATA',seed,sql:packet.sql,sqlSha256:data.sqlSha256,sourceResult:packet.commit.sourceResult,expiresAt:(packet as any).expiresAt,holderId:(packet as any).holderId,receiptSha256:data.receiptSha256,projectionsSha256:createHash('sha256').update(projectionBytes).digest('hex')};
 if(typeof packetData.expiresAt!=='string'||!Number.isFinite(Date.parse(packetData.expiresAt)))throw Error('FIXED_REVIEWED_PACKET_EXPIRY');
 if(typeof packetData.holderId!=='string'||!packetData.holderId)throw Error('FIXED_REVIEWED_PACKET_HOLDER');
 await writeFile(join(TASK_ROOT,'reviewed-publication-data.json'),JSON.stringify(packetData),{flag:'wx',mode:0o600});
 if(mode==='TEST_ONLY'){
 // Explicit offline oracle for the synthetic official-tool port only. These
 // values never substitute for a LIVE database result or grant authority.
 const {Prisma}=await import('@prisma/client');
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 const row=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,packet.commit.sourceResult[f.name]??null]));
 const source=packet.commit.sourceResult;
 await writeFile(join(TASK_ROOT,'test-only-reviewed-packet.json'),JSON.stringify({kind:'TEST_ONLY_PACKET_DATA',sqlSha256:data.sqlSha256,row,batch:{id:source.batchId,releaseCandidateId:source.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:'',productionQualified:false}),{flag:'wx',mode:0o600});
 }
 return data;
}
