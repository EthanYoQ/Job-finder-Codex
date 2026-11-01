/** Native PG17 test-only replay. Import does not connect or execute SQL.
 * No server startup, CREATE DATABASE, remote TCP, schema reset or automatic retry.
 */
import {Client, type QueryResult, type QueryResultRow} from 'pg';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const ALLOWED_SOCKET='/workspace/scratch/5e9614251709/pg-isolated-20261014T1256Z/private/socket';
const PRIOR49='91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a';
const COHORT='20260927120000_p0_launch_cohort_41_companies';
const LEDGER=`CREATE TABLE public."_prisma_migrations" (
 id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,
 migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,
 started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0);`;
export type NativeFull49Options={socket:string;database:string;inputRoot:string;outputRoot:string;explicitLocalExecutionApproval:'RUN_NEW_EMPTY_LOCAL_TEST_DATABASE'};
export class NativeFull49Db {
 private sequence=0;
 private closed=false;
 private failed=false;
 private replayDone=false;
 private constructor(private client:Client,readonly inputRoot:string,readonly outputRoot:string,readonly database:string){}
 static async open(options:NativeFull49Options):Promise<NativeFull49Db>{
  if(options.explicitLocalExecutionApproval!=='RUN_NEW_EMPTY_LOCAL_TEST_DATABASE')throw Error('EXECUTION_APPROVAL_REQUIRED');
  if(await realpath(options.socket)!==ALLOWED_SOCKET||!/^jf_retirement_test_[a-z0-9_]+$/.test(options.database))throw Error('LOCAL_TEST_TARGET_REQUIRED');
  const inputRoot=await realpath(options.inputRoot),outputRoot=resolve(options.outputRoot);
  await mkdir(outputRoot,{recursive:false,mode:0o700}); // exclusive one-shot durable claim
  const c=new Client({host:ALLOWED_SOCKET,port:55439,user:'agent',database:options.database,password:'',ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000,idle_in_transaction_session_timeout:15000,query_timeout:20000,application_name:'jf-full49-fixture-'+randomUUID()});
  const db=new NativeFull49Db(c,inputRoot,outputRoot,options.database);
  await db.record('target',{socket:ALLOWED_SOCKET,database:options.database,production:false,startedAt:new Date().toISOString()});
  try{
   await c.connect();
   const r=await db.query<{version:number;listen:string;database:string;user:string;empty:boolean}>(`SELECT current_setting('server_version_num')::int version,current_setting('listen_addresses') listen,current_database() database,current_user AS user,
   NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')) AS empty`);
   const row=r.rows[0];if(!row||row.version<170000||row.version>=180000||row.listen!==''||row.database!==options.database||row.user!=='agent'||!row.empty)throw Error('NEW_EMPTY_NATIVE_PG17_REQUIRED');
   await db.record('preflight',r.rows);return db;
  }catch(e){await db.record('open-failed',{status:'UNKNOWN',error:String(e)});await c.end().catch(()=>{});throw e;}
 }
 private async record(name:string,value:unknown){await writeFile(join(this.outputRoot,`${String(this.sequence++).padStart(4,'0')}-${name}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
 async query<T extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[]):Promise<QueryResult<T>>{
  if(this.closed||this.failed)throw Error('CLOSED_OR_FAILED_NO_RETRY');
  const id=randomUUID();await this.record('query-intent',{id,sqlSha256:hash(sql),sql,values:values??[],dispatchedAt:new Date().toISOString()});
  try{
   const result=values?await this.client.query<T>(sql,values):await this.client.query<T>(sql);
   if(Array.isArray(result))throw Error('SINGLE_RESULT_QUERY_REQUIRED');
   await this.record('query-result',{id,status:'RETURNED',command:result.command,rowCount:result.rowCount,rows:result.rows});return result;
  }catch(error){this.failed=true;await this.record('query-result',{id,status:'FAILED_OR_UNKNOWN_NO_RETRY',error:String(error)});throw error;}
 }
 async execute(sql:string,label:string):Promise<void>{
  if(this.closed||this.failed)throw Error('CLOSED_OR_FAILED_NO_RETRY');
  const id=randomUUID();await this.record('intent',{id,label,sqlSha256:hash(sql),sql,dispatchedAt:new Date().toISOString()});
  try{const raw=await this.client.query(sql);const results=Array.isArray(raw)?raw:[raw];
   await this.record('result',{id,label,status:'RETURNED',receivedAt:new Date().toISOString(),results:results.map(r=>({command:r.command,rowCount:r.rowCount,rows:r.rows}))});
  }catch(error){this.failed=true;await this.record('result',{id,label,status:'FAILED_OR_UNKNOWN_NO_RETRY',error:String(error)});throw error;}
 }
 async replay49():Promise<void>{
  if(this.replayDone)throw Error('REPLAY_ALREADY_DONE');
  const manifest=JSON.parse(await readFile(join(this.inputRoot,'INPUT_MANIFEST.json'),'utf8')) as {prior49:Array<{migrationName:string;checksum:string}>};
  if(manifest.prior49.length!==49||hash(JSON.stringify(manifest.prior49))!==PRIOR49)throw Error('EXACT49_MANIFEST_REQUIRED');
  // Validate EVERY file before making the first schema write.
  const files=await Promise.all(manifest.prior49.map(async m=>{if(!/^[0-9]{14}_[a-z0-9_]+$/.test(m.migrationName))throw Error('MIGRATION_NAME');const sql=await readFile(join(this.inputRoot,'migrations49',m.migrationName,'migration.sql'),'utf8');if(hash(sql)!==m.checksum)throw Error('MIGRATION_BYTES_DRIFT');return {...m,sql};}));
  const auxiliaries=JSON.parse(await readFile(join(this.inputRoot,'NATIVE_INPUT_PINS.json'),'utf8')) as Record<string,string>;
  for(const name of ['before-cohort.synthetic.sql','after-cohort.synthetic.sql','READ_FULL49_CATALOG.sql','CATALOG_EXPECTED.json'])if(hash(await readFile(join(this.inputRoot,name)))!==auxiliaries[name])throw Error('AUXILIARY_INPUT_DRIFT:'+name);
  const before=await readFile(join(this.inputRoot,'before-cohort.synthetic.sql'),'utf8');const after=await readFile(join(this.inputRoot,'after-cohort.synthetic.sql'),'utf8');
  await this.execute(LEDGER,'create-test-ledger');
  for(const f of files){
   if(f.migrationName===COHORT)await this.execute(before,'synthetic-cohort-before');
   const startedAt=new Date().toISOString();
   // NO external BEGIN: preserve file-owned transaction boundaries and enum steps.
   await this.execute(f.sql,'migration:'+f.migrationName);
   // A successful protocol return is followed by this separate test-only ledger row.
   // It does NOT claim migration+ledger atomicity or Prisma engine execution.
   await this.query(`INSERT INTO public."_prisma_migrations" (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
    VALUES($1,$2,clock_timestamp(),$3,$4,NULL,$5::timestamptz,1)`,[randomUUID(),f.checksum,f.migrationName,JSON.stringify({synthetic:true,appliedBy:'native-full49-test-runner',prismaEngineExecuted:false,ddlAndLedgerAtomic:false}),startedAt]);
   const ledger=await this.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" WHERE migration_name=$1',[f.migrationName]);
   if(ledger.rowCount!==1||ledger.rows[0]?.checksum!==f.checksum||!ledger.rows[0]?.finished_at||ledger.rows[0]?.rolled_back_at!==null)throw Error('TEST_LEDGER_READBACK_FAILED');
   await this.record('migration-committed-readback',ledger.rows);
   if(f.migrationName===COHORT)await this.execute(after,'synthetic-cohort-after');
  }
  const catalogSql=await readFile(join(this.inputRoot,'READ_FULL49_CATALOG.sql'),'utf8');
  await this.record('catalog-read-intent',{sqlSha256:hash(catalogSql),sql:catalogSql});
  const raw=await this.client.query(catalogSql);const results=Array.isArray(raw)?raw:[raw];
  const rows=results.flatMap(r=>r.rows);if(rows.length!==1)throw Error('CATALOG_READ_SHAPE');
  await this.record('full49-catalog',rows[0]);
  const catalog=Object.values(rows[0] as Record<string,unknown>)[0] as Record<string,unknown>;
  await writeFile(join(this.outputRoot,'catalog.json'),JSON.stringify(catalog,null,2)+'\n',{flag:'wx',mode:0o600});
  const expected=JSON.parse(await readFile(join(this.inputRoot,'CATALOG_EXPECTED.json'),'utf8'));
  const crypto=catalog.crypto as {name?:string;schema?:string}|null;
  if(!crypto||crypto.name!=='pgcrypto'||crypto.schema!=='extensions'||catalog.fencePresent!==false)throw Error('NATIVE_CRYPTO_OR_PREFENCE_REQUIRED');
  const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const funcs=catalog.functions as Record<string,unknown>;
  if(Object.keys(funcs).length!==Object.keys(expected.functions).length||Object.entries(expected.functions).some(([k,v])=>funcs[k]!==v))throw Error('FUNCTION_PROFILE_DRIFT');
  if(catalog.baselineCheckMd5!==expected.baselineCheckMd5||catalog.sourceGuardProsrcSha256!==expected.sourceGuardProsrcSha256)throw Error('SOURCE_GUARD_PROFILE_DRIFT');
  const triggers=catalog.triggers as Array<Record<string,unknown>>;
  if(triggers.length!==expected.triggers.length||expected.triggers.some((w:Record<string,unknown>)=>triggers.filter(t=>t.tableName===w.tableName&&t.name===w.name&&t.md5===w.md5&&t.enabled==='O'&&t.deferrable===true&&t.initiallyDeferred===true).length!==1))throw Error('TRIGGER_PROFILE_DRIFT');
  const ledger=catalog.ledger as Array<{migrationName:string;checksum:string;finished:boolean;rolledBack:boolean}>;
  if(ledger.length!==49||ledger.some(r=>!r.finished||r.rolledBack)||!eq(ledger.map(({migrationName,checksum})=>({migrationName,checksum})),manifest.prior49))throw Error('FINAL_LEDGER_DRIFT');
  this.replayDone=true;await this.record('replay-qualified',{scope:'NATIVE_FULL49_SCHEMA_ONLY',concurrencyPassed:false,publisherQualified:false});
 }
 assertReplayDone(){if(!this.replayDone)throw Error('REAL_FULL49_REPLAY_REQUIRED');}
 async openActor(label:'A'|'B'){
  this.assertReplayDone();
  const c=new Client({host:ALLOWED_SOCKET,port:55439,user:'agent',database:this.database,password:'',ssl:false,connectionTimeoutMillis:3000,statement_timeout:15000,idle_in_transaction_session_timeout:15000,query_timeout:20000,application_name:'jf-full49-actor-'+label+'-'+randomUUID()});
  await c.connect();
  return {query:async(sql:string,values?:unknown[])=>{
   const id=randomUUID();await this.record('actor-intent',{id,label,sqlSha256:hash(sql),sql,values:values??[]});
   try{const raw=values?await c.query(sql,values):await c.query(sql);const results=Array.isArray(raw)?raw:[raw];
    const outcome={ok:true as const,results:results.map(r=>({command:r.command,rowCount:r.rowCount,rows:r.rows}))};await this.record('actor-result',{id,label,...outcome});return outcome;
   }catch(error){const e=error as {code?:string;message?:string};const outcome={ok:false as const,code:e.code??null,message:e.message??String(error)};await this.record('actor-result',{id,label,...outcome});return outcome;}
  },close:()=>c.end()};
 }
 async close(){if(!this.closed){this.closed=true;await this.client.end();}}
}
