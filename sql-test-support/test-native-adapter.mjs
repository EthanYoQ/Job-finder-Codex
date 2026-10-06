// Offline self-check of the test-only stdin adapter, using a fresh --single DB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from './node_modules/native-single-test/index.js';
const db=await PGlite.create(),checks=[];
try{
 const value="quotes ' double \" backslash \\ Unicode 测试\n;\n\n$inner$ kept";
 assert.deepEqual((await db.query('SELECT $1::text AS value',[value])).rows,[{value}]);checks.push('parameter-literal-roundtrip');
 const body="\nBEGIN\n  -- preserve blank lines and dollar tags\n  PERFORM 1;\n\n  RETURN '$inner$';\nEND;\n";
 await db.exec(`CREATE FUNCTION adapter_body() RETURNS text LANGUAGE plpgsql AS $outer$${body}$outer$`);
 const row=(await db.query("SELECT prosrc, md5(prosrc) AS md5 FROM pg_proc WHERE proname='adapter_body'")).rows[0];
 assert.equal(row.prosrc,body);assert.equal(row.md5,createHash('md5').update(body).digest('hex'));checks.push('dollar-body-byte-and-md5-preserved');
 assert.deepEqual((await db.query('SELECT adapter_body() AS value')).rows,[{value:'$inner$'}]);checks.push('function-executes-original-body');
 await db.exec('CREATE TABLE adapter_atomic(id int PRIMARY KEY)');
 await db.exec('BEGIN; INSERT INTO adapter_atomic VALUES (1); SAVEPOINT checked');
 await assert.rejects(()=>db.exec('INSERT INTO adapter_atomic VALUES(1)'),/duplicate key/);
 await db.exec('ROLLBACK TO SAVEPOINT checked; ROLLBACK');
 assert.deepEqual((await db.query('SELECT count(*)::int AS n FROM adapter_atomic')).rows,[{n:0}]);checks.push('error-savepoint-and-rollback');
 assert.deepEqual((await db.query("SELECT encode(digest('abc','sha256'),'hex') AS sha")).rows,[{sha:createHash('sha256').update('abc').digest('hex')}]);checks.push('real-pgcrypto-digest');
 console.log(JSON.stringify({status:'PASS_TEST_ADAPTER_ONLY',checks,networkUsed:false,multiBackendTest:false}));
}finally{await db.close();}
