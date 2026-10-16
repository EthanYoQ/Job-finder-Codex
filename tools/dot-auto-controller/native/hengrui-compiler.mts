/** Fixed source-scoped adapter, retaining the exact original compiler. */
import {createExistingCompiler} from '../transport/hengrui-existing-compiler.mjs';
import {createHash} from 'node:crypto';
import {CLOUD_PILOT_SOURCE} from '../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {verifyNodeRuntimeProfile} from '../vendor/c60-source/scripts/verify-node-runtime-profile.ts';
import fs from 'node:fs';import assert from 'node:assert/strict';
import {verifyPins} from '../src/native-bindings.mjs';
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
export async function compilerForHengrui(route:any){
 if(route.sourceId!=='source-hengrui-social'||route.route!=='PORTABLE'||!Number.isSafeInteger(route.candidate?.version)||route.candidate.version<=49||CLOUD_PILOT_SOURCE.id!==route.sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==route.sourceConfigSha256)throw Error('HENGRUI_NATIVE_IDENTITY_ONLY');
 if(route.sourceConfigSha256!=="93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e")throw Error("HENGRUI_CONFIG_DRIFT");
 verifyPins(route);await verifyNodeRuntimeProfile();
 assert.deepEqual(createBuildIdentity(route.producer,route.build.commitSha),route.build,'CURRENT_NATIVE_BUILD_IDENTITY');
 const control=JSON.parse(fs.readFileSync(route.hostReference+'/control-base.json','utf8'));
 assertHengruiRegistration(route);
 assert.deepEqual(control.candidate,route.candidate);assert.deepEqual(control.build,route.build);assert.deepEqual(control.databaseIdentity,route.databaseIdentity);
 const compiler=await createExistingCompiler({runtimeRoot:route.producer,expectedBuild:route.build,expectedLockSha256:createHash('sha256').update(fs.readFileSync(route.producer+'/package-lock.json')).digest('hex'),expectedSourceId:route.sourceId,expectedSourceConfigSha256:route.sourceConfigSha256,expectedReaderCandidateId:route.candidate.id});return {compiler,control};
}

export function assertHengruiRegistration(route:any){
 const e=deriveCurrentStagedScheduleExpectation(route.build);
 assert.deepEqual(route.registration,{...route.candidate,...route.databaseIdentity,commitSha:route.build.commitSha,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount,status:'BUILDING'},'NATIVE_EXACT_16_FIELD_REGISTRATION');
}
