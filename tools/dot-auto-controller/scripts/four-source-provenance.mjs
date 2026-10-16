/** Exact 36bd parent layer for fixed four-source state binding. Source-only. */
import {createHash} from 'node:crypto';
export const FOUR_BASE_COMMIT="36bd3c5a6052159cac47609bbc58750012b74eb0";
export const FOUR_DERIVATIVE_CLASS='FOUR_SOURCE_SEQUENCE_SOURCE_DERIVATIVE';
export const FOUR_SOURCE_PATHS=Object.freeze(["ops/cloud-pilot-host/connector-host-binding.mjs","ops/cloud-pilot-host/connector-host-launch.py"]);
export const FOUR_BASE_HASHES=Object.freeze({"ops/cloud-pilot-host/connector-host-binding.mjs":"c188e578ca1cdca7bfecb197789711365ff67125b50eda93f214370103f271a6","ops/cloud-pilot-host/connector-host-launch.py":"b043f68d7e6ed8694ff44c7da544382eec9ce2e782b641240fbd8e0c9478ceb7"});
const priorHashes=Object.freeze({"ops/cloud-pilot-host/connector-host-binding.mjs":"2fd5d4c3fd81899e90dd995a6c786b87a09f8290dbaa6babd711c99678ca9e50","ops/cloud-pilot-host/connector-host-launch.py":"bb529c4f9ed230d28b9d0c24e223701bf47cd3a48fd2c1d9d7722535b9df12b2"});
const sha=b=>createHash('sha256').update(b).digest('hex');
export function fourSourceProvenance(file){
 if(file.classification!==FOUR_DERIVATIVE_CLASS)return null;
 if(file.originCommit!==null||file.originSha256!==undefined||file.ancestorOriginCommit!==undefined||file.productionQualified!==false)throw Error('FOUR_SOURCE_LOCAL_ONLY');
 if(!FOUR_SOURCE_PATHS.includes(file.path)||file.derivativeBaseCommit!==FOUR_BASE_COMMIT||file.derivativeBaseSha256!==FOUR_BASE_HASHES[file.path]||file.priorProvenance?.path!==file.path||file.priorProvenance?.sha256!==file.derivativeBaseSha256||sha(JSON.stringify(file.priorProvenance))!==priorHashes[file.path])throw Error('FOUR_SOURCE_EXACT_36BD_ANCESTRY');
 return {kind:'four-source-sequence-source-derivative',originCommit:null,path:file.path,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:file.derivativeBaseCommit,derivativeBaseSha256:file.derivativeBaseSha256,priorProvenance:file.priorProvenance,productionQualified:false,newBuildQualificationRequired:true};
}
