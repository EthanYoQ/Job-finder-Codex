import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {compileReviewedReaderSql} from '../transport/hengrui-reader-template.mjs';
const template=fs.readFileSync(new URL('../transport/queries/hengrui-c60-reader-before.sql',import.meta.url),'utf8');
test('Hengrui read-only full-inventory template is source-specific and byte pinned',()=>{
 const sql=compileReviewedReaderSql(template,'synthetic-hengrui-candidate');assert(sql.includes('source-hengrui-social'));assert(!sql.includes('source-takeda-china-social'));assert(sql.includes('93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e'));assert(sql.includes('synthetic-hengrui-candidate'));assert(/READ ONLY/i.test(sql));for(const kind of ['jobs','results','members','artifacts','writerInventory'])assert(sql.includes(kind));
 assert.throws(()=>compileReviewedReaderSql(template+'\n','synthetic-hengrui-candidate'),/QUERY_DRIFT/);assert.throws(()=>compileReviewedReaderSql(template,"bad';DROP"),/CANDIDATE_CONFIG/);
});
