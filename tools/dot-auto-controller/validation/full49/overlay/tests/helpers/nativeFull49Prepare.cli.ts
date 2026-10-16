/** Explicit opt-in CLI; preparation only, never dispatches publisher/retirement SQL.
 * Native PG17 still requires separate execution authorization. No workflow is created.
 */
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NativeFull49Db} from './nativeFull49Db';
export async function renderNativeRetirement(inputRoot:string,fixtureRoot:string){
  const renderer=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../fixed-host/scripts/render-schema50-retirement.py');
  const bytes=await readFile(renderer),reference=await readFile(join(inputRoot,'render-schema50-retirement.reference.py'));
  if(createHash('sha256').update(bytes).digest('hex')!==createHash('sha256').update(reference).digest('hex'))throw Error('CANONICAL_RENDERER_DRIFT');
  const rendered=join(fixtureRoot,'retirement-rendered');
  const raw=execFileSync('python',[renderer,'--expected-candidate',join(fixtureRoot,'expected-candidate.json'),'--output-directory',rendered],{encoding:'utf8',timeout:15000});
  await writeFile(join(fixtureRoot,'renderer-return.json'),raw,{flag:'wx',mode:0o600});
  // Preserve canonical output. Native test copy changes ONLY the truthful ledger
  // provenance label; it does not claim that the official connector executed it.
  const canonical=await readFile(join(rendered,'RETIREMENT_TRANSACTION.sql'),'utf8');
  const originalLog='{"appliedBy":"official-connector","execution":"canonical-ddl-in-this-transaction","prismaEngineExecuted":false}';
  const testLog='{"appliedBy":"native-full49-test-runner","execution":"canonical-ddl-in-this-transaction","prismaEngineExecuted":false,"synthetic":true}';
  if(canonical.split(originalLog).length!==2)throw Error('EXACT_LEDGER_PROVENANCE_LITERAL_REQUIRED');
  const testSql=canonical.replace(originalLog,testLog);
  if(testSql.replace(testLog,originalLog)!==canonical)throw Error('TEST_METADATA_ONLY_TRANSFORM_REQUIRED');
  await writeFile(join(rendered,'RETIREMENT_TRANSACTION.native-synthetic.sql'),testSql,{flag:'wx',mode:0o600});
  await writeFile(join(rendered,'TEST_METADATA_TRANSFORM.json'),JSON.stringify({onlyChange:'ledger logs appliedBy + synthetic marker',canonicalSha256:createHash('sha256').update(canonical).digest('hex'),testSha256:createHash('sha256').update(testSql).digest('hex'),productionSqlModified:false,gatesModified:false},null,2)+'\n',{flag:'wx',mode:0o600});
  return rendered;
}
export async function main(argv:string[]){
 if(argv.length!==5||argv[0]!=='--run-authorized-local-synthetic-preparation')throw Error('Usage: --run-authorized-local-synthetic-preparation SOCKET EXISTING_EMPTY_DB INPUT_ROOT NEW_OUTPUT_DIR');
 const [,socket,database,inputRoot,outputRoot]=argv;
 if(!socket||!database||!inputRoot||!outputRoot)throw Error('ARGUMENTS');
 process.env.JOBFINDER_CLOUD_SOURCE_ID='source-hansoh-social';
 const {createNativeFull49PublisherFixture}=await import('./nativeFull49PublisherFixture');
 const db=await NativeFull49Db.open({socket,database,inputRoot,outputRoot,explicitLocalExecutionApproval:'RUN_NEW_EMPTY_LOCAL_TEST_DATABASE'});
 try{
  await db.replay49();
  const fixture=await createNativeFull49PublisherFixture(db);
  const rendered=await renderNativeRetirement(inputRoot,fixture.root);
  // Revalidate the real live-object compiler after rendering, not saved JSON.
  await fixture.recompile();
  if(Date.now()>=Date.parse(fixture.packet.expiresAt))throw Error('PREPARED_PACKET_EXPIRED');
  const result={status:'NATIVE_SCHEMA_AND_LIVE_FIXTURE_PREPARED_ONLY',synthetic:true,productionQualified:false,publisherDispatched:false,retirementDispatched:false,concurrencyPassed:false,root:fixture.root,expiresAt:fixture.packet.expiresAt,retirementDirectory:rendered};
  await writeFile(join(outputRoot,'PREPARATION_RESULT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));
 }finally{await db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
