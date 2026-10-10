/** Offline negative-boundary checks and arithmetic models, never PostgreSQL execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {NATIVE_SOURCE_FIELDS} from './ledger-contract.mjs';
const sql=readFileSync(new URL('./proposal/jobfinder-control-ledger.sql',import.meta.url),'utf8');
const resolver=sql.split('CREATE FUNCTION jobfinder_control.resolve_committed_v1(')[1].split('$body$;')[0];
const root=process.env.REVIEW_RUNTIME_ROOT;
test('native terminal field map matches the original exact-outcome implementation',{skip:!root},()=>{
 const original=readFileSync(join(root,'src/db/ingestionRepository.ts'),'utf8');
 const array=original.split('const ATOMIC_SOURCE_RESULT_FIELDS = [')[1].split('] as const')[0];
 const names=[...array.matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)].map(x=>x[1]);
 assert.equal(names.length,57);assert.deepEqual(NATIVE_SOURCE_FIELDS,names);
});
test('allowed source-clock lead does not turn a real commit into permanent HOLD',()=>{
 const dbFinished=10000000,sourceFinished=dbFinished+900000; // integer microseconds
 assert.equal(dbFinished>=sourceFinished,false);
 assert.equal(dbFinished>=sourceFinished-1001000,true);
 assert.match(resolver,/b\."finishedAt">=s\."finishedAt"-interval '1001 milliseconds'/);
 assert.match(resolver,/b\."heartbeatAt">=s\."finishedAt"-interval '1001 milliseconds'/);
});
test('native TIMESTAMP(3) rounding does not misorder a later microsecond holder release',()=>{
 const actualBatch=10123600,storedBatch=Math.round(actualBatch/1000)*1000,actualRelease=10123800;
 assert.ok(actualRelease>actualBatch);assert.equal(actualRelease>=storedBatch,false);assert.ok(actualRelease>=storedBatch-1000);
 assert.match(resolver,/l\."heartbeatAt">=\(b\."finishedAt" AT TIME ZONE 'UTC'\)-interval '1 millisecond'/);
});
test('a pre-expiry batch time rounded to the expiry millisecond remains representable',()=>{
 const expiry=1000000,actual=expiry-400,stored=Math.round(actual/1000)*1000;
 assert.ok(actual<expiry);assert.equal(stored<expiry,false);assert.ok(stored<=expiry);
 assert.match(resolver,/b\."finishedAt"<=to_timestamp/);assert.match(resolver,/b\."heartbeatAt"<=to_timestamp/);
});
test('resolver locks only its own ledger row and derives native truth in one statement',()=>{
 assert.equal((resolver.match(/FOR UPDATE/g)||[]).length,1);
 const locking=resolver.split('FOR UPDATE')[0].split('SELECT * INTO i')[1];assert.match(locking,/FROM jobfinder_control\.dispatch_intent/);
 assert.equal((resolver.match(/SELECT EXISTS \(/g)||[]).length,1);
 assert.doesNotMatch(resolver,/FOR SHARE|LOCK TABLE public|UPDATE public\.|DELETE FROM public\./);
});
test('inconclusive or missing native evidence cannot release the global unresolved slot',()=>{
 assert.match(resolver,/IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ORIGINAL_NOT_FOUND'/);
 const hold=resolver.indexOf("IF exact IS DISTINCT FROM true"),update=resolver.indexOf("SET state='COMMITTED_EXACT'");
 assert.ok(hold>0&&update>hold);assert.match(resolver.slice(hold,update),/RETURN jsonb_build_object\('state','HOLD'/);
 assert.doesNotMatch(sql,/CREATE FUNCTION[^\n]*(?:absent|not_committed|clear_slot|rollback)/i);
 assert.match(sql,/ON jobfinder_control\.dispatch_intent \(\(true\)\) WHERE state='MAY_HAVE_BEEN_SENT'/);
});
