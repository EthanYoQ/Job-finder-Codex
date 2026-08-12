import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalReleaseMembersSha256, releaseMembershipContentSha256,
  type AuthoritativeReleaseMembershipArtifact, type ReleaseMember } from "../../../src/crawler/authoritativeReleaseMembership";

type Binding = Pick<AuthoritativeReleaseMembershipArtifact, "releaseCandidateId" | "commitSha" | "rosterSha256" |
  "sourcePlanSha256" | "sourceConfigSha256" | "adapterBundleSha256">;
const authorityUrl = pathToFileURL(resolve("src/crawler/releaseMembershipAuthority.ts")).href;
const membershipUrl = pathToFileURL(resolve("src/crawler/authoritativeReleaseMembership.ts")).href;

export async function runMembershipAuthorityScenario(
  scenario: "validator-matrix" | "replace-before-load" | "replace-after-load",
  artifact: AuthoritativeReleaseMembershipArtifact,
  binding: Binding,
  members: ReleaseMember[]
): Promise<Record<string, boolean>> {
  const directory = await mkdtemp(join(tmpdir(), "membership-authority-scenario-"));
  try {
    if (scenario === "replace-before-load") return await replaceBeforeLoad(directory, artifact);
    if (scenario === "replace-after-load") return await replaceAfterLoad(directory, artifact);
    const valid = runValidation(directory, artifact, binding, members);
    const { contentSha256: _content, ...artifactBase } = artifact;
    const oneMemberBase = { ...artifactBase, members: [members[0]!],
      memberSetSha256: canonicalReleaseMembersSha256([members[0]!]) };
    const oneMemberArtifact = { ...oneMemberBase,
      contentSha256: releaseMembershipContentSha256(oneMemberBase) };
    const forgedPinRejected = runValidation(directory, oneMemberArtifact, binding, [members[0]!], "0".repeat(64)).status !== 0;
    const replacementRejected = runValidation(directory, artifact, binding,
      [members[0]!, { companyId: "replacement", sourceId: "replacement", surfaceId: "replacement", channelId: "replacement",category:"FOREIGN_PHARMA" }]).status !== 0;
    const duplicateRejected = runValidation(directory, artifact, binding, [members[0]!, members[0]!]).status !== 0;
    const allBindingsRejected = (["releaseCandidateId", "commitSha", "rosterSha256", "sourcePlanSha256",
      "sourceConfigSha256", "adapterBundleSha256"] as const).every((field) =>
      runValidation(directory, artifact, { ...binding, [field]: `mismatch-${field}` }, members).status !== 0);
    const memberHashRejected = runValidation(directory, { ...artifact, memberSetSha256: "0".repeat(64) }, binding, members).status !== 0;
    const contentHashRejected = runValidation(directory, { ...artifact, contentSha256: "0".repeat(64) }, binding, members).status !== 0;
    const partialRejected = runValidation(directory, { ...artifact, kind: "PARTIAL_DIAGNOSTIC" }, binding, members).status !== 0;
    return { valid: valid.status === 0, envDeleted: valid.stdout.includes("ENV_DELETED"), forgedPinRejected,
      replacementRejected, duplicateRejected, allBindingsRejected, memberHashRejected, contentHashRejected, partialRejected };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runValidation(directory: string, artifact: AuthoritativeReleaseMembershipArtifact,
  binding: Binding, actual: ReleaseMember[], pinOverride?: string) {
  const path = join(directory, `artifact-${createHash("sha256").update(JSON.stringify(artifact)).digest("hex")}.json`);
  const bytes = Buffer.from(JSON.stringify(artifact));
  writeFileSync(path, bytes);
  const script = `Promise.all([import('${authorityUrl}'),import('${membershipUrl}')]).then(async([a,m])=>{const t=await a.getStartupReleaseMembership();if(process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE===undefined&&process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256===undefined)console.log('ENV_DELETED');m.validateAuthoritativeReleaseMembership(t,${JSON.stringify(binding)},${JSON.stringify(actual)});console.log('VALID')}).catch(e=>{console.error(e.message);process.exit(9)})`;
  return spawn(script, path, pinOverride ?? sha(bytes));
}

async function replaceBeforeLoad(directory: string, artifact: AuthoritativeReleaseMembershipArtifact) {
  const path = join(directory, "before.json"); const original = Buffer.from(JSON.stringify(artifact));
  await writeFile(path, original);
  const script = `import('${authorityUrl}').then(async a=>{await import('node:fs/promises').then(fs=>fs.writeFile(${JSON.stringify(path)},'replacement'));await a.getStartupReleaseMembership()}).catch(e=>{if(e.message.includes('digest mismatch')){console.log('DIGEST_MISMATCH');return}console.error(e);process.exit(8)})`;
  const result = spawn(script, path, sha(original));
  return { digestMismatch: result.status === 0 && result.stdout.includes("DIGEST_MISMATCH") };
}

async function replaceAfterLoad(directory: string, artifact: AuthoritativeReleaseMembershipArtifact) {
  const path = join(directory, "after.json"); const original = Buffer.from(JSON.stringify(artifact));
  await writeFile(path, original);
  const script = `import('${authorityUrl}').then(async a=>{const first=await a.getStartupReleaseMembership();await import('node:fs/promises').then(fs=>fs.writeFile(${JSON.stringify(path)},'replacement'));const second=await a.getStartupReleaseMembership();console.log(first===second?'MEMOIZED':'NO');console.log(Object.isFrozen(first)&&Object.isFrozen(first.artifact)&&Object.isFrozen(first.artifact.members)&&Object.isFrozen(first.artifact.members[0])?'FROZEN':'NO')}).catch(e=>{console.error(e);process.exit(8)})`;
  const result = spawn(script, path, sha(original));
  return { memoizedOriginal: result.stdout.includes("MEMOIZED"), frozen: result.stdout.includes("FROZEN") };
}

function spawn(script: string, path: string, pin: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", script], { cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, P0_FULL_RELEASE_MEMBERSHIP_FILE: path, P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: pin } });
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
