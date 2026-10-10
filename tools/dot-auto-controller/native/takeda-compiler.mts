/** Fixed source-scoped adapter, retaining the exact original compiler. */
import {createExistingCompiler} from '../transport/existing-compiler.mjs';
import {createHash} from 'node:crypto';
import {CLOUD_PILOT_SOURCE} from '../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {verifyNodeRuntimeProfile} from '../vendor/c60-source/scripts/verify-node-runtime-profile.ts';
import fs from 'node:fs';import assert from 'node:assert/strict';
import {verifyPins} from '../src/native-bindings.mjs';
export async function compilerForTakeda(route:any){
 if(route.sourceId!=='source-takeda-china-social'||route.route!=='PORTABLE'||!Number.isSafeInteger(route.candidate?.version)||route.candidate.version<=49||CLOUD_PILOT_SOURCE.id!==route.sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==route.sourceConfigSha256)throw Error('TAKEDA_NATIVE_IDENTITY_ONLY');
 verifyPins(route);await verifyNodeRuntimeProfile();
 assert.deepEqual(createBuildIdentity(route.producer,route.build.commitSha),route.build,'CURRENT_NATIVE_BUILD_IDENTITY');
 const control=JSON.parse(fs.readFileSync(route.hostReference+'/control-base.json','utf8'));
 assert.deepEqual(control.candidate,route.candidate);assert.deepEqual(control.build,route.build);assert.deepEqual(control.databaseIdentity,route.databaseIdentity);
 const compiler=await createExistingCompiler({runtimeRoot:route.producer,expectedBuild:route.build,expectedLockSha256:createHash('sha256').update(fs.readFileSync(route.producer+'/package-lock.json')).digest('hex'),expectedSourceId:route.sourceId,expectedSourceConfigSha256:route.sourceConfigSha256,expectedReaderCandidateId:route.candidate.id});return {compiler,control};
}
