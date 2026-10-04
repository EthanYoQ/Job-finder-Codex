import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { assertExistingDatabaseMigrationHistory, assertExistingDatabaseMigrationManifest } from '../../src/db/existingDatabasePreflight';
import { listCurrentPrismaMigrations } from '../../src/db/prismaMigrationManifest';
const prior='20261001163000_portable_zero_based_loss_pages',next='20261001174000_astellas_pdf_city_policy';
const read=(name:string)=>readFileSync(resolve('prisma/migrations',name,'migration.sql'),'utf8');
const body=(s:string)=>s.slice(s.indexOf('CREATE OR REPLACE FUNCTION'),s.indexOf('\nCOMMIT;'));
describe('append-only Astellas PDF city configuration registry',()=>{
 it('changes exactly one source hash and guards the exact prior state-machine definition',()=>{
  const old=read(prior),sql=read(next),hash=sourcePlanConfigSha256(buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social')!);
  const before="('source-astellas-china-social','company-astellas-china','ed8ef03fa7c52d9830aa098579ef6ac82d95984ccf9405d8eff2e24e71050718')";
  expect(body(old).split(before)).toHaveLength(2);
  expect(body(sql)).toBe(body(old).replace(before,()=>`('source-astellas-china-social','company-astellas-china','${hash}')`));
  const pgDefinition=body(old).slice(0,body(old).lastIndexOf('$function$'))+'$function$\n';
  expect(sql).toContain(`IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> '${createHash('md5').update(pgDefinition).digest('hex')}' THEN`);
  expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
  expect(sql.indexOf('$guard$;')).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION'));
 });
 it('allows only the exact forty-file history and refuses missing, drifted, unfinished and unknown entries',()=>{
  const expected=listCurrentPrismaMigrations(process.cwd()).filter(m=>m.migrationName<=next);expect(expected).toHaveLength(40);
  expect(()=>assertExistingDatabaseMigrationManifest(expected)).not.toThrow();
  const rows=expected.map(m=>({migration_name:m.migrationName,checksum:m.checksum,finished_at:new Date(),rolled_back_at:null}));
  expect(()=>assertExistingDatabaseMigrationHistory(rows,expected)).not.toThrow();
  for(const bad of [rows.slice(0,-1),rows.map((r,i)=>i===39?{...r,checksum:'0'.repeat(64)}:r),rows.map((r,i)=>i===39?{...r,finished_at:null}:r),rows.map((r,i)=>i===39?{...r,rolled_back_at:new Date()}:r),[...rows,rows[39]!]])expect(()=>assertExistingDatabaseMigrationHistory(bad,expected)).toThrow();
  expect(()=>assertExistingDatabaseMigrationManifest(expected.map((r,i)=>i===39?{...r,checksum:'0'.repeat(64)}:r))).toThrow();
  expect(()=>assertExistingDatabaseMigrationManifest([...expected,{migrationName:'99999999999999_unknown',checksum:'0'.repeat(64)}])).toThrow();
 });
});
