import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadMonitoringReleaseIdentity } from "../../src/crawler/monitoringReleaseIdentity";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { signedProvenancePayloadSha256 } from "../../src/crawler/reviewerSignatureCore";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
function fixture(){
  const root=mkdtempSync(resolve(tmpdir(),"monitor-authority-")),sourceIds=["source-a","source-b"];
  const identity={releaseCandidateId:"p0-rc-test",commitSha:"1".repeat(40),rosterSha256:"2".repeat(64),
    sourcePlanSha256:"3".repeat(64),sourceConfigSha256:"4".repeat(64),adapterBundleSha256:"5".repeat(64)};
  const memberSetSha256="6".repeat(64),reviewRoot="7".repeat(64),hopRoot="8".repeat(64),producer="9".repeat(64);
  const payload=(purpose:"REVIEW"|"HOP_CHAIN",rootSha:string)=>({schemaVersion:1 as const,purpose,
    reviewerIdentitySha256:"a".repeat(64),producerIdentitySha256:producer,provenanceRootSha256:rootSha,
    authoritativeMembershipDigest:memberSetSha256,oracleMemberSetSha256:"b".repeat(64)});
  const review={keyId:"review-key",payload:payload("REVIEW",reviewRoot),signatureBase64:"unused"};
  const hop={keyId:"hop-key",payload:payload("HOP_CHAIN",hopRoot),signatureBase64:"unused"};
  const oracle:any={schemaVersion:3,kind:"FULL_RELEASE",...identity,authoritativeMembershipDigest:memberSetSha256,
    reviewProvenanceRootSha256:reviewRoot,hopChainProvenanceRootSha256:hopRoot,producerIdentity:producer,
    reviewProvenanceSignature:review,hopChainProvenanceSignature:hop,contentSha256:"c".repeat(64),
    coverageSetSha256:"b".repeat(64),
    members:sourceIds.map(sourceId=>({sourceId}))};
  const oraclePath=resolve(root,"oracle.json");writeFileSync(oraclePath,JSON.stringify(oracle));
  const oracleRaw=sha(JSON.stringify(oracle));
  const membership:any={schemaVersion:6,kind:"FULL_RELEASE",...identity,sourceTreeSha256:"d".repeat(64),runtimeTreeSha256:"e".repeat(64),
    memberSetSha256,members:sourceIds.map(sourceId=>({sourceId})),oracleAuthority:{oracleRawFileSha256:oracleRaw,
      oracleContentSha256:oracle.contentSha256,reviewProvenanceRootSha256:reviewRoot,hopChainProvenanceRootSha256:hopRoot,
      reviewSignedPayloadSha256:signedProvenancePayloadSha256(review.payload),hopChainSignedPayloadSha256:signedProvenancePayloadSha256(hop.payload),
      reviewKeyId:review.keyId,hopChainKeyId:hop.keyId,producerIdentity:producer}};
  const membershipPath=resolve(root,"membership.json");writeFileSync(membershipPath,JSON.stringify(membership));
  const build={schemaVersion:2,commitSha:identity.commitSha,sourceTreeSha256:membership.sourceTreeSha256,runtimeTreeSha256:membership.runtimeTreeSha256};
  const buildPath=resolve(root,"build-identity.json");writeFileSync(buildPath,JSON.stringify({...build,contentSha256:sha(JSON.stringify(build))}));
  const env:NodeJS.ProcessEnv={P0_FULL_RELEASE_MEMBERSHIP_FILE:membershipPath,P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256:sha(JSON.stringify(membership)),
    P0_FULL_RELEASE_ORACLE_FILE:oraclePath,P0_FULL_RELEASE_ORACLE_FILE_SHA256:oracleRaw,P0_BUILD_IDENTITY_FILE:buildPath,
    P0_RELEASE_CANDIDATE_ID:identity.releaseCandidateId,P0_RELEASE_COMMIT_SHA:identity.commitSha,P0_RELEASE_ROSTER_SHA256:identity.rosterSha256,
    P0_RELEASE_SOURCE_PLAN_SHA256:identity.sourcePlanSha256,P0_RELEASE_SOURCE_CONFIG_SHA256:identity.sourceConfigSha256,
    P0_RELEASE_ADAPTER_BUNDLE_SHA256:identity.adapterBundleSha256,P0_RELEASE_PLANNED_SOURCE_SET_SHA256:hashCanonicalStringSet(sourceIds),
    P0_RELEASE_PLANNED_SOURCE_COUNT:String(sourceIds.length)};
  return {env,identity,oracle,membership,oraclePath,membershipPath};
}

