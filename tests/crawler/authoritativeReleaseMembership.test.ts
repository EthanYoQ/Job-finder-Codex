import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { canonicalReleaseMembersSha256, releaseMembershipContentSha256,
  validateAuthoritativeReleaseMembershipArtifactContent,
  type AuthoritativeReleaseMembershipArtifact, type ReleaseMember } from "../../src/crawler/authoritativeReleaseMembership";
import { runMembershipAuthorityScenario } from "./helpers/membershipAuthorityScenario";

const binding = { releaseCandidateId: "rc-1", commitSha: "1".repeat(40), rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64), adapterBundleSha256: "5".repeat(64) };
const members: ReleaseMember[] = [
  { companyId: "company-a", sourceId: "source-a", surfaceId: "surface-a", channelId: "channel-a", category:"FOREIGN_PHARMA" },
  { companyId: "company-b", sourceId: "source-b", surfaceId: "surface-b", channelId: "channel-b", category:"DOMESTIC_PHARMA" }
];
const oracleAuthority = { oracleRawFileSha256: "a".repeat(64), oracleContentSha256: "b".repeat(64),
  reviewProvenanceRootSha256: "c".repeat(64), hopChainProvenanceRootSha256: "d".repeat(64),
  reviewSignedPayloadSha256: "e".repeat(64), hopChainSignedPayloadSha256: "f".repeat(64),
  reviewKeyId: "review-key", hopChainKeyId: "hop-key", producerIdentity: "9".repeat(64) };

function artifact(memberSet = members): AuthoritativeReleaseMembershipArtifact {
  const base = { schemaVersion: 6 as const, kind: "FULL_RELEASE" as const, ...binding,sourceTreeSha256:"8".repeat(64),runtimeTreeSha256:"7".repeat(64),
    oracleAuthority, members: memberSet,
    memberSetSha256: canonicalReleaseMembersSha256(memberSet) };
  return { ...base, contentSha256: releaseMembershipContentSha256(base) };
}

function child(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env,
      P0_FULL_RELEASE_MEMBERSHIP_FILE: undefined,
      P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: undefined, ...env }
  });
}

