import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadDirectPlans } from '../runner-candidate/scripts/direct-round';
import { hashCanonicalStringSet } from '../runner-candidate/src/crawler/runtimeBatchIdentity';
import { describePortableRuntimeError } from '../runner-candidate/src/crawler/portableRuntimeDiagnostics';

const stateRoot='/data/job-finder';
let db:PrismaClient|undefined;
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const delivery=JSON.parse(await readFile(`${stateRoot}/staging/simple-delivery.json`,'utf8'));
  const archive=JSON.parse(await readFile(`${stateRoot}/migration-private/manifest.json`,'utf8'));
  const inspection=JSON.parse(await readFile(`${stateRoot}/migration-private/archive-inspection.json`,'utf8'));
  const candidateId=`instabox-20261031-${delivery.sourceCommit.slice(0,12)}`;
  const address=execFileSync('docker',['inspect','--format','{{.NetworkSettings.Networks.bridge.IPAddress}}','jobfinder-postgres'],{encoding:'utf8'}).trim();
  const url=new URL(`postgresql://jobfinder@${address}:5432/jobfinder?connection_limit=1&connect_timeout=10`);
  url.password=process.env.POSTGRES_PASSWORD!;
  db=new PrismaClient({datasources:{db:{url:url.href}}});
  // This one-time registration never changes an imported batch, request or receipt.
  if(await db.releaseCandidate.findUnique({where:{id:candidateId},select:{id:true}})) throw Error('CANDIDATE_ALREADY_REGISTERED_CHECK_EXISTING_STATE');
  const routes=await loadDirectPlans();
  const [candidates,pending,batches,manual,migrations]=await Promise.all([
    db.releaseCandidate.findMany({select:{id:true}}),
    db.crawlBatchSourceResult.findMany({where:{atomicCommitState:'PENDING'},select:{id:true,releaseCandidateId:true,batchId:true,sourceId:true}}),
    db.crawlBatch.findMany({where:{status:'RUNNING'},select:{id:true,releaseCandidateId:true}}),
    db.manualCrawlRequest.findMany({where:{status:{in:['RUNNING','QUEUED']}},select:{id:true,sourceId:true,status:true}}),
    db.$queryRawUnsafe<Array<{migration_name:string}>>('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1')
  ]);
  const audit={candidateId,sourceArchiveSha256:archive.sha256,importedAt:archive.completedAt,replayLegacy:false,
    legacyCandidateIds:candidates.map(row=>row.id),
    unresolvedRequests:[...pending.map(row=>({kind:'SOURCE_RESULT',...row})),...batches.map(row=>({kind:'BATCH',...row})),...manual.map(row=>({kind:'MANUAL_REQUEST',...row}))]};
  await writeFile(`${stateRoot}/migration-state.json`,JSON.stringify(audit,null,2)+'\n',{mode:0o600,flag:'wx'});
  await db.releaseCandidate.create({data:{id:candidateId,goalId:'job-finder-instabox-migration',version:1,
    commitSha:delivery.sourceCommit,dbSnapshotHash:archive.sha256,schemaHash:inspection.schemaSha256,
    migrationVersion:migrations[0]!.migration_name,
    rosterHash:hashCanonicalStringSet(routes.map(row=>row.companyId)),
    sourcePlanHash:sha(routes.map(({sourceId,route})=>({sourceId,route}))),
    sourceConfigHash:sha(routes.map(({sourceId,sourceConfigSha256})=>({sourceId,sourceConfigSha256}))),
    adapterBundleHash:delivery['simple-source.tar.gz'].sha256,sourceTreeHash:delivery['simple-source.tar.gz'].sha256,
    runtimeTreeHash:delivery['simple-runtime.tar.gz'].sha256,oracleVersion:'instabox-native-20261031',
    minimumStableCompanyCount:new Set(routes.map(row=>row.companyId)).size,status:'BUILDING'}});
  await writeFile(`${stateRoot}/runtime.env`,`JOBFINDER_CANDIDATE_ID=${candidateId}\n`,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'NEW_CANDIDATE_REGISTERED',candidateId,sourceCount:routes.length,
    preservedLegacyCandidates:candidates.length,preservedUnresolvedRequests:audit.unresolvedRequests.length}));
} catch(error) {
  console.log(JSON.stringify({status:'REGISTRATION_FAILED_CHECK_DATABASE_AND_STATE',diagnostic:describePortableRuntimeError(error)}));
  process.exitCode=1;
} finally {await db?.$disconnect();}
