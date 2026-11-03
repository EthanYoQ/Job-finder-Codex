import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';

test('PostgreSQL admits bound Roche denials and rejects incomplete or altered accounting',async()=>{
 const passwordFile=process.env.JOBFINDER_PG_TEST_PASSWORD_FILE;
 assert.ok(passwordFile,'Set JOBFINDER_PG_TEST_PASSWORD_FILE for the isolated local PostgreSQL fixture');
 const pool=new Pool({host:'127.0.0.1',port:55437,database:'postgres',user:'jobfinder_test',password:(await readFile(passwordFile,'utf8')).trim(),max:1,connectionTimeoutMillis:5000});
 const db=await pool.connect();
 try{
  const identity=(await db.query('SELECT current_user AS role,inet_server_port() AS port,current_setting(\'server_version_num\')::int AS version')).rows[0];
  assert.equal(identity.role,'jobfinder_test');assert.equal(identity.port,55437);assert(identity.version>=170000&&identity.version<180000);
  await db.query('BEGIN');
  await db.query('CREATE TEMP TABLE "LossLedgerEntry" ("sourceResultId" text,"releaseCandidateId" text,"batchId" text,"sourceId" text,stage text,details jsonb,"rawLocator" text,"candidateKey" text,"winnerKey" text) ON COMMIT DROP');
  await db.query('CREATE TEMP TABLE "EvidenceArtifact" ("sourceResultId" text,"releaseCandidateId" text,"batchId" text,"sourceId" text,kind text,"httpStatus" int,"requestedUrl" text,"finalUrl" text,"extractorLocator" text,"capturedAt" timestamptz) ON COMMIT DROP');
  const sql=await readFile(new URL('./migrations/20261103_roche_denied_details.sql',import.meta.url),'utf8');
  const predicate=sql.split('$replacement$')[1].trim().slice(3);
  const fields=[...new Set([...predicate.matchAll(/NEW\."([^"]+)"/g)].map(m=>m[1]))];
  const columns=fields.map(name=>`"${name}" ${name==='completenessCertificate'?'jsonb':name.endsWith('Count')?'integer':name.endsWith('At')?'timestamptz':'text'}`).join(',');
  await db.query(`CREATE FUNCTION pg_temp.admitted(input jsonb) RETURNS boolean LANGUAGE plpgsql AS $body$ DECLARE NEW record; BEGIN SELECT * INTO NEW FROM jsonb_to_record(input) AS x(${columns}); IF NOT (false OR ${predicate}) THEN RETURN false; END IF; RETURN true; END $body$`);
  const binding={releaseCandidateId:'candidate',batchId:'batch',sourceId:'source-roche-china-social',sourceResultId:'result'},code='ROCHE_DETAIL_DENIED';
  const losses=[0,1].map(i=>({...binding,stage:'VALIDATION',details:{code,recordIndex:i,noteCode:'NO_OMISSION_NOT_VERIFIED'},rawLocator:`page-0#record:${i}`,candidateKey:null,winnerKey:null}));
  const artifacts=['202610-125686','202610-126799'].map(id=>{const url=`https://roche.wd3.myworkdayjobs.com/wday/cxs/roche/roche-ext/job/Shanghai/Role_${id}`;return {...binding,kind:'ATS_API_RESPONSE',httpStatus:403,requestedUrl:url,finalUrl:url,extractorLocator:'roche-workday-jobposting-v1',capturedAt:'2026-11-03T05:01:00Z'};});
  const valid={...binding,id:'result',startedAt:'2026-11-03T05:00:00Z',finishedAt:'2026-11-03T05:02:00Z',rawCount:3,parsedCount:3,expectedJobCount:3,validCount:1,normalizedCount:1,dedupeInputCount:1,dedupeOutputCount:1,parseDiscardCount:0,normalizationDiscardCount:0,dedupeDiscardCount:0,collisionCount:0,validationDiscardCount:2,discardCount:2,adapterInputCount:1,adapterOutputCount:1,adapterLossCount:0,adapterCollisionGroupCount:0,completenessCertificate:{schemaVersion:'a-grade-official-total-v2',grade:'A',binding,counts:{officialTotal:3,rawObservationCount:3,finalUniqueJobCount:1,validationDiscardCount:2,legalDedupeCount:0},legalScopeExclusionLedger:losses.map(l=>({code,recordIndex:l.details.recordIndex,rawLocatorSha256:createHash('sha256').update(l.rawLocator).digest('hex')}))}};
  async function check(row,entries,receipts,expected){
   await db.query('TRUNCATE "LossLedgerEntry","EvidenceArtifact"');
   for(const l of entries)await db.query('INSERT INTO "LossLedgerEntry" VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[l.sourceResultId,l.releaseCandidateId,l.batchId,l.sourceId,l.stage,l.details,l.rawLocator,l.candidateKey,l.winnerKey]);
   for(const a of receipts)await db.query('INSERT INTO "EvidenceArtifact" VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[a.sourceResultId,a.releaseCandidateId,a.batchId,a.sourceId,a.kind,a.httpStatus,a.requestedUrl,a.finalUrl,a.extractorLocator,a.capturedAt]);
   assert.equal((await db.query('SELECT pg_temp.admitted($1) AS allowed',[row])).rows[0].allowed,expected);
  }
  await check(valid,losses,artifacts,true);
  await check({...valid,validationDiscardCount:1},losses,artifacts,false);
  await check({...valid,adapterLossCount:1},losses,artifacts,false);
  await check(valid,[losses[0],losses[0]],artifacts,false);
  await check(valid,[losses[0],{...losses[1],batchId:null}],artifacts,false);
  await check(valid,losses,[artifacts[0]],false);
  await check(valid,losses,[artifacts[0],artifacts[0]],false);
  for(const patch of [{httpStatus:429},{finalUrl:'https://invalid.example'},{requestedUrl:'https://invalid.example',finalUrl:'https://invalid.example'},{capturedAt:'2026-11-01T00:00:00Z'},{batchId:null}])
   await check(valid,losses,[artifacts[0],{...artifacts[1],...patch}],false);
  const badCounts=structuredClone(valid);badCounts.completenessCertificate.counts.finalUniqueJobCount=3;await check(badCounts,losses,artifacts,false);
  const changed=structuredClone(valid);changed.completenessCertificate.legalScopeExclusionLedger[1].rawLocatorSha256='0'.repeat(64);await check(changed,losses,artifacts,false);
  for(const field of ['schemaVersion','grade','binding','counts','legalScopeExclusionLedger']){const missing=structuredClone(valid);delete missing.completenessCertificate[field];await check(missing,losses,artifacts,false);}
 }finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
});
