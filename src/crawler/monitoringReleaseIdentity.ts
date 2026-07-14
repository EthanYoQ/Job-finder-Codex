import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashCanonicalStringSet } from "./runtimeBatchIdentity";
import type { CrawlEvidenceIdentity } from "./crawlSummary";
import { signedProvenancePayloadSha256 } from "./reviewerSignatureCore";
import { verifyProductionProvenanceSignature } from "./reviewerSignatureTrust";
import type { SignedProvenanceEnvelope } from "./reviewerSignatureCore";
import { validateAuthoritativeReleaseMembershipArtifactContent } from "./authoritativeReleaseMembership";
import { validateIndependentSourceSurfaceOracleArtifactContent } from "./independentSourceSurfaceOracle";

const IDENTITY_FIELDS=["releaseCandidateId","commitSha","rosterSha256","sourcePlanSha256",
  "sourceConfigSha256","adapterBundleSha256"] as const;
const PIN_NAMES={releaseCandidateId:"P0_RELEASE_CANDIDATE_ID",commitSha:"P0_RELEASE_COMMIT_SHA",
  rosterSha256:"P0_RELEASE_ROSTER_SHA256",sourcePlanSha256:"P0_RELEASE_SOURCE_PLAN_SHA256",
  sourceConfigSha256:"P0_RELEASE_SOURCE_CONFIG_SHA256",adapterBundleSha256:"P0_RELEASE_ADAPTER_BUNDLE_SHA256",
  plannedSourceSetSha256:"P0_RELEASE_PLANNED_SOURCE_SET_SHA256",plannedSourceCount:"P0_RELEASE_PLANNED_SOURCE_COUNT"} as const;

interface MonitoringIdentityDeps {
  verifyProvenanceSignature:(envelope:SignedProvenanceEnvelope,context:{runtimeCommitSha:string;adapterBundleSha256:string})=>void
  validateMembershipContent:(artifact:never)=>unknown;
  validateOracleContent:(artifact:never,validationTime:Date)=>unknown;
}
const productionDeps:MonitoringIdentityDeps={verifyProvenanceSignature:verifyProductionProvenanceSignature,
  validateMembershipContent:validateAuthoritativeReleaseMembershipArtifactContent,
  validateOracleContent:validateIndependentSourceSurfaceOracleArtifactContent};
