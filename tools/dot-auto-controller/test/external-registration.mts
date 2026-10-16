/** Offline only: original native derivation, no database/authority/capture. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
process.env.JOBFINDER_CLOUD_SOURCE_ID='source-takeda-china-social';
const {assertTakedaRegistration}=await import('../native/takeda-compiler.mts');
const {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION}=await import('../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts');
const build:any={schemaVersion:2,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};build.contentSha256=createHash('sha256').update(JSON.stringify(build)).digest('hex');
const candidate={id:'offline-only-exact-native',goalId:'jobfinder-portable-required-40',version:74};
const databaseIdentity={migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',dbSnapshotHash:'e'.repeat(64)};
const e=deriveCurrentStagedScheduleExpectation(build);
const route:any={build,candidate,databaseIdentity,registration:{...candidate,...databaseIdentity,commitSha:build.commitSha,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount,status:'BUILDING'}};
assertTakedaRegistration(route);
for(const key of Object.keys(route.registration)){const changed=structuredClone(route);changed.registration[key]=typeof changed.registration[key]==='number'?changed.registration[key]+1:(key.endsWith('Hash')?'0'.repeat(64):'changed');assert.throws(()=>assertTakedaRegistration(changed),/NATIVE_EXACT_16_FIELD_REGISTRATION/);}
console.log(JSON.stringify({status:'ORIGINAL_NATIVE_REGISTRATION_BINDING_PASS',positive:1,negativeFields:16,network:false,database:false}));
