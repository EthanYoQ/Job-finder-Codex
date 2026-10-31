import test from 'node:test';
import assert from 'node:assert/strict';
import {ajingaProjection} from '../src/crawler/sanofiNativeQuality.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';

function fixture() {
  return {info:{code:200,data:{data:{is_in_china:true,company:{id:13966,root_company:{id:13537}},
    job:{id:42,root_company_id:13537,company:{id:13966},i18n_name:'R1234567 Synthetic job',description:'<p>Verified synthetic duties</p>',job_visibility:'IE',job_locations:[]}}}},
    status:{code:200,data:{show_apply:1,normal_share_url:'https://www.ajinga.com/recruiting/company/13966/job/42/job-detail'}}};
}
const project=({info,status})=>ajingaProjection(info,status,'42','R1234567');

test('a bound Chinese application with no city keeps country and CITY_PENDING',()=>{
  const value=fixture(),before=JSON.stringify(value);
  assert.deepEqual(project(value),{locationRaw:'中国',cities:[CITY_PENDING]});
  assert.equal(JSON.stringify(value),before);
  value.info.data.data.job.job_locations=[{city:{cn_name:'上海'}}];
  assert.deepEqual(project(value),{locationRaw:'上海',cities:['上海']});
});

test('missing cities do not relax country, company, job, requisition or application identity',()=>{
  for(const change of [
    value=>value.info.data.data.is_in_china=false,
    value=>value.info.data.data.company.root_company.id=1,
    value=>value.info.data.data.job.root_company_id=1,
    value=>value.info.data.data.job.company.id=1,
    value=>value.info.data.data.job.id=43,
    value=>value.info.data.data.job.i18n_name='R7654321 Synthetic job',
    value=>value.info.data.data.job.job_visibility='HIDDEN',
    value=>value.status.data.show_apply=0,
    value=>value.status.data.normal_share_url='https://www.ajinga.com/recruiting/company/13966/job/43/job-detail',
    value=>value.info.data.data.job.job_locations=null,
    value=>value.info.data.data.job.job_locations=[{city:{cn_name:''}}]
  ]){const value=fixture();change(value);assert.equal(project(value),undefined);}
  const foreign=fixture();foreign.info.data.data.job.job_locations=[{city:{cn_name:'香港'}}];
  assert.throws(()=>project(foreign),/SANOFI_NATIVE_CHAIN_INVALID/);
});
