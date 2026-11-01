/** Read-only matrix verification. No DB connection or reduced-fixture fallback. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyFull49,FULL49_CASES} from './nativeFull49Acceptance.cli';
export async function summarize(inputRoot:string,runsRoot:string){
 const manifest=JSON.parse(await readFile(join(inputRoot,'INPUT_MANIFEST.json'),'utf8'));
 const databases=new Set<string>(),results=[];
 for(const caseId of FULL49_CASES){
  const dir=join(runsRoot,caseId),e=JSON.parse(await readFile(join(dir,'FULL49_ACCEPTANCE_EVIDENCE.json'),'utf8'));
  if(e.case!==caseId||!/^jf_retirement_test_[a-z0-9_]+$/.test(e.database)||databases.has(e.database))throw Error('EXACT_DISTINCT_CASE_DATABASE_REQUIRED');databases.add(e.database);
  const files=await readdir(dir),ledgerFiles=files.filter(x=>x.endsWith('-migration-committed-readback.json'));
  if(ledgerFiles.length!==49||files.filter(x=>x.endsWith('-replay-qualified.json')).length!==1)throw Error('REAL_REPLAY_RECEIPTS_REQUIRED');
  const rows=(await Promise.all(ledgerFiles.map(async x=>JSON.parse(await readFile(join(dir,x),'utf8'))))).flat();
  rows.sort((a,b)=>a.migration_name.localeCompare(b.migration_name));
  if(rows.some(r=>!r.finished_at||r.rolled_back_at!==null)||JSON.stringify(rows.map(r=>({migrationName:r.migration_name,checksum:r.checksum})))!==JSON.stringify(manifest.prior49))throw Error('REPLAY_RECEIPT_MANIFEST_MISMATCH');
  results.push(classifyFull49(e));
 }
 return {status:'PASS_FULL49_NATIVE_MATRIX',cases:results,productionQualified:false,originalV75ExecutionTerminated:false,productionDatabaseChanged:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [inputRoot,runsRoot]=process.argv.slice(2);if(!inputRoot||!runsRoot)throw Error('Usage: INPUT_ROOT RUNS_ROOT');
 const result=await summarize(inputRoot,runsRoot);await writeFile(join(runsRoot,'MATRIX_RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
}
