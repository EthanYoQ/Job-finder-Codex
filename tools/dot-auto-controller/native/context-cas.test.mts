/** One offline packet/reader regression; emits a READ ONLY PostgreSQL assertion. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
import {compileAtomicJsonDeclarations,compileAtomicJsonRecords} from '../vendor/c60-source/src/db/atomicJsonDeclarations.ts';
const root=path.resolve(import.meta.dirname,'../../..'),[reviewPath,sqlPath,output]=process.argv.slice(2);assert(reviewPath&&sqlPath&&output);
const {terminal,context}=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
const src=fs.readFileSync(path.join(root,'tools/dot-auto-controller/vendor/c60-source/src/db/cloudPilotSqlControl.ts'),'utf8');
const helper=src.slice(src.indexOf('function publicationContextDigestSql('),src.indexOf('/** Fixed control fragments'));
const js=ts.transpileModule(helper.replace('export function','function')+'\nreturn {publicationContextComparisonValue,publicationContextDigestSql};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const {publicationContextComparisonValue:compact,publicationContextDigestSql:digest}=new Function(js)();
assert.equal(compact(context),context);const current={...context,snapshotSha256:'a'.repeat(64)},expected=compact(current);
assert.deepEqual(Object.keys(expected),['sourceId','sourceConfigSha256','snapshotSha256']);assert.equal(current.jobs,context.jobs);
const names=['hengrui-','biogen-',''];for(const name of names){
 const m=await import(path.join(root,`tools/dot-auto-controller/transport/${name}reader-template.mjs`));
 const queryName=name==='hengrui-'?'hengrui':name==='biogen-'?'biogen':'takeda';
 const template=fs.readFileSync(path.join(root,`tools/dot-auto-controller/transport/queries/${queryName}-c60-reader-before.sql`),'utf8');
 const rendered=m.compileReviewedReaderSql(template,m.HISTORICAL_READER_CANDIDATE);
 assert.equal(rendered.replace(`(SELECT context || jsonb_build_object('snapshotSha256',${digest('context')}) FROM publication)`,'(SELECT context FROM publication)'),template);
}
// Test the database's jsonb representation, not a separately implemented JS hash.
const mutations=[['sourceId'],['sourceConfigSha256'],['jobs'],['latestAccepted'],['firstAccepted'],['candidateRow'],['sourceRow'],['companyRow']];
const compare=(expr:string)=>`${digest(expr)} IS DISTINCT FROM ${digest('expected_context_data')}`;
const sql=`BEGIN TRANSACTION READ ONLY;\nSET LOCAL statement_timeout='15000ms';\nDO $cas_test$\nDECLARE ${compileAtomicJsonDeclarations({},context)} changed jsonb;\nBEGIN\nIF ${compare('expected_context_data')} THEN RAISE EXCEPTION 'UNCHANGED_REJECTED'; END IF;\nchanged := expected_context_data || jsonb_build_object('checkedAt','2099-01-01T00:00:00Z');\nIF ${compare('changed')} THEN RAISE EXCEPTION 'CLOCK_ONLY_REJECTED'; END IF;\n${mutations.map(([key])=>`changed := jsonb_set(expected_context_data,'{${key}}','null'::jsonb); IF NOT (${compare('changed')}) THEN RAISE EXCEPTION 'CHANGED_${key}_ACCEPTED'; END IF;`).join('\n')}\nEND;\n$cas_test$;\nSELECT 'PASS_SAME_SNAPSHOT_ACCEPTED_CHANGED_FIELDS_REJECTED' AS result,${mutations.length} AS changed_fields;\nROLLBACK;`;
fs.writeFileSync(output,sql);
const oldSql=fs.readFileSync(sqlPath,'utf8'),beforeDeclaration=compileAtomicJsonDeclarations(terminal,context),afterDeclaration=compileAtomicJsonDeclarations(terminal,expected);
const ingestion=fs.readFileSync(path.join(root,'tools/dot-auto-controller/vendor/c60-source/src/db/ingestionRepository.ts'),'utf8');
const compilerCode=ingestion.slice(ingestion.indexOf('function compileAtomicWriteStatements('),ingestion.indexOf('const LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL'));
const mutationCompiler=new Function('sqlRecords','fromPrismaJobCategory','fromPrismaRequiredJobField',ts.transpileModule(compilerCode+'\nreturn compileAtomicWriteStatements;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(compileAtomicJsonRecords,(x:any)=>x,(x:any)=>x);
const review=JSON.parse(fs.readFileSync(reviewPath,'utf8')),members=review.decoded.find((g:any)=>g.table==='LifecycleSetEvidenceMember').rows;let idIndex=0;
const memberStatement=mutationCompiler(members.map(({id,...data}:any)=>({kind:'insert',stage:'REVIEW',model:'lifecycleSetEvidenceMember',data})),()=>{},true,terminal.finishedAt,()=>members[idIndex++].id,terminal.completenessCertificate.members).join('\n');
const memberStart=oldSql.indexOf('INSERT INTO public."LifecycleSetEvidenceMember"'),memberEnd=oldSql.indexOf('\nUPDATE public."CrawlBatchSourceResult" AS target',memberStart);assert(memberStart>=0&&memberEnd>memberStart);
const statementOld=oldSql.slice(memberStart,memberEnd),declarations=/DECLARE affected bigint; job_data jsonb; [\s\S]*? current_context jsonb;/;
const slim=oldSql.replace(declarations,`DECLARE affected bigint; job_data jsonb; ${afterDeclaration} current_context jsonb;`).replace(statementOld,memberStatement).replace("(current_context-'checkedAt') IS DISTINCT FROM (expected_context_data-'checkedAt')",`${digest('current_context')} IS DISTINCT FROM (expected_context_data->>'snapshotSha256')`);
const toolBodyBytes=Buffer.byteLength(JSON.stringify({project_id:'yiopvxysxrtrnvqxwgbx',query:slim}));
console.log(JSON.stringify({status:'PASS_OFFLINE_CONTEXT_CALLER_COMPATIBILITY',readerTemplates:3,afterCombinedToolBodyBytes:toolBodyBytes,templateBytesOtherwiseUnchanged:true,legacyContextFallback:true,fullContextUnmutated:true,oldDeclarationBytes:Buffer.byteLength(beforeDeclaration),newDeclarationBytes:Buffer.byteLength(afterDeclaration),removedDeclarationBytes:Buffer.byteLength(beforeDeclaration)-Buffer.byteLength(afterDeclaration),readOnlyAssertionSqlBytes:Buffer.byteLength(sql),originalSqlBytes:Buffer.byteLength(oldSql)},null,2));
