import { createHash } from "node:crypto";
import { createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { supportsNativeFetchEnvProxy } from "../src/crawler/officialHttpProxyRuntime";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const profileSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^v22\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
    .refine(supportsNativeFetchEnvProxy),
  platform: z.literal("linux"),
  arch: z.literal("x64"),
  minimumEnvProxyFetchVersion: z.literal("22.21.0"),
  distributionUrl: z.string(),
  shasumsUrl: z.string(),
  archiveSha256: sha256,
  binarySha256: sha256,
  featureReleaseUrl: z.literal("https://nodejs.org/en/blog/release/v22.21.0")
}).strict().refine(profile =>
  profile.distributionUrl === `https://nodejs.org/dist/${profile.version}/node-${profile.version}-${profile.platform}-${profile.arch}.tar.xz` &&
  profile.shasumsUrl === `https://nodejs.org/dist/${profile.version}/SHASUMS256.txt`
);

export type NodeRuntimeProfile = z.infer<typeof profileSchema>;
export type NodeRuntimeProfileErrorCode =
  | "NODE_RUNTIME_PROFILE_UNREADABLE" | "NODE_RUNTIME_PROFILE_INVALID"
  | "NODE_RUNTIME_VERSION_MISMATCH" | "NODE_RUNTIME_PLATFORM_MISMATCH" | "NODE_RUNTIME_ARCH_MISMATCH"
  | "NODE_RUNTIME_BINARY_UNREADABLE" | "NODE_RUNTIME_BINARY_MISMATCH";

export class NodeRuntimeProfileError extends Error {
  constructor(readonly code: NodeRuntimeProfileErrorCode) {
    // Paths, environment values and parser/filesystem error details are deliberately omitted.
    super(code);
    this.name = "NodeRuntimeProfileError";
  }
}

export function parseNodeRuntimeProfile(value: unknown): NodeRuntimeProfile {
  const parsed = profileSchema.safeParse(value);
  if (!parsed.success) throw new NodeRuntimeProfileError("NODE_RUNTIME_PROFILE_INVALID");
  return parsed.data;
}

export const DEFAULT_NODE_RUNTIME_PROFILE_PATH = fileURLToPath(new URL("../ops/node-runtime-profile.json", import.meta.url));

function verifyExecutablePath(): string {
  try {
    const executablePath = realpathSync("/proc/self/exe");
    const running = statSync("/proc/self/exe", { bigint: true });
    const named = statSync(process.execPath, { bigint: true });
    if (realpathSync(process.execPath) !== executablePath || running.dev !== named.dev || running.ino !== named.ino) {
      throw new NodeRuntimeProfileError("NODE_RUNTIME_BINARY_MISMATCH");
    }
    return executablePath;
  } catch (error) {
    if (error instanceof NodeRuntimeProfileError) throw error;
    throw new NodeRuntimeProfileError("NODE_RUNTIME_BINARY_UNREADABLE");
  }
}

/** Verify this running process, never a caller-supplied version/hash or a PATH lookup.
 * The archive hash records installation provenance; only the running
 * executable is read here. This function does not download or change the runtime. */
export async function verifyNodeRuntimeProfile(
  { profilePath = DEFAULT_NODE_RUNTIME_PROFILE_PATH }: { profilePath?: string } = {}
) {
  let raw: Buffer;
  try { raw = readFileSync(profilePath); }
  catch { throw new NodeRuntimeProfileError("NODE_RUNTIME_PROFILE_UNREADABLE"); }
  let decoded: unknown;
  try { decoded = JSON.parse(raw.toString("utf8")); }
  catch { throw new NodeRuntimeProfileError("NODE_RUNTIME_PROFILE_INVALID"); }
  const profile = parseNodeRuntimeProfile(decoded);
  if (process.version !== profile.version) throw new NodeRuntimeProfileError("NODE_RUNTIME_VERSION_MISMATCH");
  if (process.platform !== profile.platform) throw new NodeRuntimeProfileError("NODE_RUNTIME_PLATFORM_MISMATCH");
  if (process.arch !== profile.arch) throw new NodeRuntimeProfileError("NODE_RUNTIME_ARCH_MISMATCH");
  // Linux /proc binds the hash to the executing inode, even if the named file was replaced.
  const executablePath = verifyExecutablePath();
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream("/proc/self/exe")) hash.update(chunk);
  } catch { throw new NodeRuntimeProfileError("NODE_RUNTIME_BINARY_UNREADABLE"); }
  verifyExecutablePath();
  const binarySha256 = hash.digest("hex");
  if (binarySha256 !== profile.binarySha256) throw new NodeRuntimeProfileError("NODE_RUNTIME_BINARY_MISMATCH");
  return {
    schemaVersion: 1 as const,
    code: "NODE_RUNTIME_PROFILE_VERIFIED" as const,
    version: process.version,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    executablePath,
    binarySha256,
    profileSha256: createHash("sha256").update(raw).digest("hex")
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new NodeRuntimeProfileError("NODE_RUNTIME_PROFILE_INVALID");
    console.log(JSON.stringify(await verifyNodeRuntimeProfile()));
  } catch (error) {
    console.error(JSON.stringify({ code: error instanceof NodeRuntimeProfileError ? error.code : "NODE_RUNTIME_VERIFICATION_FAILED" }));
    process.exitCode = 1;
  }
}
