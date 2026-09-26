import { createHash } from "node:crypto";
import { candidateCompanies } from "../data/companyRegistry";
import { assertExactConfirmedCompanyRosterV3, confirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { getStartupReleaseMembership } from "../crawler/releaseMembershipAuthority";
import { getStartupSourceSurfaceOracle } from "../crawler/sourceSurfaceOracleAuthority";
import { validateAuthoritativeReleaseMembership, releaseMembersFromPlans } from "../crawler/authoritativeReleaseMembership";
import { validateIndependentSourceSurfaceOracle } from "../crawler/independentSourceSurfaceOracle";
import { activeSourcePlanSha256, buildSourceCrawlPlans } from "../crawler/sourcePlan";
import { buildPendingRuntimeBatch } from "../crawler/runtimeAtomicEvidence";
import { hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import { DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS } from "../domain/publicationEligibility";
import type { StrictReadinessExpectation } from "./strictPersistedReadiness";
import {resolveCurrentBuildIdentity} from "./buildIdentity";
import { REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES } from "../crawler/completenessCertificate";
import { REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES } from "../crawler/traversalCertificate";

export const CURRENT_RELEASE_FRESHNESS_MAXIMUM_MS = DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS;

export async function loadCurrentReleaseIdentity(validationTime:Date=new Date()):Promise<StrictReadinessExpectation>{
  const buildIdentity=resolveCurrentBuildIdentity();
  const [membership,oracle]=await Promise.all([getStartupReleaseMembership(),getStartupSourceSurfaceOracle()]);
  const plans=buildSourceCrawlPlans(candidateCompanies);
  assertExactConfirmedCompanyRosterV3(candidateCompanies.map(company=>({id:company.id,category:company.category})));
  const artifact=membership.artifact;
  assertCurrentReleaseRosterHash(artifact.rosterSha256,oracle.artifact.rosterSha256);
  const commitSha=buildIdentity.commitSha;
  if(commitSha!==artifact.commitSha)throw new Error("Running Git commit does not match trusted release identity");
  if(buildIdentity.sourceTreeSha256!==artifact.sourceTreeSha256)throw new Error("Executable source tree does not match trusted release identity");
  if(buildIdentity.runtimeTreeSha256!==artifact.runtimeTreeSha256)throw new Error("Production runtime tree does not match trusted release identity");
  if(activeSourcePlanSha256(plans)!==artifact.sourcePlanSha256)throw new Error("Current canonical source plan does not match trusted release identity");
  const plannedSourceIds=plans.map(x=>x.source.id).sort();
  const runtime={releaseCandidateId:artifact.releaseCandidateId,commitSha,rosterSha256:artifact.rosterSha256,
    sourcePlanSha256:artifact.sourcePlanSha256,sourceConfigSha256:artifact.sourceConfigSha256,
    adapterBundleSha256:artifact.adapterBundleSha256,batchKind:"FULL_RELEASE" as const,ownerId:"strict-readiness",
    expectedPlannedSourceIds:plannedSourceIds,expectedPlannedSourceSetSha256:hashCanonicalStringSet(plannedSourceIds),expectedPlannedSourceCount:plannedSourceIds.length};
  const releaseMembers=validateAuthoritativeReleaseMembership(membership,runtime,releaseMembersFromPlans(plans));
  const validatedOracle=validateIndependentSourceSurfaceOracle(oracle,membership,runtime,plans,validationTime);
  const pending=buildPendingRuntimeBatch("current-release-identity",plans,runtime,new Date(0),undefined,oracle);
  const sourceConfigHashes=Object.fromEntries(pending.sources.map(x=>[x.sourceId,x.sourceConfigHash]));
  const adapterVersions=Object.fromEntries(pending.sources.map(x=>[x.sourceId,x.adapterVersion]));
  if(mapSha(sourceConfigHashes)!==artifact.sourceConfigSha256||mapSha(adapterVersions)!==artifact.adapterBundleSha256)
    throw new Error("Current canonical config or adapter bundle does not match trusted release identity");
  return {...runtime,plannedSourceIds,plannedSourceSetSha256:runtime.expectedPlannedSourceSetSha256,
    sourceConfigHashes,adapterVersions,companyAudits:validatedOracle.artifact.companyAudits,releaseMembers,
    requiredAGradeCertificates:REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES,
    requiredBGradeCertificates:REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES,
    sourceTreeSha256:buildIdentity.sourceTreeSha256,runtimeTreeSha256:buildIdentity.runtimeTreeSha256,
    currentTime:validationTime,freshnessMaximum:CURRENT_RELEASE_FRESHNESS_MAXIMUM_MS};
}
export function assertCurrentReleaseRosterHash(membershipRosterSha256:string,oracleRosterSha256:string):void{
  if(membershipRosterSha256!==confirmedCompanyRosterV3.membersSha256||oracleRosterSha256!==confirmedCompanyRosterV3.membersSha256){
    throw new Error("Current release membership/oracle roster hash does not match confirmed V3 roster");
  }
}
function mapSha(value:Readonly<Record<string,string>>){return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))))),"utf8").digest("hex");}