describe("authoritative release membership", () => {
  it("exposes a pure full-content validator for monitoring",()=>{
    expect(validateAuthoritativeReleaseMembershipArtifactContent(artifact())).toEqual(members);
    const tampered=structuredClone(artifact());tampered.members[0]!.surfaceId="tampered";
    expect(()=>validateAuthoritativeReleaseMembershipArtifactContent(tampered)).toThrow(/member-set|content/i);
  });
  it("binds company category into the canonical member set", () => {
    const base = [{ companyId:"company-a", sourceId:"source-a", surfaceId:"surface-a", channelId:"channel-a", category:"FOREIGN_PHARMA" as const }];
    expect(canonicalReleaseMembersSha256(base)).not.toBe(canonicalReleaseMembersSha256([{...base[0]!,category:"DOMESTIC_PHARMA"}]));
  });
  it("validates the complete trusted startup matrix in isolated processes", async () => {
    const result = await runMembershipAuthorityScenario("validator-matrix", artifact(), binding, members);
    expect(result).toMatchObject({ valid: true, forgedPinRejected: true, replacementRejected: true,
      duplicateRejected: true, allBindingsRejected: true, memberHashRejected: true,
      contentHashRejected: true, partialRejected: true, envDeleted: true });
  });

  it("detects replacement before first load and memoizes frozen original after successful load", async () => {
    expect(await runMembershipAuthorityScenario("replace-before-load", artifact(), binding, members))
      .toMatchObject({ digestMismatch: true });
    expect(await runMembershipAuthorityScenario("replace-after-load", artifact(), binding, members))
      .toMatchObject({ memoizedOriginal: true, frozen: true });
  });
  it("fails closed when startup authority was not present at process initialization", () => {
    const authorityUrl = pathToFileURL(resolve("src/crawler/releaseMembershipAuthority.ts")).href;
    const result = child(`import('${authorityUrl}').then(m=>m.getStartupReleaseMembership()).catch(e=>{console.error(e.message);process.exit(7)})`);
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("startup membership authority is unavailable");
  });

  it("snapshots path and digest once and ignores runtime env replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "release-membership-"));
    const originalPath = join(directory, "original.json");
    const replacementPath = join(directory, "replacement.json");
    const original = Buffer.from(JSON.stringify(artifact()));
    await writeFile(originalPath, original);
    await writeFile(replacementPath, JSON.stringify(artifact([{ companyId: "replacement", sourceId: "replacement", surfaceId: "replacement", channelId: "replacement",category:"FOREIGN_PHARMA" }])));
    const authorityUrl = pathToFileURL(resolve("src/crawler/releaseMembershipAuthority.ts")).href;
    const script = `import('${authorityUrl}').then(async m=>{process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE=${JSON.stringify(replacementPath)};process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256='0'.repeat(64);const a=await m.getStartupReleaseMembership();console.log(a.artifact.members[0].companyId);console.log(String(process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE))})`;
    const result = child(script, { P0_FULL_RELEASE_MEMBERSHIP_FILE: originalPath,
      P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: createHash("sha256").update(original).digest("hex") });
    await rm(directory, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("company-a");
    expect(result.stdout).toContain("replacement.json");
  });

  it("uses trim, NFC and framed UTF-8 tuples deterministically", () => {
    const nfc:ReleaseMember[] = [{ companyId: "café", sourceId: "source", surfaceId: "surface", channelId: "channel",category:"FOREIGN_PHARMA" }];
    const equivalent:ReleaseMember[] = [{ companyId: "  cafe\u0301  ", sourceId: " source ", surfaceId: "surface", channelId: "channel",category:"FOREIGN_PHARMA" }];
    expect(canonicalReleaseMembersSha256(equivalent)).toBe(canonicalReleaseMembersSha256(nfc));
    expect(canonicalReleaseMembersSha256([...members].reverse())).toBe(canonicalReleaseMembersSha256(members));
  });

  it("rejects duplicates after whitespace and Unicode normalization", () => {
    expect(() => canonicalReleaseMembersSha256([
      { companyId: "café", sourceId: "s", surfaceId: "x", channelId: "channel",category:"FOREIGN_PHARMA" },
      { companyId: " cafe\u0301 ", sourceId: "s", surfaceId: "x", channelId: "channel",category:"FOREIGN_PHARMA" }
    ])).toThrow("Duplicate");
  });

  it("changes digest for exact-cardinality replacement including sixty members", () => {
    const sixty = Array.from({ length: 60 }, (_, index) => ({ companyId: `company-${String(index).padStart(2, "0")}`,
      sourceId: `source-${String(index).padStart(2, "0")}`, surfaceId: `surface-${String(index).padStart(2, "0")}`,
      channelId: `channel-${String(index).padStart(2, "0")}`,category:"FOREIGN_PHARMA" as const }));
    const replaced = [...sixty.slice(0, 59), { companyId: "replace-59", sourceId: "replace-59", surfaceId: "replace-59", channelId: "channel-59",category:"FOREIGN_PHARMA" as const }];
    expect(canonicalReleaseMembersSha256(replaced)).not.toBe(canonicalReleaseMembersSha256(sixty));
  });

  it("changes the exact tuple digest for a surface-only or channel-only replacement", () => {
    expect(canonicalReleaseMembersSha256([{ ...members[0]!, surfaceId: "replacement" }]))
      .not.toBe(canonicalReleaseMembersSha256([members[0]!]));
    expect(canonicalReleaseMembersSha256([{ ...members[0]!, channelId: "replacement" }]))
      .not.toBe(canonicalReleaseMembersSha256([members[0]!]));
  });
});
