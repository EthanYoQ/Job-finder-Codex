import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {run,revive} from './check.mjs';
import {readPortablePublicSnapshot as oldRead} from '../inactive-reader-three-clones-20261018T0620Z/candidate/src/db/portablePublicSnapshotRepository.ts';
import {readPortablePublicSnapshot as freshRead} from './paired-candidate/src/db/portablePublicSnapshotRepository.ts';
import {JOB_SOURCE_UPDATE_FIELDS} from './candidate/src/domain/jobProjectionDeltaReceipt.ts';
import {toPrismaJobCategory} from './candidate/src/db/prismaMappers.ts';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const results=[];
for(const [source,stamp,total] of [['sanofi','20261018T073250999Z',119],['novo-nordisk','20261018T085417624Z',37]]){
 const parent='../takeda-original-recovery-20261017T0417Z/'+source,dir=parent+'/dot-auto-'+source+'-'+stamp;
 const before=read(parent+'/READER_BEFORE.json'),d=read(dir+'/review/PACKET_REVIEW.json.decoded.json'),review=read(dir+'/review/PACKET_REVIEW.json');
 const sql=read(dir+'/relay/'+review.requestId+'.request.json').payload.sql;
 function single(table){const re=new RegExp('INSERT INTO public\\."'+table+'" [^\\n]+FROM jsonb_populate_record\\(NULL::public\\."'+table+'",(E\'(?:\\\\\\\\|\'\'|[^\'\\\\])*\')::jsonb\\);','g');const f=[...sql.matchAll(re)];assert.equal(f.length,1);return JSON.parse(f[0][1].slice(2,-1).replace(/\\\\/g,'\\').replace(/''/g,"'"));}
 const get=table=>d.decoded.filter(x=>x.table===table).flatMap(x=>x.rows),jobs=[...before.jobs];
 for(const raw of get('Job')){const proposed={...raw,...raw.__update},i=jobs.findIndex(j=>j.sourceId===raw.sourceId&&j.dedupeKey===raw.dedupeKey);if(i<0){const{__update,...create}=raw;jobs.push({humanCorrectedTitle:null,humanCorrectedCategory:null,...create});}else if(JOB_SOURCE_UPDATE_FIELDS.some(k=>JSON.stringify(jobs[i][k])!==JSON.stringify(proposed[k])))jobs[i]={...jobs[i],...Object.fromEntries([...JOB_SOURCE_UPDATE_FIELDS,'lastSeenAt','sourceChangedAt'].map(k=>[k,proposed[k]]))};}
 const counts=Object.fromEntries([['transportAttempts','TransportAttemptEvidence'],['evidenceArtifacts','EvidenceArtifact'],['observations','CrawlObservation'],['paginationEvidence','PaginationEvidence'],['lossLedgerEntries','LossLedgerEntry'],['lifecycleSetMembers','LifecycleSetEvidenceMember']].map(([k,t])=>[k,get(t).length]));
 const after=revive({...before,jobs,results:[...before.results,{...single('CrawlBatchSourceResult'),...d.terminal,observations:get('CrawlObservation'),batch:{...single('CrawlBatch'),status:'SUCCESS',finishedAt:d.terminal.finishedAt},_count:counts}],members:[...before.members,...get('LifecycleSetEvidenceMember')],artifacts:[...before.artifacts,...get('EvidenceArtifact')]});
 for(const j of after.jobs){j.category=toPrismaJobCategory(j.category);if(j.humanCorrectedCategory!==null)j.humanCorrectedCategory=toPrismaJobCategory(j.humanCorrectedCategory);}
// The only expected option difference is the separately approved readonly timeout.
 const adapt=fn=>(db,...args)=>fn({$transaction:(f,o)=>db.$transaction(f,{...o,timeout:10000})},...args);
 const old=await run(oldRead,after,d.plan,new Date(Date.parse(d.terminal.finishedAt)+1000)),fresh=await run(adapt(freshRead),after,d.plan,new Date(Date.parse(d.terminal.finishedAt)+1000));
 assert.deepEqual(old,fresh);assert.equal(fresh.output.totalJobs,total);assert.equal(fresh.output.sources[0].state,'PUBLISHING');
 results.push({source,totalJobs:total,state:'PUBLISHING',closureRecords:after.closureRecords?.length??0,artifactRows:after.artifacts.length,fullOutputAndQueriesEqual:true});
}
console.log(JSON.stringify({pass:true,results,dbWrite:false,network:false}));
