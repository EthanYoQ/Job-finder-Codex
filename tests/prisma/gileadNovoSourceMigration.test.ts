import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,it } from 'vitest';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { assertExistingDatabaseMigrationHistory,assertExistingDatabaseMigrationManifest } from '../../src/db/existingDatabasePreflight';
import { listCurrentPrismaMigrations } from '../../src/db/prismaMigrationManifest';
const prior='20261002011500_city_pending_source_policies',next='20261002020000_gilead_novo_source_policies';
const read=(n:string)=>readFileSync(resolve('prisma/migrations',n,'migration.sql'),'utf8');
const body=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'),s.indexOf('\nCOMMIT;'));
describe('append-only Gilead/Novo SQL45 admission',()=>{
 it('adds only exact Gilead and Novo tuples after the unchanged SQL44 function',()=>{
  const old=read(prior),sql=read(next);let stripped=body(sql);
  const historicalConfigs = {
    gilead: 'bdb31408948240f810347b6ba217407b0b50c9327c9600b4115a2a7a0869e40c',
    'novo-nordisk': '2b79c0304952bfea93d2e50e2ebfb7668760043eb6c841b51597893378648805'
  } as const;
  for(const source of ['gilead','novo-nordisk'] as const){const p=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===`source-${source}-china-social`)!;const tuple=`                ('${p.source.id}','${p.company.id}','${historicalConfigs[source]}'),\n`;expect(stripped.split(tuple)).toHaveLength(2);stripped=stripped.replace(tuple,'');}
  const currentNovo=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novo-nordisk-china-social')!;
  expect(read('20261002093322_novo_native_application_policy')).toContain(
    `('source-novo-nordisk-china-social','company-novo-nordisk-china','${sourcePlanConfigSha256(currentNovo)}')`);
  expect(stripped).toBe(body(old));
  const definition=body(old).slice(0,body(old).lastIndexOf('$function$'))+'$function$\n';
  expect(sql).toContain(`<> '${createHash('md5').update(definition).digest('hex')}' THEN`);
  expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
 });
 it('accepts exact SQL45 history, preserves all prior pins, and rejects drift',()=>{
  const files=listCurrentPrismaMigrations(process.cwd()).filter(m=>m.migrationName<=next);expect(files).toHaveLength(45);
  for(let count=36;count<=45;count++)expect(()=>assertExistingDatabaseMigrationManifest(files.slice(0,count))).not.toThrow();
  const rows=files.map(m=>({migration_name:m.migrationName,checksum:m.checksum,finished_at:new Date(),rolled_back_at:null}));
  expect(()=>assertExistingDatabaseMigrationHistory(rows,files)).not.toThrow();
  for(const bad of [rows.slice(0,-1),rows.map((r,i)=>i===44?{...r,checksum:'0'.repeat(64)}:r),rows.map((r,i)=>i===44?{...r,finished_at:null}:r),rows.map((r,i)=>i===44?{...r,rolled_back_at:new Date()}:r),[...rows,rows[44]!]])expect(()=>assertExistingDatabaseMigrationHistory(bad,files)).toThrow();
  expect(()=>assertExistingDatabaseMigrationManifest(files.map((m,i)=>i===44?{...m,checksum:'0'.repeat(64)}:m))).toThrow();
 });
});