export async function loadMonitoringReleaseIdentity(env:NodeJS.ProcessEnv,deps:Partial<MonitoringIdentityDeps>={},validationTime:Date=new Date()):Promise<CrawlEvidenceIdentity>{
  const runtimeDeps={...productionDeps,...deps};
  const membershipPath=required(env,"P0_FULL_RELEASE_MEMBERSHIP_FILE");
  const membershipFileSha=shaPin(env,"P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256");
  const oraclePath=required(env,"P0_FULL_RELEASE_ORACLE_FILE");
  const oracleFileSha=shaPin(env,"P0_FULL_RELEASE_ORACLE_FILE_SHA256");
  const expected={...Object.fromEntries(Object.entries(PIN_NAMES).map(([field,name])=>[field,
    field==="plannedSourceCount"?positiveInteger(env,name):field==="releaseCandidateId"?required(env,name):
      field==="commitSha"?commitPin(env,name):shaPin(env,name)])),batchKind:"FULL_RELEASE" as const} as unknown as CrawlEvidenceIdentity;
  const buildPath=env.P0_BUILD_IDENTITY_FILE??resolve(process.cwd(),"build-identity.json");
  const [membershipBytes,oracleBytes,buildBytes]=await Promise.all([readFile(membershipPath),readFile(oraclePath),readFile(buildPath)]);
  assertDigest(membershipBytes,membershipFileSha,"membership");
  assertDigest(oracleBytes,oracleFileSha,"oracle");
  const membership=parseObject(membershipBytes,"membership"),oracle=parseObject(oracleBytes,"oracle"),build=parseObject(buildBytes,"build identity");
  if(membership.schemaVersion!==6||membership.kind!=="FULL_RELEASE"||oracle.schemaVersion!==3||oracle.kind!=="FULL_RELEASE"||build.schemaVersion!==2)
    throw new Error("Monitoring release authority schema is invalid");
  runtimeDeps.validateMembershipContent(membership as never);
  runtimeDeps.validateOracleContent(oracle as never,validationTime);
  for(const field of IDENTITY_FIELDS){
    if(membership[field]!==expected[field]||oracle[field]!==expected[field])throw new Error(`Monitoring release identity mismatch: ${field}`);
  }
  if(build.commitSha!==expected.commitSha||build.sourceTreeSha256!==membership.sourceTreeSha256||
      build.runtimeTreeSha256!==membership.runtimeTreeSha256||!validSha(build.contentSha256 as unknown))
    throw new Error("Monitoring baked build identity mismatch");
  const buildContent={schemaVersion:build.schemaVersion,commitSha:build.commitSha,sourceTreeSha256:build.sourceTreeSha256,runtimeTreeSha256:build.runtimeTreeSha256};
  if(digest(Buffer.from(JSON.stringify(buildContent),"utf8"))!==build.contentSha256)throw new Error("Monitoring baked build identity content mismatch");
  const oracleAuthority=parseObjectValue(membership.oracleAuthority,"membership oracle authority");
  if(oracleAuthority.oracleRawFileSha256!==oracleFileSha)throw new Error("Monitoring oracle raw-file binding mismatch");
  const reviewSignature=parseObjectValue(oracle.reviewProvenanceSignature,"oracle review signature");
  const hopSignature=parseObjectValue(oracle.hopChainProvenanceSignature,"oracle hop signature");
  const reviewPayload=parseObjectValue(reviewSignature.payload,"oracle review payload");
  const hopPayload=parseObjectValue(hopSignature.payload,"oracle hop payload");
  if(oracle.authoritativeMembershipDigest!==membership.memberSetSha256||
      oracleAuthority.oracleContentSha256!==oracle.contentSha256||
      oracleAuthority.reviewProvenanceRootSha256!==oracle.reviewProvenanceRootSha256||
      oracleAuthority.hopChainProvenanceRootSha256!==oracle.hopChainProvenanceRootSha256||
      oracleAuthority.producerIdentity!==oracle.producerIdentity||
      oracleAuthority.reviewKeyId!==reviewSignature.keyId||oracleAuthority.hopChainKeyId!==hopSignature.keyId||
      oracleAuthority.reviewSignedPayloadSha256!==signedProvenancePayloadSha256(reviewPayload as never)||
      oracleAuthority.hopChainSignedPayloadSha256!==signedProvenancePayloadSha256(hopPayload as never)||
      reviewPayload.purpose!=="REVIEW"||hopPayload.purpose!=="HOP_CHAIN"||
      reviewPayload.provenanceRootSha256!==oracle.reviewProvenanceRootSha256||
      hopPayload.provenanceRootSha256!==oracle.hopChainProvenanceRootSha256||
      reviewPayload.authoritativeMembershipDigest!==oracle.authoritativeMembershipDigest||
      hopPayload.authoritativeMembershipDigest!==oracle.authoritativeMembershipDigest||
      reviewPayload.oracleMemberSetSha256!==oracle.coverageSetSha256||hopPayload.oracleMemberSetSha256!==oracle.coverageSetSha256||
      reviewPayload.producerIdentitySha256!==oracle.producerIdentity||hopPayload.producerIdentitySha256!==oracle.producerIdentity)
    throw new Error("Monitoring oracle content/signature authority binding mismatch");
  runtimeDeps.verifyProvenanceSignature(reviewSignature as unknown as SignedProvenanceEnvelope,
    {runtimeCommitSha:expected.commitSha,adapterBundleSha256:expected.adapterBundleSha256});
  runtimeDeps.verifyProvenanceSignature(hopSignature as unknown as SignedProvenanceEnvelope,
    {runtimeCommitSha:expected.commitSha,adapterBundleSha256:expected.adapterBundleSha256});
  const membershipIds=sourceIds(membership.members,"membership"),oracleIds=sourceIds(oracle.members,"oracle");
  if(JSON.stringify(membershipIds)!==JSON.stringify(oracleIds)||membershipIds.length!==expected.plannedSourceCount||
      hashCanonicalStringSet(membershipIds)!==expected.plannedSourceSetSha256)throw new Error("Monitoring planned source set mismatch");
  return Object.freeze(expected);
}

function sourceIds(value:unknown,label:string):string[]{
  if(!Array.isArray(value)||value.length===0)throw new Error(`Monitoring ${label} members are invalid`);
  const ids=value.map(item=>{const member=parseObjectValue(item,`${label} member`);if(typeof member.sourceId!=="string"||!member.sourceId.trim())
    throw new Error(`Monitoring ${label} sourceId is invalid`);return member.sourceId;});
  return [...new Set(ids)].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
}
function parseObject(bytes:Buffer,label:string):Record<string,unknown>{try{return parseObjectValue(JSON.parse(bytes.toString("utf8")),label);}catch(error){
  if(error instanceof Error&&error.message.startsWith("Monitoring"))throw error;throw new Error(`Monitoring ${label} JSON is invalid`);}}
function parseObjectValue(value:unknown,label:string):Record<string,unknown>{if(value===null||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)
  throw new Error(`Monitoring ${label} is invalid`);return value as Record<string,unknown>;}
function required(env:NodeJS.ProcessEnv,name:string):string{const value=env[name];if(!value?.trim())throw new Error(`Monitoring authority pin ${name} is required`);return value;}
function shaPin(env:NodeJS.ProcessEnv,name:string):string{const value=required(env,name);if(!validSha(value))throw new Error(`Monitoring authority pin ${name} is invalid`);return value;}
function commitPin(env:NodeJS.ProcessEnv,name:string):string{const value=required(env,name);if(!/^[0-9a-f]{40}$/u.test(value))throw new Error(`Monitoring authority pin ${name} is invalid`);return value;}
function positiveInteger(env:NodeJS.ProcessEnv,name:string):number{const value=Number(required(env,name));if(!Number.isSafeInteger(value)||value<1)throw new Error(`Monitoring authority pin ${name} is invalid`);return value;}
function validSha(value:unknown):value is string{return typeof value==="string"&&/^[0-9a-f]{64}$/u.test(value);}
function digest(bytes:Buffer):string{return createHash("sha256").update(bytes).digest("hex");}
function assertDigest(bytes:Buffer,expected:string,label:string):void{const actual=digest(bytes);if(!timingSafeEqual(Buffer.from(actual,"hex"),Buffer.from(expected,"hex")))
  throw new Error(`Monitoring ${label} file digest mismatch`);}
