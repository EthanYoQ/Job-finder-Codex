// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const base={schemaVersion:2 as const,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};
const common={projectId:'yiopvxysxrtrnvqxwgbx',build:{...base,contentSha256:createHash('sha256').update(JSON.stringify(base)).digest('hex')},candidate:{id:'synthetic-b-context',goalId:'jobfinder-portable-required-40',version:10}};
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
async function compiler(source:string){vi.resetModules();vi.stubEnv('JOBFINDER_CLOUD_SOURCE_ID',source);return import('../../src/db/cloudPilotSqlControl');}
it('adds persisted observations only to genuine B context queries',async()=>{
 const b=await compiler('source-bayer-healthcare-social'),bSql=b.compileCloudPilotPublicationContextSql(common);
 expect(bSql).toContain('jsonb_agg(to_jsonb(o) ORDER BY o.id)');
 expect(bSql).toContain('WHERE o."sourceResultId"=r.id');
 expect(bSql).toContain('AS observations');
 expect(bSql).toContain('b-grade-independent-traversal-v2');
 expect(bSql).toContain('bayer-cn-dual-chain-attestation-v1');
 expect(bSql).toContain('FROM public."EvidenceArtifact" a');
 expect(bSql).toContain('a."sourceResultId"=r.id AND a."sourceId"=r."sourceId"');
 expect(bSql).not.toContain('sanofi-cn-module-anomalies-v2');
 const a=await compiler('source-cttq-social'),aSql=a.compileCloudPilotPublicationContextSql(common);
 expect(aSql).not.toContain('CrawlObservation');expect(aSql).not.toContain('AS observations');
 expect(aSql).toContain('a-grade-official-total-v2');
});
it.skipIf(!process.env.PGLITE_MODULE)('reads first/latest observations identically in the host and DB-started projections without filtering bad bindings',async()=>{
 const {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE}=await compiler('source-bayer-healthcare-social');
 const {PGlite}=await import(/* @vite-ignore */ pathToFileURL(resolve(process.env.PGLITE_MODULE!)).href);
 const pg=await PGlite.create();
 try{
  // Only the tables/columns needed to execute the read projection. No repository
  // migrations, persistent database, publication packet or production I/O.
  await pg.exec(`CREATE TABLE "CrawlBatch" (id text,kind text);
   CREATE TABLE "CrawlBatchSourceResult" (id text,"sourceId" text,"sourceConfigHash" text,"batchId" text,"releaseCandidateId" text,"finishedAt" timestamp,"completenessState" text,"atomicCommitState" text,"completenessCertificateSha256" text,"completenessCertificate" jsonb);
   CREATE TABLE "EvidenceArtifact" (id text,"releaseCandidateId" text,"batchId" text,"sourceResultId" text,"sourceId" text,kind text,"extractorLocator" text,sha256 text,"byteCount" int,"capturedAt" timestamp);
   CREATE TABLE "CrawlObservation" (id text,"sourceResultId" text,"sourceId" text,"canonicalRawSha256" text,"crawledAt" timestamp,successful boolean,"batchId" text);
   CREATE TABLE "RecruitmentSource" (id text,"companyId" text,"atsKind" text,kind text,status text,"officialEntryUrl" text,"officialChainEvidenceUrl" text);
   CREATE TABLE "Company" (id text,"officialChineseName" text);
   CREATE TABLE "ReleaseCandidate" (id text);
   CREATE TABLE "CrawlCoordinatorLock" (id text,"holderId" text);
   CREATE TABLE "Job" ("dedupeKey" text,"companyId" text,"sourceId" text,"sourceJobId" text,"officialTitle" text,"auxiliaryChineseTitle" text,"officialUrl" text,"listUrl" text,"locationRaw" text,city text,cities text[],category text,"officialPublishedAt" timestamp,"firstSeenAt" timestamp,"lastSeenAt" timestamp,"missingSuccessCount" int,"lifecycleStatus" text);
   INSERT INTO "CrawlBatch" VALUES ('first-batch','SCHEDULED'),('latest-batch','SCHEDULED');`);
  for(const [id,time] of [['first','2026-10-01T00:00:00Z'],['latest','2026-10-02T00:00:00Z']]){
   await pg.query(`INSERT INTO "CrawlBatchSourceResult" VALUES ($1,$2,$3,$4,'synthetic-b-context',$5,'VERIFIED','COMMITTED',$6,$7)`,[id,CLOUD_PILOT_SOURCE.id,CLOUD_PILOT_SOURCE.sourceConfigSha256,id+'-batch',time,'a'.repeat(64),JSON.stringify({schemaVersion:'b-grade-independent-traversal-v2'})]);
   await pg.query(`INSERT INTO "CrawlObservation" VALUES ($1,$2,$3,$4,$5,true,$6)`,[id+'-observation',id,CLOUD_PILOT_SOURCE.id,(id==='first'?'b':'c').repeat(64),time,id+'-batch']);
  }
  const host=await readFile('docs/recovery/cloud-sql47-runner/hosts/bayer/qilu-context-read.sql','utf8');
  const queries=[host,compileCloudPilotPublicationContextSql(common)];
  for(const sql of queries){
   const snapshot=(await pg.query(sql)).rows[0].context;
   expect(snapshot.firstAccepted.observations).toHaveLength(1);expect(snapshot.latestAccepted.observations).toHaveLength(1);
   expect(snapshot.firstAccepted.observations[0]).toMatchObject({sourceResultId:'first',canonicalRawSha256:'b'.repeat(64),crawledAt:'2026-10-01T00:00:00'});
   expect(snapshot.latestAccepted.observations[0]).toMatchObject({sourceResultId:'latest',canonicalRawSha256:'c'.repeat(64)});
  }
  await pg.exec(`UPDATE "CrawlObservation" SET "sourceId"='wrong' WHERE "sourceResultId"='first'; INSERT INTO "CrawlObservation" SELECT 'duplicate',"sourceResultId","sourceId","canonicalRawSha256","crawledAt",successful,"batchId" FROM "CrawlObservation" WHERE "sourceResultId"='first'; DELETE FROM "CrawlObservation" WHERE "sourceResultId"='latest'`);
  for(const sql of queries){
   const snapshot=(await pg.query(sql)).rows[0].context;
   expect(snapshot.firstAccepted.observations).toHaveLength(2);
   expect(snapshot.firstAccepted.observations[0].sourceId).toBe('wrong');
   expect(snapshot.latestAccepted.observations).toEqual([]);
  }
 }finally{await pg.close();}
});
