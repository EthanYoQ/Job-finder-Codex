const fs=require('fs'), assert=require('assert/strict'), path=require('path');
const B=process.cwd(), C=path.dirname(__filename), D='original-relay-automation-20261017T0609Z', R='takeda-original-recovery-20261017T0417Z';
const old=fs.readFileSync(path.join(B,D,'run-original-functions.js'),'utf8'), neu=fs.readFileSync(path.join(C,D,'run-original-functions.js'),'utf8');
const make=(code,base)=>new Function('read','R','sourceId','routeById','config','control','sourceFolders','return (async()=>{'+code.slice(code.indexOf(' const compactSchema=')>=0?code.indexOf(' const compactSchema='):code.indexOf(' const template='),code.indexOf(' let before;'))+'return query;})()');
(async()=>{const rows=[];for(const sourceId of ['source-sanofi-china-social','source-bayer-healthcare-social','source-servier-china-social','source-viatris-social']){
const args=[sourceId,{[sourceId]:{route:'TRUE_B',companyId:'company-test'}},{sourceConfigSha256:'f'.repeat(64)},{candidate:{id:'test-candidate'}},{[sourceId]:'test-source'}];
const readOld=p=>fs.readFileSync(p,'utf8'), readNew=p=>fs.readFileSync(fs.existsSync(p.replace(B,C))?p.replace(B,C):p,'utf8');
const a=await make(old)(readOld,path.join(B,R),...args), b=await make(neu)(readNew,path.join(B,R),...args);
if(sourceId!=='source-bayer-healthcare-social')assert.equal(b,a);
assert(!b.includes('__ORIGINAL_'));
// Strip SQL quoted strings and comments before balancing nesting.
const stripped=b.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*/g,'');let depth=0;for(const ch of stripped){if(ch==='(')depth++;if(ch===')')assert(--depth>=0)}assert.equal(depth,0);
if(sourceId==='source-bayer-healthcare-social'){assert(b.includes("E'bayer-cn-dual-chain-attestation-v1'"));assert(b.includes('(false AND ((CASE'));assert(b.includes('AS "evidenceArtifacts"'));assert(b.includes('a."releaseCandidateId"=r."releaseCandidateId" AND a."batchId"=r."batchId" AND a."sourceResultId"=r.id AND a."sourceId"=r."sourceId"'));}
rows.push({sourceId,byteIdenticalOld: a===b,balanced:true,bytes:Buffer.byteLength(b)});
}console.log(JSON.stringify(rows,null,2));})().catch(e=>{console.error(e);process.exitCode=1});
