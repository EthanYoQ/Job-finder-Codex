import { getPortableSourceCoverageHold } from "../release/portableSourceCoverageHolds";
import path from "node:path";
import { createPrismaCrawlRuntimeDeps } from "../db/crawlRuntimeRepository";
import { syncLaunchCohortSourcesToDb } from "../db/companyRegistrySync";
import { createPortableFencedRuntimeDatabase } from "../db/portableRuntimeDatabase";
import { withPortableCrawlLease, type PortableLeaseDatabase } from "./portableCrawlLease";
import { SOURCE_QUALITY_POLICY_ID, createOwnedSourceQualityFetch, getSourceQualityPolicy } from "./sourceQualityAdmission";
import { resolveCurrentStagedScheduleAuthority, type CurrentStagedScheduleAuthority } from "./stagedScheduleAuthority";
import { runP0CrawlBatch, type RunP0CrawlBatchDeps } from "./runCrawlBatch";
import { getPortableCoverageScope } from "../release/portableCoveragePolicy";

/** Canonical 41-source scheduled route. The existing candidate still binds code,
 * configuration and roster, but legacy browser paths/QA-round ceremony do not
 * decide whether a strictly verified individual source may be published. */
export async function runPortableScheduledCrawl(input: {
  db: object; leaseDb: PortableLeaseDatabase; workspaceRoot: string; force?: boolean;
  resolveAuthority?: (db: never) => Promise<CurrentStagedScheduleAuthority>;
  runBatch?: typeof runP0CrawlBatch;
}) {
  // A publication can occupy the primary pool for 120s. Lease control must
  // have its own pool so renewal can wait on the row, not for that connection.
  if(!input.leaseDb||input.db===input.leaseDb)throw new Error("PORTABLE_SEPARATE_LEASE_CLIENT_REQUIRED");
  const workspaceRoot=path.resolve(input.workspaceRoot);
  return withPortableCrawlLease(input.leaseDb,async lease=>{
    const db=createPortableFencedRuntimeDatabase(input.db,lease);
    const authority=await (input.resolveAuthority??resolveCurrentStagedScheduleAuthority)(db as never);
    const coverage=getPortableCoverageScope();
    if(authority.plans.length!==41||authority.identity.expectedPlannedSourceCount!==41)
      throw new Error("PORTABLE_EXACT_LAUNCH_COHORT_REQUIRED");
    const synced=await syncLaunchCohortSourcesToDb(authority.plans,authority.companies,db as never);
    const runtime=createPrismaCrawlRuntimeDeps(db as never,{portablePlans:authority.plans});
    const ownedFetch=createOwnedSourceQualityFetch();
    const priority=["source-cspc-social","source-qilu-social"];
    const orderedPlans=[...authority.plans].sort((a,b)=>(priority.includes(a.source.id)?priority.indexOf(a.source.id):2)-(priority.includes(b.source.id)?priority.indexOf(b.source.id):2));
    const result=await (input.runBatch??runP0CrawlBatch)(orderedPlans,{
      db:db as RunP0CrawlBatchDeps["db"],...runtime,
      identity:authority.identity,now:()=>new Date(),force:input.force===true,
      sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,portableLease:lease,
      workspaceRoot,evidenceSubdirectory:"portable-quality/runtime-evidence",
      fetch:(plan,tracker)=>coverage.exclusions.some(excluded=>excluded.sourceId===plan.source.id)
        ? Promise.resolve({ok:false as const,capturedAt:new Date().toISOString(),failureReason:"USER_AUTHORIZED_COVERAGE_EXCLUSION"})
        : getPortableSourceCoverageHold(plan.source.id)
          ? Promise.resolve({ok:false as const,capturedAt:new Date().toISOString(),failureReason:getPortableSourceCoverageHold(plan.source.id)!})
        : getSourceQualityPolicy(plan) ? ownedFetch(plan,tracker)
          : Promise.resolve({ok:false as const,capturedAt:new Date().toISOString(),failureReason:"SOURCE_QUALITY_POLICY_NOT_REVIEWED"})
    });
    return {policyId:SOURCE_QUALITY_POLICY_ID,coverage,identity:authority.identity,synced,result};
  });
}
