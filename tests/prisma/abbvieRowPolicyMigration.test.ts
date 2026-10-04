import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { assertExistingDatabaseMigrationHistory,assertExistingDatabaseMigrationManifest } from '../../src/db/existingDatabasePreflight';
import { listCurrentPrismaMigrations } from '../../src/db/prismaMigrationManifest';
const oldName='20261001174000_astellas_pdf_city_policy',name='20261001181500_abbvie_reviewed_row_policy';
const read=(n:string)=>readFileSync(resolve('prisma/migrations',n,'migration.sql'),'utf8');
const body=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'),s.indexOf('\nCOMMIT;'));
describe('append-only AbbVie row-policy admission',()=>{
 it('adds only the exact reviewed source/company/config tuple after the exact SQL40 predecessor',()=>{
  const old=read(oldName),sql=read(name),plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-abbvie-china-social')!;
  const tuple=`                ('source-abbvie-china-social','company-abbvie-china','${sourcePlanConfigSha256(plan)}'),\n`;
  expect(body(sql).split(tuple)).toHaveLength(2);expect(body(sql).replace(tuple,'')).toBe(body(old));
  const definition=body(old).slice(0,body(old).lastIndexOf('$function$'))+'$function$\n';
  expect(sql).toContain(`<> '${createHash('md5').update(definition).digest('hex')}' THEN`);
  expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
 });
 it('admits exact applied41 history, retaining exact40 and rejecting unknown, drifted and unfinished histories',()=>{
  const artifacts=listCurrentPrismaMigrations(process.cwd()).filter(m=>m.migrationName<=name);expect(artifacts).toHaveLength(41);
  expect(()=>assertExistingDatabaseMigrationManifest(artifacts)).not.toThrow();
  expect(()=>assertExistingDatabaseMigrationManifest(artifacts.slice(0,-1))).not.toThrow();
  const rows=artifacts.map(m=>({migration_name:m.migrationName,checksum:m.checksum,finished_at:new Date(),rolled_back_at:null}));
  expect(()=>assertExistingDatabaseMigrationHistory(rows,artifacts)).not.toThrow();
  for(const bad of [rows.slice(0,-1),rows.map((r,i)=>i===40?{...r,checksum:'0'.repeat(64)}:r),rows.map((r,i)=>i===40?{...r,finished_at:null}:r),rows.map((r,i)=>i===40?{...r,rolled_back_at:new Date()}:r),[...rows,rows[40]!]])expect(()=>assertExistingDatabaseMigrationHistory(bad,artifacts)).toThrow();
 });
});
