/** Exact two-parent local source integration. Never runtime or production authority. */
import {createHash} from 'node:crypto';
import {legacyCompletenessGuardSourceProvenance} from './legacy-completeness-guard-source-provenance.mjs';
import {viatrisSourceProvenance} from './viatris-source-provenance.mjs';
export const INTEGRATION_SHARED_PARENT='36a03b847f66e8d68d68e2cff1f00fd6b4b83b51';
export const INTEGRATION_VIATRIS_PARENT='bf192cdce3d3b13347ab51ca3b26120786d55544';
export const INTEGRATION_PILOT='scripts/p0-cloud-portable-source-pilot.ts';
export const INTEGRATION_CLASS='VIATRIS_SHARED_INTEGRATION_SOURCE_DERIVATIVE';
export const INTEGRATION_EXPECTED=Object.freeze({"path":"scripts/p0-cloud-portable-source-pilot.ts","classification":"VIATRIS_SHARED_INTEGRATION_SOURCE_DERIVATIVE","originCommit":null,"sourceStatus":"LOCAL_UNREGISTERED","productionQualified":false,"derivativeBaseCommit":"36a03b847f66e8d68d68e2cff1f00fd6b4b83b51","derivativeBaseSha256":"af108f4cdb9b938658a3e794e0059d2a89cbfafa37c2f6c9d349795e41adfebf","derivativeBaseGitBlobSha1":"efebd06896dc74014206c43cd9a99202f5872084","priorProvenanceSha256":"ca78f459f1dee4a63afe6cad39008a85e86ef12f59b9c1595228a629ef746065","incomingViatrisCommit":"bf192cdce3d3b13347ab51ca3b26120786d55544","incomingViatrisSha256":"1b54102201898eac56dbdabaf92ab9719162353cd9086b224fff75c76eb6610c","incomingViatrisGitBlobSha1":"b633bdcc43a714173c468f3f5148e1e75d70af69","incomingViatrisProvenanceSha256":"3d4884c96fb687f0e62ae809aba178f54a08e01577c671c6cbc8ed4afdb51603","sha256":"2b03ca5aba5b79394a9c755089c74ab6a15857994735e213dfc9811bc3bcf268","bytes":26817});
const sha=x=>createHash('sha256').update(x).digest('hex');
export function viatrisSharedIntegrationSourceProvenance(file){
 if(file.classification!==INTEGRATION_CLASS)return null;
 const allowed=[...Object.keys(INTEGRATION_EXPECTED),'priorProvenance','incomingViatrisProvenance'];
 if(Object.keys(file).length!==allowed.length||Object.keys(file).some(k=>!allowed.includes(k)))throw Error('VIATRIS_SHARED_INTEGRATION_EXACT_KEYS');
 for(const [key,value] of Object.entries(INTEGRATION_EXPECTED))if(file[key]!==value)throw Error('VIATRIS_SHARED_INTEGRATION_EXACT_'+key);
 if(sha(JSON.stringify(file.priorProvenance))!==file.priorProvenanceSha256||!legacyCompletenessGuardSourceProvenance(file.priorProvenance))throw Error('VIATRIS_SHARED_INTEGRATION_SHARED_ANCESTRY');
 if(sha(JSON.stringify(file.incomingViatrisProvenance))!==file.incomingViatrisProvenanceSha256||!viatrisSourceProvenance(file.incomingViatrisProvenance))throw Error('VIATRIS_SHARED_INTEGRATION_VIATRIS_ANCESTRY');
 return {kind:'viatris-shared-integration-source-derivative',...file,newBuildQualificationRequired:true};
}
