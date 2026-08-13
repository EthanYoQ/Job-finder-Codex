import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRuntimeExposureReceipt, parseRuntimeExposureReceipt, RUNTIME_EXPOSURE_FORMAL_EXECUTABLES,
  RUNTIME_EXPOSURE_RISKY_EXECUTABLES } from "../../src/security/runtimeExposureQualification";

const digest = `sha256:${"a".repeat(64)}`;
const facts = {
  schemaVersion: 1, status: "PASS", platform: "linux", architecture: "x64", uid: 1000,
  effectiveCapabilities: "0000000000000000", noNewPrivileges: "1", rootMountOptions: ["ro"],
  tmpMountOptions: ["rw", "nosuid", "nodev", "noexec"], dbusEnvironment: [], dbusSockets: [], blockDevices: [],
  forbiddenSpawnReferences: [], minizipLibraries: [], executablePaths: Object.fromEntries(
    RUNTIME_EXPOSURE_RISKY_EXECUTABLES.map((name) => [name, null])),
  elfClasses: Object.fromEntries(RUNTIME_EXPOSURE_FORMAL_EXECUTABLES.map((path) => [path, 2])),
  dynamicLibraries: Object.fromEntries(RUNTIME_EXPOSURE_FORMAL_EXECUTABLES
    .map((path) => [path, ["libc.so.6 => /lib/libc.so.6"]])),
  capturedAt: "2026-08-13T00:00:00.000Z"
};
const raw = Buffer.from(JSON.stringify(facts));
const trivy = Buffer.from(JSON.stringify({ Metadata: { ImageID: digest } }));
const trivySha = createHash("sha256").update(trivy).digest("hex");

describe("runtime exposure qualification", () => {
  it("keeps the fixed production executable policy complete", () => {
    expect(RUNTIME_EXPOSURE_FORMAL_EXECUTABLES).toEqual(["/usr/local/bin/node", "/opt/brave.com/brave/brave",
      "/usr/local/bin/pg_dump", "/usr/local/bin/pg_restore", "/usr/local/bin/psql"]);
    expect(RUNTIME_EXPOSURE_RISKY_EXECUTABLES).toEqual(["blkid", "cupsd", "curl", "fdisk", "gzip", "infocmp",
      "mount", "perl", "setfacl", "thunderbird", "wget", "xdg-email"]);
    expect(Object.isFrozen(RUNTIME_EXPOSURE_FORMAL_EXECUTABLES)).toBe(true);
    expect(Object.isFrozen(RUNTIME_EXPOSURE_RISKY_EXECUTABLES)).toBe(true);
  });

  it("binds strict runtime facts to the exact image and Trivy report", () => {
    const receipt = createRuntimeExposureReceipt(raw, trivy, digest, new Date("2026-08-13T00:00:00.000Z"));
    expect(parseRuntimeExposureReceipt(Buffer.from(JSON.stringify(receipt)), digest, trivySha,
      new Date("2026-08-13T00:02:00.000Z"))).toEqual(receipt);
  });

  it("rejects another image, another scanner report, and extra fact fields", () => {
    const evaluatedAt = new Date("2026-08-13T00:01:00.000Z");
    const receipt = createRuntimeExposureReceipt(raw, trivy, digest, evaluatedAt);
    const bytes = Buffer.from(JSON.stringify(receipt));
    expect(() => parseRuntimeExposureReceipt(bytes, `sha256:${"b".repeat(64)}`, trivySha, evaluatedAt)).toThrow(/invalid/i);
    expect(() => parseRuntimeExposureReceipt(bytes, digest, "c".repeat(64), evaluatedAt)).toThrow(/invalid/i);
    expect(() => createRuntimeExposureReceipt(Buffer.from(JSON.stringify({ ...facts, extra: true })), trivy, digest, evaluatedAt))
      .toThrow(/schema/i);
  });

  it.each([
    { effectiveCapabilities: "0000000000000001" },
    { noNewPrivileges: "0" },
    { rootMountOptions: ["rw"] },
    { tmpMountOptions: ["rw"] },
    { dbusSockets: ["/run/dbus/system_bus_socket"] },
    { blockDevices: ["/dev/sda"] },
    { forbiddenSpawnReferences: ["scripts/x.ts:perl"] },
    { minizipLibraries: ["/usr/lib/libminizip.so"] },
    { elfClasses: { "/usr/bin/node": 1 } },
    { dynamicLibraries: { "/usr/bin/node": ["libx.so => not found"] } }
  ])("rejects unsafe runtime facts %#", (override) => {
    const unsafe = Buffer.from(JSON.stringify({ ...facts, ...override }));
    expect(() => createRuntimeExposureReceipt(unsafe, trivy, digest, new Date("2026-08-13T00:01:00.000Z")))
      .toThrow(/fail-closed/i);
  });

  it("rejects partial executable inventories and stale receipts when reading", () => {
    const evaluatedAt = new Date("2026-08-13T00:01:00.000Z");
    expect(() => createRuntimeExposureReceipt(Buffer.from(JSON.stringify({ ...facts, elfClasses: { "/usr/local/bin/node": 2 } })),
      trivy, digest, evaluatedAt)).toThrow(/fail-closed/i);
    const receipt = createRuntimeExposureReceipt(raw, trivy, digest, evaluatedAt);
    expect(() => parseRuntimeExposureReceipt(Buffer.from(JSON.stringify(receipt)), digest, trivySha,
      new Date("2026-08-13T00:10:00.000Z"))).toThrow(/fail-closed/i);
    expect(() => parseRuntimeExposureReceipt(Buffer.from(JSON.stringify(receipt)), digest, trivySha,
      new Date(Number.NaN))).toThrow(/time is invalid/i);
  });
});
