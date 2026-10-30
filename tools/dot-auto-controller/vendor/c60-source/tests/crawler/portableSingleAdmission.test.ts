// Synthetic transport only; no production HTTP or database writes.
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureSyntheticGileadQuality} from '../helpers/gileadQualityFixture';
import {issueSourceQualityAdmission} from '../../src/crawler/sourceQualityAdmission';
import {makeArchiveBundle,restoreArchiveBundle} from '../../src/crawler/cloudSourcePilotRelay';
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function run(firstAdmission:boolean,mode='ok'){
 const root=await mkdtemp(join(tmpdir(),'single-admission-'));dirs.push(root);
 const input=await captureSyntheticGileadQuality(root);
 const bundle=await makeArchiveBundle({...input.archive,...input.binding,sourceId:input.plan.source.id});
 if(firstAdmission)expect((await issueSourceQualityAdmission(input)).status).toBe('ACCEPTED');
 const restored=await mkdtemp(join(root,'restored-'));
 input.archive={...input.archive,workspaceRoot:restored,artifacts:await restoreArchiveBundle(bundle,restored)};
 if(mode==='damaged-archive')await writeFile(join(restored,input.archive.artifacts[0]!.path),'damaged');
 if(mode==='changed-output')input.result.jobs[0]!.officialTitle='changed';
 if(mode==='expired')vi.setSystemTime(Date.now()+31*60_000);
 const result=await issueSourceQualityAdmission(input);
 expect(input.requests).toHaveLength(1);
 if(result.status==='REJECTED')return result;
 const receipt=structuredClone(result.receipt);receipt.acquisition.id='synthetic-comparison';
 return {status:result.status,receipt};
}
it('keeps equivalent admitted content after archive restoration with one issuance',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-30T00:00:00Z');
 expect(await run(false)).toEqual(await run(true));
});
it.each(['damaged-archive','changed-output','expired'])('still rejects %s after skipping duplicate issuance',async mode=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-30T00:00:00Z');
 const once=await run(false,mode);vi.setSystemTime('2026-10-30T00:00:00Z');const twice=await run(true,mode);
 expect(once.status).toBe('REJECTED');expect(once).toEqual(twice);
});
