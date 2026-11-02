import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';

test('PostgreSQL admits bound Lilly closures and rejects missing or conflicting evidence',async()=>{
 const passwordFile=process.env.JOBFINDER_PG_TEST_PASSWORD_FILE;
 assert.ok(passwordFile,'Set JOBFINDER_PG_TEST_PASSWORD_FILE for the isolated local PostgreSQL fixture');
 const pool=new Pool({host:'127.0.0.1',port:55437,database:'postgres',user:'jobfinder_test',password:(await readFile(passwordFile,'utf8')).trim(),max:1,connectionTimeoutMillis:5000});
 const db=await pool.connect();
 try {
  const identity=(await db.query('SELECT current_user AS role,inet_server_port() AS port,current_setting(\'server_version_num\')::int AS version')).rows[0];
  assert.equal(identity.role,'jobfinder_test');assert.equal(identity.port,55437);assert(identity.version>=170000&&identity.version<180000);
  await db.query('BEGIN');
  await db.query('CREATE TEMP TABLE "LossLedgerEntry" ("sourceResultId" text,"releaseCandidateId" text,"batchId" text,"sourceId" text,stage text,details jsonb,"rawLocator" text,"candidateKey" text,"winnerKey" text) ON COMMIT DROP');
  const migration=await readFile(new URL('./migrations/20261103_lilly_closed_total.sql',import.meta.url),'utf8');
  const replacement=migration.split('$replacement$')[1];
  const predicate=replacement.slice(replacement.indexOf('OR (')+3,replacement.lastIndexOf('                    OR (')).trim();
  const fields=[...new Set([...predicate.matchAll(/NEW\."([^"]+)"/g)].map(m=>m[1]))];
  const columns=fields.map(name=>`"${name}" ${name==='completenessCertificate'?'jsonb':name.endsWith('Count')?'integer':'text'}`).join(',');
  await db.query(`CREATE FUNCTION pg_temp.admitted(input jsonb) RETURNS boolean LANGUAGE plpgsql AS $body$ DECLARE NEW record; BEGIN SELECT * INTO NEW FROM jsonb_to_record(input) AS x(${columns}); IF NOT (false OR ${predicate}) THEN RETURN false; END IF; RETURN true; END $body$`);
  const code='LILLY_OFFICIAL_APPLICATION_CLOSED',binding={releaseCandidateId:'candidate',batchId:'batch',sourceId:'source-lilly-china-social',sourceResultId:'result'};
  const losses=[0,50].map(i=>({...binding,stage:'VALIDATION',details:{code},rawLocator:`page-${Math.floor(i/50)}#record:${i%50}`,candidateKey:null,winnerKey:null}));
  const valid={...binding,id:binding.sourceResultId,parseDiscardCount:0,normalizationDiscardCount:0,dedupeDiscardCount:0,collisionCount:0,validationDiscardCount:2,discardCount:2,rawCount:51,parsedCount:51,expectedJobCount:51,validCount:49,normalizedCount:49,dedupeInputCount:49,dedupeOutputCount:49,adapterInputCount:49,adapterOutputCount:49,adapterLossCount:0,adapterCollisionGroupCount:0,
   completenessCertificate:{schemaVersion:'a-grade-official-total-v2',grade:'A',binding,counts:{officialTotal:51,rawObservationCount:51,finalUniqueJobCount:49,validationDiscardCount:2,legalDedupeCount:0},legalScopeExclusionLedger:losses.map((l,i)=>({code,rawLocatorSha256:createHash('sha256').update(l.rawLocator).digest('hex'),recordIndex:i===0?0:50}))}};
  async function check(row,entries,expected){
   await db.query('TRUNCATE "LossLedgerEntry"');
   for(const l of entries)await db.query('INSERT INTO "LossLedgerEntry" VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[l.sourceResultId,l.releaseCandidateId,l.batchId,l.sourceId,l.stage,l.details,l.rawLocator,l.candidateKey,l.winnerKey]);
   assert.equal((await db.query('SELECT pg_temp.admitted($1) AS allowed',[row])).rows[0].allowed,expected);
  }
  await check(valid,losses,true);
  await check({...valid,expectedJobCount:50},losses,false);
  await check({...valid,sourceId:'another-source'},losses,false);
  await check({...valid,adapterLossCount:1},losses,false);
  await check(valid,[losses[0]],false);
  await check(valid,[losses[0],losses[0]],false);
  await check(valid,[losses[0],{...losses[1],details:{code:'UNKNOWN'}}],false);
  await check(valid,[losses[0],{...losses[1],batchId:null}],false);
  const altered=structuredClone(valid);altered.completenessCertificate.legalScopeExclusionLedger[1].rawLocatorSha256='0'.repeat(64);
  await check(altered,losses,false);
  const unbound=structuredClone(valid);unbound.completenessCertificate.binding.batchId='other';
  await check(unbound,losses,false);
  for(const field of ['schemaVersion','grade','counts','binding','legalScopeExclusionLedger']){
   const missing=structuredClone(valid);delete missing.completenessCertificate[field];await check(missing,losses,false);
  }
 }finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
});
