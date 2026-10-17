/** Offline full-packet regression. No database access or candidate changes.
 * Usage: tsx derived-members.test.mts <decoded-review.json> <original.sql>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';
import {compileAtomicJsonRecords,compileAtomicJsonDeclarations} from '../vendor/c60-source/src/db/atomicJsonDeclarations.ts';
const root=resolve(import.meta.dirname,'../../..'), sourcePath='tools/dot-auto-controller/vendor/c60-source/src/db/ingestionRepository.ts';
const [reviewPath,sqlPath]=process.argv.slice(2);assert(reviewPath&&sqlPath);
const packet=JSON.parse(fs.readFileSync(reviewPath,'utf8')),terminal=packet.terminal;
const beforeSource=execFileSync('git',['show','1e3ae4e5137f348cddf0b88e923913005ffbf625:'+sourcePath],{cwd:root,encoding:'utf8'}),afterSource=fs.readFileSync(resolve(root,sourcePath),'utf8');
const compile=(source:string)=>{
 const snippet=source.slice(source.indexOf('function compileAtomicWriteStatements('),source.indexOf('const LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL'));
 const js=ts.transpileModule(snippet+'\nreturn compileAtomicWriteStatements;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function('sqlRecords','fromPrismaJobCategory','fromPrismaRequiredJobField',js)(compileAtomicJsonRecords,(x:any)=>x,(x:any)=>x);
};
const oldCompile=compile(beforeSource),newCompile=compile(afterSource);
const group=packet.decoded.find((g:any)=>g.table==='LifecycleSetEvidenceMember');assert(group);const oldRows=group.rows;
const writes=oldRows.map(({id,...data}:any)=>({kind:'insert',stage:'LIFECYCLE_WRITE',model:'lifecycleSetEvidenceMember',data}));
const emit=(fn:any,rows:any[]=oldRows)=>{let n=0;const sql=fn(writes,()=>{},true,terminal.finishedAt,()=>rows[n++].id,terminal.completenessCertificate.members).join('\n');assert.equal(n,rows.length);return sql;};
const oldStatement=emit(oldCompile),newStatement=emit(newCompile);
const sort=(rows:any[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
for(const sourceName of ['hengrui','takeda','biogen']){
 const gate=fs.readFileSync(resolve(root,`tools/dot-auto-controller/native/${sourceName}-packet-gate.mts`),'utf8');
 const parser=gate.slice(gate.indexOf('function parseRows('),gate.indexOf('function verifyFullBody('));
 const js=ts.transpileModule(parser+'\nreturn parseRows;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const parse=new Function('assert','terminal',js)(assert,terminal);
 const prefix=/^INSERT INTO public\."LifecycleSetEvidenceMember" \(([^\n]+)\)\n          SELECT \1 FROM jsonb_populate_recordset\(NULL::public\."LifecycleSetEvidenceMember", /.exec(newStatement)!;assert(prefix);
 const decoded=parse(newStatement,prefix[0].length);assert.equal(newStatement.slice(decoded.end),');');assert.deepEqual(sort(decoded.rows),sort(oldRows));
 let n=0;const roundtrip=newCompile(decoded.rows.map((data:any)=>({kind:'insert',stage:'REVIEW',model:'lifecycleSetEvidenceMember',data})),()=>{},true,terminal.finishedAt,()=>decoded.rows[n++].id,terminal.completenessCertificate.members).join('\n');assert.equal(roundtrip,newStatement);
}
const oldSql=fs.readFileSync(sqlPath,'utf8');assert(oldSql.includes(oldStatement));
const compact=oldSql.replace(/DECLARE affected bigint; job_data jsonb; [\s\S]*? current_context jsonb;/,`DECLARE affected bigint; job_data jsonb; ${compileAtomicJsonDeclarations(terminal,packet.context)} current_context jsonb;`);
const next=compact.replace(oldStatement,newStatement);assert.equal(compact.split(oldStatement).length,2);assert.equal(next.replace(newStatement,''),compact.replace(oldStatement,''));
assert(Buffer.byteLength(next)<Buffer.byteLength(compact));
console.log(JSON.stringify({status:'PASS_OFFLINE_FULL_HENGRUI_EQUIVALENCE',memberRows:oldRows.length,allMemberValuesAndIdsEqual:true,allThreeReviewersRoundtrip:true,otherTransactionBytesUnchanged:true,oldMemberStatementBytes:Buffer.byteLength(oldStatement),newMemberStatementBytes:Buffer.byteLength(newStatement),beforeToolBodyBytes:Buffer.byteLength(JSON.stringify({project_id:'yiopvxysxrtrnvqxwgbx',query:compact})),afterToolBodyBytes:Buffer.byteLength(JSON.stringify({project_id:'yiopvxysxrtrnvqxwgbx',query:next}))},null,2));
