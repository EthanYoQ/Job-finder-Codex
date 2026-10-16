/** Explicit local review route; never database qualification or activation. */
import {CLOUD_PILOT_SQL45} from '../vendor/c60-source/src/db/cloudPilotSql45Manifest.ts';
import {JOB_DELTA_MIGRATION_NAME} from '../vendor/c60-source/src/db/jobProjectionDeltaProfile.ts';
import {V75_FENCE_MIGRATION_NAME,V75_FENCE_SCHEMA_SHA256} from '../vendor/c60-source/src/db/v75FenceProfile.ts';
export type ReviewDatabaseProfile='SQL49'|'SCHEMA50';
export function requireReviewDatabaseProfile(databaseIdentity:any,jobProjectionDelta:unknown,profile:ReviewDatabaseProfile='SQL49'){
 if(jobProjectionDelta!==true||CLOUD_PILOT_SQL45.migrations.length+1!==49)throw Error('REVIEW_BASE_49_PROFILE_REQUIRED');
 // Preserve the existing historical 49 route, including its compiler checks.
 // Schema50 is never inferred from untrusted migrationVersion or accepted here.
 if(profile==='SQL49'){
  if(databaseIdentity?.migrationVersion!==JOB_DELTA_MIGRATION_NAME)throw Error('REVIEW_EXISTING_49_PROFILE_REQUIRED');
  return;
 }
 if(profile==='SCHEMA50'){
  if(databaseIdentity?.migrationVersion!==V75_FENCE_MIGRATION_NAME||databaseIdentity.schemaHash!==V75_FENCE_SCHEMA_SHA256)throw Error('REVIEW_EXACT_50_PROFILE_REQUIRED');
  return;
 }
 throw Error('REVIEW_DATABASE_PROFILE_ROUTE_REQUIRED');
}
