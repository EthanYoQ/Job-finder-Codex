// Local synthetic Novartis-only checks; uses frozen implementation and never official HTTP.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const base='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z',root=join(base,'hosts/portable42-novartis'),repo=join(base,'producer-source');
if(process.env.TSX_DISABLE_CACHE!=='1'||process.env.JOBFINDER_CLOUD_SOURCE_ID!=='source-novartis-social')throw Error('NOVARTIS_LOCAL_POLICY_ENV');
globalThis.fetch=async()=>{throw Error('NOVARTIS_LOCAL_POLICY_NETWORK_FORBIDDEN');};
const fromRepo=p=>import(pathToFileURL(join(repo,p)).href);
const {createPresenceCheckedHttpHtmlSourceFetch}=await fromRepo('src/crawler/httpHtmlSourceFetch.ts');
const {NOVARTIS_DEFAULT_ENTRY,NOVARTIS_PRESENCE_UNKNOWN,replayNovartisOfficialPresence,hasNovartisOfficialPresencePlan}=await fromRepo('src/crawler/novartisOfficialPresence.ts');
const {sourcePlanConfigSha256}=await fromRepo('src/crawler/sourcePlan.ts');
const {getSourceQualityPolicy,SOURCE_QUALITY_POLICY_ID}=await fromRepo('src/crawler/sourceQualityAdmission.ts');
const {runSourceCrawl}=await fromRepo('src/crawler/runSourceCrawl.ts');
const plan=JSON.parse(await readFile(join(root,'novartis/source-plan.json'))),cfg=JSON.parse(await readFile(join(root,'novartis/host-config.json')));
if(!hasNovartisOfficialPresencePlan(plan)||sourcePlanConfigSha256(plan)!==cfg.sourceConfigSha256||getSourceQualityPolicy(plan)!==SOURCE_QUALITY_POLICY_ID)throw Error('NOVARTIS_FROZEN_POLICY_BINDING');
const ids=['REQ-00000001','REQ-00000002'],extra='REQ-10086872',url=id=>'https://www.novartis.com.cn/careers/career-search/job/details/'+id.toLowerCase()+'-title';
function page(rows,active=1,pages=1,total=rows.length,sorted=false){
 const next=new URL(sorted?plan.source.officialEntryUrl:NOVARTIS_DEFAULT_ENTRY);next.searchParams.delete('country[]');next.searchParams.set('country[0]','LOC_CN');next.searchParams.set('page',String(active));
 return `<div class="view-header">Showing ${total} results</div><table class="views-table"><tbody>${rows.map(id=>`<tr><td class="views-field-field-job-title"><a href="${url(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`).join('')}</tbody></table><ul class="pagination"><li class="active"><a class="page-link" title="page ${active} active out of ${pages} pages">${active}</a></li><li><a rel="next" title="Go to next page" class="page-link btn ${active===pages?'disabled':''}" href="${active===pages?'':next.href}">Next</a></li></ul>`;
}
async function capture({defaultPages=[page(ids)],detail='<article>Job ID: '+extra+'<p>Responsibilities: perform the work listed in this official job description.</p><a href="https://platform.moseeker.com/m/customize/page/novartis?job_number='+extra+'">Apply to Job</a></article>',status=200,redirect}={}){
 const at=new Date().toISOString(),requests=[];
 const http=async request=>{requests.push(request.url);const detailPage=request.url.includes('/job/details/'),sorted=new URL(request.url).searchParams.has('sort'),index=Number(new URL(request.url).searchParams.get('page')??0);return {status:detailPage?status:200,finalUrl:detailPage?redirect??request.url:request.url,capturedAt:at,contentType:'text/html',body:detailPage?detail:sorted?page(ids,1,1,2,true):defaultPages[index]};};
 const fetched=await createPresenceCheckedHttpHtmlSourceFetch({http,now:()=>new Date(at)})(plan);
 return {fetched,requests};
}
const checks=[{check:'frozen Novartis exact source/config and source-quality admission binding',passed:true}];
const subset=await capture({defaultPages:[page([ids[0]],1,2,2),page([ids[0]],2,2,3)]});
if(!subset.fetched.ok)throw Error('NOVARTIS_SUBSET_FIXTURE_REJECTED');
const audit=JSON.parse(String(subset.fetched.fetchEvidence.artifacts.find(a=>a.logicalKey==='novartis-presence-audit').body));
if(audit.status!=='CONSISTENT'||audit.sortedUniqueCount!==2||audit.defaultObservedUniqueCount!==1||audit.defaultCompletenessClaim!==false||subset.fetched.fetchEvidence.fetchCounts.rawCount!==2)throw Error('NOVARTIS_DEFAULT_REPLACED_PRIMARY');
replayNovartisOfficialPresence(plan,subset.fetched.fetchEvidence);
checks.push({check:'default subset/repeats/total drift do not replace sorted set or assert default completeness',passed:true,synthetic:true,sortedUniqueCount:2,defaultUniqueCount:1});
for(const [name,options]of [['readable same-REQ detail',{}],['404',{status:404,detail:'404'}],['redirect to official search',{redirect:NOVARTIS_DEFAULT_ENTRY}],['different-REQ closure',{detail:'<article>Job ID: REQ-99999999 This job is no longer available</article>'}]]){
 const sample=await capture({...options,defaultPages:[page([...ids,extra])]});
 if(sample.fetched.ok||sample.fetched.failureReason!==NOVARTIS_PRESENCE_UNKNOWN||sample.requests.some(u=>u.includes('moseeker')))throw Error('NOVARTIS_UNKNOWN_NOT_PRESERVED:'+name);
 const result=await runSourceCrawl(plan,{fetch:async()=>sample.fetched,isBaseline:false});
 if(result.status!=='FAILED'||result.jobs.length||result.truth.completenessVerified)throw Error('NOVARTIS_CONFLICT_ADVANCED_LIFECYCLE:'+name);
 checks.push({check:'default-only REQ-10086872 with '+name+' remains UNKNOWN; no accepted observation/jobs',passed:true,synthetic:true});
}
const closed=await capture({defaultPages:[page([...ids,extra])],detail:'<article>Job ID: '+extra+' This job is no longer available</article>'});
if(!closed.fetched.ok||!replayNovartisOfficialPresence(plan,closed.fetched.fetchEvidence).closedUrls.has(url(extra)))throw Error('NOVARTIS_EXPLICIT_CLOSURE_FIXTURE');
checks.push({check:'only matching same-REQ explicit closure is accepted by frozen presence guard',passed:true,synthetic:true});
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,scope:'NOVARTIS_LOCAL_SYNTHETIC_SOURCE_GUARD_ONLY',checks,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,syntheticFixtures:true,realJobStatusDetermined:false,realJobCountDetermined:false,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false,fullTestSuiteRun:false};
await writeFile(join(root,'NOVARTIS_POLICY_CHECK_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true,count:checks.length,reportPath:join(root,'NOVARTIS_POLICY_CHECK_RESULTS.json')}));
