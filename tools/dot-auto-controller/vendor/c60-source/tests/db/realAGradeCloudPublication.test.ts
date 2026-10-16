// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureSyntheticLillyAGrade} from '../helpers/lillyAGradeFixture';
import {archiveSourceEvidence} from '../../src/crawler/artifactArchive';
import {bindRuntimeEvidenceArtifactIds,buildAtomicRuntimeCommit,buildPendingRuntimeBatch} from '../../src/crawler/runtimeAtomicEvidence';
import {sourcePlanConfigSha256} from '../../src/crawler/sourcePlan';
import {compilePortableAtomicSourceEvidenceSql} from '../../src/db/ingestionRepository';
import {loadPilotContext} from '../../scripts/p0-cloud-source-pilot';
import {acquirePortableCrawlLease} from '../../src/crawler/portableCrawlLease';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
it('compiles a genuine A certificate under the same fenced last-good policy without relabeling it',async()=>{
 const input=await captureSyntheticLillyAGrade(),root=await mkdtemp(join(tmpdir(),'real-a-publication-'));dirs.push(root);
 const identity={releaseCandidateId:'synthetic-real-a',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'synthetic-a',expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:'a'.repeat(64),expectedPlannedSourceCount:1};
 const batchId='synthetic-real-a-batch',pending=buildPendingRuntimeBatch(batchId,[input.plan],identity,input.startedAt).sources[0]!;
 const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:input.plan.source.id,sourceResultId:pending.id};
 const archive=await archiveSourceEvidence({workspaceRoot:root,...tuple,evidenceSubdirectory:'evidence',captureTool:input.result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:input.result.fetchEvidence!.artifacts})});
 const args={...input,pending,identity,batchId,previousJobs:[],baselineCompletedBeforeCrawl:false,artifacts:archive.artifacts,completedAt:new Date('2026-10-02T10:01:00.000Z'),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const};
 const commit=buildAtomicRuntimeCommit(args);
 expect(commit.sourceResult.completenessState).toBe('VERIFIED');
 expect(commit.sourceResult.completenessCertificate).toMatchObject({schemaVersion:'a-grade-official-total-v2',grade:'A',binding:{sourceConfigSha256:sourcePlanConfigSha256(input.plan)}});
 const row=JSON.parse(JSON.stringify(commit.sourceResult));
 const contextValue={sourceId:input.plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(input.plan),jobs:[],firstAccepted:row,latestAccepted:row};
 const context=await loadPilotContext(contextValue,input.plan,true);
 expect(context.trustedCompletenessBaseline?.certificateGrade).toBe('A');
 expect(context.acceptedVisibilityFloor?.toISOString()).toBe(row.finishedAt);
 await expect(loadPilotContext({...contextValue,latestAccepted:{...row,sourceConfigHash:'b'.repeat(64)}},input.plan,true)).rejects.toThrow('PILOT_A_BASELINE_CONFIG_MISMATCH');
 let pg:any;
 if(process.env.PGLITE_MODULE){
  const modulePath=process.env.PGLITE_MODULE;
  const {PGlite}=await import(pathToFileURL(resolve(modulePath)).href);
  const {pgcrypto}=await import(pathToFileURL(resolve(modulePath,'../contrib/pgcrypto.js')).href);
  pg=await PGlite.create({extensions:{pgcrypto}});
  for(const name of (await readdir('prisma/migrations')).sort())if(name<='20261002101515_organon_source_policy'&&name!=='20260927120000_p0_launch_cohort_41_companies')await pg.exec(await readFile('prisma/migrations/'+name+'/migration.sql','utf8'));
 }
 const lease=await acquirePortableCrawlLease(pg?{$transaction:work=>pg.transaction((tx:any)=>work({$queryRawUnsafe:async<T>(sql:string,...values:unknown[])=>(await tx.query(sql,values)).rows as T}))}:{$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})});
 const sql=await compilePortableAtomicSourceEvidenceSql(commit,lease);
 expect(sql).toContain('a-grade-official-total-v2');expect(sql).not.toContain('plan-bound-source-quality-v1');
 expect(sql).toContain('CRAWL_LEASE_LOST');expect(sql).toContain('INSERT INTO public."Job"');
 await expect(compilePortableAtomicSourceEvidenceSql(structuredClone(commit),lease)).rejects.toThrow('ATTESTATION_MISSING');
 if(pg)try{
  const insert=async(table:string,data:Record<string,unknown>)=>{const columns=Object.keys(data).map(k=>'"'+k+'"').join(',');await pg.query('INSERT INTO public."'+table+'" ('+columns+') SELECT '+columns+' FROM jsonb_populate_record(NULL::public."'+table+'",$1::jsonb)',[JSON.stringify(data)]);};
  await insert('Company',{id:input.plan.company.id,officialChineseName:input.plan.company.officialChineseName,officialWebsiteUrl:input.plan.source.officialEntryUrl,pinyinName:'synthetic',inclusionReason:'isolated A test',updatedAt:new Date()});
  await insert('RecruitmentSource',{id:input.plan.source.id,companyId:input.plan.company.id,kind:input.plan.source.kind,atsKind:input.plan.source.atsKind,officialEntryUrl:input.plan.source.officialEntryUrl,officialChainEvidenceUrl:input.plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
  await insert('ReleaseCandidate',{id:identity.releaseCandidateId,goalId:'synthetic',version:1,commitSha:identity.commitSha,dbSnapshotHash:'a'.repeat(64),schemaHash:'a'.repeat(64),migrationVersion:'SQL47',rosterHash:identity.rosterSha256,sourcePlanHash:identity.sourcePlanSha256,sourceConfigHash:identity.sourceConfigSha256,adapterBundleHash:identity.adapterBundleSha256,sourceTreeHash:'a'.repeat(64),runtimeTreeHash:'a'.repeat(64),oracleVersion:'synthetic',minimumStableCompanyCount:41});
  const counts=(keys:string[])=>Object.fromEntries(keys.map(k=>[k+'Count',0]));
  const batch=buildPendingRuntimeBatch(batchId,[input.plan],identity,input.startedAt).batch;
  await insert('CrawlBatch',{...batch,...counts(['transportSucceeded','transportFailed','adapterSucceeded','adapterFailed','completenessVerified','completenessIncomplete','atomicCommitted','atomicFailed','failedSource','blockedSource','skippedSource']),status:'RUNNING'});
  await insert('CrawlBatchSourceResult',{...pending,...counts(['raw','parsed','valid','normalized','dedupeInput','dedupeOutput','parseDiscard','validationDiscard','normalizationDiscard','dedupeDiscard','collision','discard']),releaseCandidateId:identity.releaseCandidateId,batchId,transportState:'PENDING',adapterState:'PENDING',completenessState:'PENDING',atomicCommitState:'PENDING'});
  await pg.exec(sql);
  expect((await pg.query(`SELECT "atomicCommitState", "completenessCertificate"->>'grade' AS grade FROM "CrawlBatchSourceResult"`)).rows).toEqual([{atomicCommitState:'COMMITTED',grade:'A'}]);
  expect((await pg.query('SELECT count(*)::int AS n FROM "Job"')).rows[0].n).toBe(1);
 }finally{await pg.close();}

});
