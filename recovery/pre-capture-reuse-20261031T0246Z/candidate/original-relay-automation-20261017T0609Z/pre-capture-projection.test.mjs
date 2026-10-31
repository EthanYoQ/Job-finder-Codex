import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const B='/workspace/scratch/5e9614251709',V=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source';
const entry=fs.readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const routes=JSON.parse(fs.readFileSync(new URL('./sources.json',import.meta.url))).rows;
const folders=JSON.parse(entry.match(/const sourceFolders=(\{[^\n]+\});/)[1].replaceAll("'",'"'));
const control=JSON.parse(fs.readFileSync(B+'/takeda-original-recovery-20261017T0417Z/hengrui/control-base.json'));
const queryLine=entry.split('\n').find(line=>line.startsWith(' const query=template.replaceAll('));assert(queryLine);
const build=new Function('template','compactSchema','sourceId','routeById','config','control','sourceFolders',queryLine+'return query;');
const normalize=sql=>sql.split(/((?:E)?'(?:''|[^'])*')/).map((s,i)=>i%2?s:s.replace(/\s+/g,'')).join('');
// Fold only the existing template's explicit constant-policy disjunction.
const certificate="(CASE WHEN r.\"completenessCertificate\"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r.\"completenessCertificate\"->'legacyCertificate' ELSE r.\"completenessCertificate\" END)";
function foldConstants(sql,portable){
 const policy=certificate+"->>'policyId'=E'PLAN_BOUND_SOURCE_QUALITY_V1'";
 const clause=' AND (NOT '+portable+' OR '+policy+')';assert(sql.includes(clause));
 sql=sql.replace(clause,portable?' AND '+policy:'');
 // Bayer's template disables the unchanged Sanofi legacy-artifact branch.
 const start=sql.indexOf(' OR\n (false AND');
 if(start>=0){
  let depth=0,quoted=false,end=-1;
  for(let i=sql.indexOf('(',start);i<sql.length;i++){
   const c=sql[i];if(c==="'"){if(quoted&&sql[i+1]==="'"){i++;continue;}quoted=!quoted;continue;}
   if(quoted)continue;if(c==='(')depth++;if(c===')'&&--depth===0){end=i+1;break;}
  }
  assert(end>start);sql=sql.slice(0,start)+sql.slice(end);
 }
 return sql;
}
const compileCode=`import fs from 'node:fs';const m=await import(${JSON.stringify(V+'/src/db/cloudPilotSqlControl.ts')});const c=JSON.parse(process.argv[1]);console.log(JSON.stringify({sourceConfigSha256:m.CLOUD_PILOT_SOURCE.sourceConfigSha256,sql:m.compileCloudPilotPublicationContextSql(c,process.argv[2]==='PORTABLE'?'PLAN_BOUND_SOURCE_QUALITY_V1':undefined)}));`;
for(const row of routes){
 const compactSchema={'source-sanofi-china-social':'sanofi-cn-dual-chain-attestation-v1','source-bayer-healthcare-social':'bayer-cn-dual-chain-attestation-v1'}[row.sourceId];
 const template=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/'+(compactSchema?'sanofi-reader-before-original.sql':'viatris-reader-before-original.sql'),import.meta.url),'utf8');
 const query=build(template,compactSchema,row.sourceId,{[row.sourceId]:row},row,control,folders);
 const actual=JSON.parse(execFileSync(B+'/connector-host-runtime/node',['--import',V+'/node_modules/tsx/dist/loader.mjs','--input-type=module','-e',compileCode,JSON.stringify(control),row.route],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:row.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',PYTHONDONTWRITEBYTECODE:'1'}}));
 assert.equal(row.sourceConfigSha256,actual.sourceConfigSha256,row.sourceId+' current plan');
 const selected=query.slice(query.indexOf('WITH matching AS ('),query.indexOf('\n), latest_writer AS ('));
 const compiled=actual.sql.slice(actual.sql.indexOf('WITH matching AS ('),actual.sql.lastIndexOf(') snapshot;'));
 assert.equal(normalize(foldConstants(selected,row.route==='PORTABLE')),normalize(compiled),row.sourceId+' full publicationContext projection');
 console.log('PASS: '+row.sourceId+' '+row.route+' exact projection after fixed constant folding');
}
console.log('PASS: all '+routes.length+' routes retain the original compiler projection; no SQL execution or network');
