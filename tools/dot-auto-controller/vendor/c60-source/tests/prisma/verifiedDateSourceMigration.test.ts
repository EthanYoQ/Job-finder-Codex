import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { assertExistingDatabaseMigrationHistory,assertExistingDatabaseMigrationManifest } from '../../src/db/existingDatabasePreflight';
import { listCurrentPrismaMigrations } from '../../src/db/prismaMigrationManifest';
const prior='20261001181500_abbvie_reviewed_row_policy',next='20261001233000_verified_date_source_policy';
const read=(n:string)=>readFileSync(resolve('prisma/migrations',n,'migration.sql'),'utf8');
const body=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'),s.indexOf('\nCOMMIT;'));
describe('append-only dated-source SQL42 admission',()=>{
 it('adds only exact UCB and Grifols tuples after the unchanged SQL41 function',()=>{
  const old=read(prior),sql=read(next);let stripped=body(sql);
  for(const source of ['ucb','grifols']){const p=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===`source-${source}-china-social`)!;const tuple=`                ('${p.source.id}','${p.company.id}','${sourcePlanConfigSha256(p)}'),\n`;expect(stripped.split(tuple)).toHaveLength(2);stripped=stripped.replace(tuple,'');}
  expect(stripped).toBe(body(old));
  const definition=body(old).slice(0,body(old).lastIndexOf('$function$'))+'$function$\n';
  expect(sql).toContain(`<> '${createHash('md5').update(definition).digest('hex')}' THEN`);
  expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
 });
 it('accepts exact SQL42 history, preserves all prior pins, and rejects drift',()=>{
  const files=listCurrentPrismaMigrations(process.cwd()).filter(m=>m.migrationName<=next);expect(files).toHaveLength(42);
  for(let count=36;count<=42;count++)expect(()=>assertExistingDatabaseMigrationManifest(files.slice(0,count))).not.toThrow();
  const rows=files.map(m=>({migration_name:m.migrationName,checksum:m.checksum,finished_at:new Date(),rolled_back_at:null}));
  expect(()=>assertExistingDatabaseMigrationHistory(rows,files)).not.toThrow();
  for(const bad of [rows.slice(0,-1),rows.map((r,i)=>i===41?{...r,checksum:'0'.repeat(64)}:r),rows.map((r,i)=>i===41?{...r,finished_at:null}:r),rows.map((r,i)=>i===41?{...r,rolled_back_at:new Date()}:r),[...rows,rows[41]!]])expect(()=>assertExistingDatabaseMigrationHistory(bad,files)).toThrow();
  expect(()=>assertExistingDatabaseMigrationManifest(files.map((m,i)=>i===41?{...m,checksum:'0'.repeat(64)}:m))).toThrow();
 });
});
