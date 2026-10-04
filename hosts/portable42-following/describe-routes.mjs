import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const base='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z',root=join(base,'hosts/portable42-following'),repo=join(base,'producer-source');
globalThis.fetch=async()=>{throw Error('ROUTE_DESCRIPTION_NETWORK_FORBIDDEN');};
const imp=p=>import(pathToFileURL(join(repo,p)).href);
const {deriveCurrentStagedScheduleExpectation}=await imp('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await imp('src/crawler/sourcePlan.ts');
const {PORTABLE_REFRESH_SOURCE_IDS,assertPortableRefreshPlan}=await imp('scripts/p0-cloud-portable-source-pilot.ts');
const {requiresBGradeTraversalCertificate}=await imp('src/crawler/traversalCertificate.ts');
const build=JSON.parse(await readFile(join(base,'RESTORED_BUILD_IDENTITY.json'),'utf8'));
const state=JSON.parse(await readFile(join(base,'PUBLISHER-ACTIVE-STATE.json'),'utf8'));
const plans=deriveCurrentStagedScheduleExpectation(build).plans;
const rows=JSON.parse(await readFile(join(root,'latest-36-due-readback.json'),'utf8'));
for(const row of rows){
 const plan=plans.find(p=>p.source.id===row.sourceId);if(!plan)throw Error('MISSING_PLAN');
 row.currentSourceConfigSha256=sourcePlanConfigSha256(plan);
 row.currentConfigMatchesTuple=row.currentSourceConfigSha256===row.sourceConfigHash;
 row.route=PORTABLE_REFRESH_SOURCE_IDS.includes(row.sourceId)?'PORTABLE':requiresBGradeTraversalCertificate(plan)?'B':'A';
 if(row.route==='PORTABLE')assertPortableRefreshPlan(plan);
 row.executionHold=state.sourceExecutionHolds?.[row.sourceId]??state.blockedSourceNotes?.[row.sourceId]??null;
 row.alreadyPreparedExistingHost=['source-bayer-healthcare-social','source-organon-china-social'].includes(row.sourceId);
 row.preparedHere=['source-ucb-china-social','source-qilu-social','source-novo-nordisk-china-social'].includes(row.sourceId);
 if(!row.currentConfigMatchesTuple&&!row.executionHold)throw Error('UNEXPLAINED_SOURCE_CONFIG_DRIFT:'+row.sourceId);
}
await writeFile(join(root,'DUE_SOURCE_ROUTE_INVENTORY.json'),JSON.stringify(rows,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({count:rows.length,checkedAt:rows[0].checkedAt,rows:rows.map(r=>({sourceId:r.sourceId,due:r.nextEligibleAt,route:r.route,hold:Boolean(r.executionHold),configMatches:r.currentConfigMatchesTuple}))}));
