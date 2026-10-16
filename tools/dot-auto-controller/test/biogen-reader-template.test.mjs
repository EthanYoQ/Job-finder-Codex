import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {compileReviewedReaderSql} from '../transport/biogen-reader-template.mjs';
const template=fs.readFileSync(new URL('../transport/queries/biogen-c60-reader-before.sql',import.meta.url),'utf8');
test('Biogen read-only full-inventory template is source-specific and byte pinned',()=>{
 const sql=compileReviewedReaderSql(template,'synthetic-biogen-candidate');assert(sql.includes('source-biogen-china-social'));assert(!sql.includes('source-takeda-china-social'));assert(sql.includes('47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348'));assert(sql.includes('synthetic-biogen-candidate'));assert(/READ ONLY/i.test(sql));for(const kind of ['jobs','results','members','artifacts','writerInventory'])assert(sql.includes(kind));
 assert.throws(()=>compileReviewedReaderSql(template+'\n','synthetic-biogen-candidate'),/QUERY_DRIFT/);assert.throws(()=>compileReviewedReaderSql(template,"bad';DROP"),/CANDIDATE_CONFIG/);
});