describe("lightweight monitoring release identity",()=>{
  const testDeps={verifyProvenanceSignature:()=>undefined,validateMembershipContent:()=>undefined,
    validateOracleContent:()=>undefined};
  it("binds explicit pins to baked build, membership, oracle, and planned sources",async()=>{
    const value=fixture();await expect(loadMonitoringReleaseIdentity(value.env,testDeps)).resolves.toMatchObject(value.identity);
  });
  it("rejects jointly repinned files when embedded oracle content/signature authority drifts",async()=>{
    const value=fixture();value.oracle.contentSha256="f".repeat(64);writeFileSync(value.oraclePath,JSON.stringify(value.oracle));
    value.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256=sha(JSON.stringify(value.oracle));
    value.membership.oracleAuthority.oracleRawFileSha256=value.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256;
    writeFileSync(value.membershipPath,JSON.stringify(value.membership));
    value.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256=sha(JSON.stringify(value.membership));
    await expect(loadMonitoringReleaseIdentity(value.env,testDeps)).rejects.toThrow(/content\/signature authority binding/i);
  });
  it("rejects jointly repinned files when a signed payload no longer binds the oracle root",async()=>{
    const value=fixture();value.oracle.reviewProvenanceSignature.payload.provenanceRootSha256="f".repeat(64);
    value.membership.oracleAuthority.reviewSignedPayloadSha256=
      signedProvenancePayloadSha256(value.oracle.reviewProvenanceSignature.payload);
    writeFileSync(value.oraclePath,JSON.stringify(value.oracle));value.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256=sha(JSON.stringify(value.oracle));
    value.membership.oracleAuthority.oracleRawFileSha256=value.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256;
    writeFileSync(value.membershipPath,JSON.stringify(value.membership));
    value.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256=sha(JSON.stringify(value.membership));
    await expect(loadMonitoringReleaseIdentity(value.env,testDeps)).rejects.toThrow(/content\/signature authority binding/i);
  });
  it("uses full structural validators by default and rejects omitted content/set evidence",async()=>{
    const value=fixture();await expect(loadMonitoringReleaseIdentity(value.env,{verifyProvenanceSignature:()=>undefined}))
      .rejects.toThrow(/Release member|membership|content|member-set/i);
  });
  it("uses the committed production key registry by default and rejects a rogue signature",async()=>{
    const value=fixture();await expect(loadMonitoringReleaseIdentity(value.env,{validateMembershipContent:()=>undefined,
      validateOracleContent:()=>undefined})).rejects.toThrow(/trusted|signature|key/i);
  });
  it("fails before file IO when an explicit deployment pin is absent",async()=>{
    const value=fixture();delete value.env.P0_RELEASE_PLANNED_SOURCE_COUNT;
    await expect(loadMonitoringReleaseIdentity(value.env)).rejects.toThrow(/PLANNED_SOURCE_COUNT/);
  });
  it("preserves authority env in a snapshot before side-effectful validator imports",()=>{
    const value=fixture(),moduleUrl=pathToFileURL(resolve("src/crawler/monitoringReleaseIdentity.ts")).href;
    const loader=pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
    const child=spawnSync(process.execPath,["--import",loader,"--eval",
      `const snapshot={...process.env};import(${JSON.stringify(moduleUrl)}).then(m=>m.loadMonitoringReleaseIdentity(snapshot)).catch(e=>{console.error(e.message);process.exit(9)})`],
      {cwd:process.cwd(),env:{...process.env,...value.env},encoding:"utf8"});
    expect(child.status).toBe(9);
    expect(child.stderr).not.toMatch(/authority pin .* is required/i);
    expect(child.stderr).toMatch(/Release member|membership|content|member-set/i);
  });
});
