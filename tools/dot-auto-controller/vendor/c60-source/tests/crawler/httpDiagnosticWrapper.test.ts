// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture(code: string, timeout = 5000, preload?: string, env: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), "http-wrapper-test-")); directories.push(directory);
  const output = join(directory, "attempt");
  const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), "scripts/run-with-http-diagnostics.mjs", output, String(timeout), "--",
    process.execPath, "-e", code], { cwd: resolve("."), stdio: "pipe", env: { ...process.env, ...env } });
  let wrapperStderr = "";
  child.stderr.on("data", chunk => { wrapperStderr += String(chunk); });
  const completed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { output, completed, child, stderr: () => wrapperStderr,
    records: () => readFileSync(join(output, "process.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)) };
}

function childRecords(output: string): Array<Record<string, any>> {
  return readFileSync(join(output, "stdout.log"), "utf8").trim().split("\n").map(line => JSON.parse(line));
}

// Native env proxy startup emits this known warning on the pinned Node runtime.
// Keep all other stderr byte-for-byte; do not alter the real wrapper or environment.
function withoutNativeProxyWarning(stderr: string): string {
  return stderr.replace(/\(node:\d+\) \[UNDICI-EHPA\] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time\.\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/gu, "");
}

// Scaled, local-only counterexample for wrapper/publication time handoff.
// These fake child events do not execute the actual runner, relay, or SQL.
function publicationTimeline(capped: boolean, acknowledgement: "late" | "none", earlierEvidence = false): string {
  return `
    const { setTimeout: delay } = require("node:timers/promises");
    const outer = Number(process.env.P0_PILOT_OUTER_DEADLINE_MS);
    const evidenceExpiry = outer + ${earlierEvidence ? -650 : 1000};
    const cutoff = ${capped ? "Math.min(evidenceExpiry, outer - 400)" : "evidenceExpiry"};
    const record = (event) => process.stdout.write(JSON.stringify({ event, at: Date.now(), outer, evidenceExpiry, cutoff }) + "\\n");
    process.on("SIGTERM", () => { record("CANCELLED"); process.exit(23); });
    (async () => {
      record("PUBLISH");
      ${acknowledgement === "late" ? 'setTimeout(() => record("LATE_ACK"), Math.max(0, outer - 500 - Date.now()));' : ""}
      await delay(20);
      record("UNKNOWN");
      await delay(Math.max(0, cutoff - Date.now()));
      record("READ_OUTCOME");
      await delay(75);
      record("SIMULATED_READ_COMPLETE");
    })().catch(() => { process.exitCode = 1; });
  `;
}

describe("same-cloud diagnostic wrapper (no network)", () => {
  it("preserves unexpected stderr when removing only the exact native proxy warning", () => {
    const known = "(node:123) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n" +
      "(Use `node --trace-warnings ...` to show where the warning was created)\n";
    const unexpected = "UNEXPECTED_TRANSPORT_FAILURE\n(node:456) [UNDICI-EHPA] Warning: an unexpected warning\n";
    expect(withoutNativeProxyWarning(known + unexpected)).toBe(unexpected);
    expect(withoutNativeProxyWarning(unexpected)).toBe(unexpected);
  });

  it("preserves proxy and CA environment settings without putting their values in telemetry", async () => {
    const keys = ["NODE_USE_ENV_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
      "NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR"];
    const values = keys.map(key => process.env[key] ?? null);
    const expected = createHash("sha256").update(JSON.stringify(values)).digest("hex");
    const run = fixture(`
      const { createHash } = require("node:crypto");
      const values = ${JSON.stringify(keys)}.map(key => process.env[key] ?? null);
      const preserved = createHash("sha256").update(JSON.stringify(values)).digest("hex") === ${JSON.stringify(expected)};
      process.stdout.write(JSON.stringify({ preserved }));
      if (!preserved) process.exitCode = 1;
    `);
    expect(await run.completed).toEqual({ code: 0, signal: null });
    expect(readFileSync(join(run.output, "stdout.log"), "utf8")).toBe('{"preserved":true}');
    const telemetry = readFileSync(join(run.output, "process.jsonl"), "utf8");
    for (const value of values) {
      if (value && value.length >= 8) expect(telemetry).not.toContain(value);
    }
  });

  it("persists exact stdout/stderr and actual nonzero exit without logging command arguments", async () => {
    const run = fixture('const secret = "DO_NOT_LOG_ARG"; process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n"); process.exitCode = 7;');
    expect(await run.completed).toEqual({ code: 7, signal: null });
    expect(readFileSync(join(run.output, "stdout.log"), "utf8")).toBe("stdout\n");
    expect(withoutNativeProxyWarning(readFileSync(join(run.output, "stderr.log"), "utf8"))).toBe("stderr\n");
    expect(run.records().map(row => row.event)).toEqual(["WRAPPER_START", "CHILD_STARTED", "CHILD_EXIT"]);
    expect(run.records().at(-1)).toMatchObject({ exitCode: 7, signal: null, wrapperExitCode: 7, deadlineReached: false });
    expect(readFileSync(join(run.output, "process.jsonl"), "utf8")).not.toContain("DO_NOT_LOG_ARG");
    expect(statSync(join(run.output, "stdout.log")).mode & 0o777).toBe(0o600);
  });

  it("overrides an inherited later outer deadline with the wrapper's absolute deadline before starting the child", async () => {
    const inheritedDeadline = Date.now() + 3_600_000;
    const run = fixture('process.stdout.write(JSON.stringify({ deadline: Number(process.env.P0_PILOT_OUTER_DEADLINE_MS), startedAt: Date.now() }));',
      5000, undefined, { P0_PILOT_OUTER_DEADLINE_MS: String(inheritedDeadline) });
    expect(await run.completed).toEqual({ code: 0, signal: null });
    const actual = JSON.parse(readFileSync(join(run.output, "stdout.log"), "utf8"));
    const start = run.records()[0]!;
    expect(actual.deadline).toBe(start.outerDeadline);
    expect(actual.deadline).toBeLessThan(inheritedDeadline);
    expect(actual.deadline - start.timeoutMs).toBeLessThanOrEqual(actual.startedAt);
    expect(actual.deadline).toBeLessThan(actual.startedAt + start.timeoutMs);
  });

  it("charges wrapper spawn preparation and delayed child initialization to the original timeout", async () => {
    const timeout = 1800, spawnDelay = 800, childDelay = 250;
    const preload = "data:text/javascript," + encodeURIComponent(`
      import cp from "node:child_process";
      import { syncBuiltinESMExports } from "node:module";
      const original = cp.spawn;
      cp.spawn = (...args) => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${spawnDelay});
        return original(...args);
      };
      syncBuiltinESMExports();
    `);
    const run = fixture(`
      const childEnteredAt = Date.now();
      process.on("SIGTERM", () => process.exit(23));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${childDelay});
      process.stdout.write(JSON.stringify({ childEnteredAt, readyAt: Date.now(), deadline: Number(process.env.P0_PILOT_OUTER_DEADLINE_MS) }));
      setInterval(() => {}, 1000);
    `, timeout, preload);
    expect(await run.completed).toEqual({ code: 124, signal: null });
    const actual = JSON.parse(readFileSync(join(run.output, "stdout.log"), "utf8"));
    const records = run.records(), started = records[0]!, deadline = records.find(row => row.event === "DEADLINE_REACHED")!;
    expect(actual.deadline).toBe(started.outerDeadline);
    expect(actual.childEnteredAt - (actual.deadline - timeout)).toBeGreaterThanOrEqual(spawnDelay - 20);
    expect(actual.readyAt - actual.childEnteredAt).toBeGreaterThanOrEqual(childDelay - 20);
    expect(actual.deadline - actual.readyAt).toBeLessThanOrEqual(timeout - spawnDelay - childDelay + 40);
    // Wide scheduling tolerance, still excluding a fresh timeout after the 800ms spawn delay.
    expect(deadline.durationMs).toBeGreaterThanOrEqual(timeout - 30);
    expect(deadline.durationMs).toBeLessThan(timeout + spawnDelay / 2);
    expect(records.at(-1)).toMatchObject({ exitCode: 23, wrapperExitCode: 124, deadlineReached: true });
  });

  it.each(["late", "none"] as const)("leaves one read-only reconciliation window after UNKNOWN with %s acknowledgement in a scaled child timeline", async acknowledgement => {
    const old = fixture(publicationTimeline(false, acknowledgement), 1200);
    const bounded = fixture(publicationTimeline(true, acknowledgement), 1200);
    const [oldExit, boundedExit] = await Promise.all([old.completed, bounded.completed]);
    expect(oldExit).toEqual({ code: 124, signal: null });
    expect(boundedExit).toEqual({ code: 0, signal: null });
    const oldEvents = childRecords(old.output), events = childRecords(bounded.output);
    expect(oldEvents.filter(row => row.event === "PUBLISH")).toHaveLength(1);
    expect(oldEvents.map(row => row.event)).not.toContain("READ_OUTCOME");
    expect(oldEvents.at(-1)!.event).toBe("CANCELLED");
    expect(events.filter(row => row.event === "PUBLISH")).toHaveLength(1);
    expect(events.filter(row => row.event === "READ_OUTCOME")).toHaveLength(1);
    const read = events.find(row => row.event === "READ_OUTCOME")!;
    expect(read.cutoff).toBe(read.outer - 400);
    expect(read.evidenceExpiry).toBeGreaterThan(read.outer);
    expect(read.at).toBeGreaterThanOrEqual(read.cutoff);
    expect(events.at(-1)).toMatchObject({ event: "SIMULATED_READ_COMPLETE" });
    expect(events.at(-1)!.at).toBeLessThan(read.outer - 200);
    expect(events.filter(row => row.event === "LATE_ACK")).toHaveLength(acknowledgement === "late" ? 1 : 0);
    expect(bounded.records().at(-1)).toMatchObject({ wrapperExitCode: 0, deadlineReached: false });
  });

  it("preserves an earlier original evidence expiry in the scaled child timeline", async () => {
    const run = fixture(publicationTimeline(true, "none", true), 1200);
    expect(await run.completed).toEqual({ code: 0, signal: null });
    const events = childRecords(run.output), read = events.find(row => row.event === "READ_OUTCOME")!;
    expect(read.cutoff).toBe(read.evidenceExpiry);
    expect(read.cutoff).toBeLessThan(read.outer - 400);
    expect(read.at).toBeGreaterThanOrEqual(read.evidenceExpiry);
    expect(events.filter(row => row.event === "PUBLISH")).toHaveLength(1);
    expect(events.filter(row => row.event === "READ_OUTCOME")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ event: "SIMULATED_READ_COMPLETE" });
    expect(events.at(-1)!.at).toBeLessThan(read.outer - 200);
  });

  it("bounds the child with SIGTERM and records the child's real exit separately from deadline status", async () => {
    const run = fixture('process.on("SIGTERM", () => { process.stderr.write("cancelled\\n"); process.exit(23); }); setInterval(() => {}, 1000);', 250);
    expect(await run.completed).toEqual({ code: 124, signal: null });
    expect(withoutNativeProxyWarning(readFileSync(join(run.output, "stderr.log"), "utf8"))).toBe("cancelled\n");
    expect(run.records().map(row => row.event)).toContain("DEADLINE_REACHED");
    expect(run.records().at(-1)).toMatchObject({ exitCode: 23, signal: null, wrapperExitCode: 124, deadlineReached: true });
  });

  it("forwards an actual SIGTERM to the existing runner cancellation path", async () => {
    const run = fixture('process.on("SIGTERM", () => process.exit(23)); process.stdout.write("ready"); setInterval(() => {}, 1000);');
    await vi.waitFor(() => expect(readFileSync(join(run.output, "stdout.log"), "utf8")).toBe("ready"));
    run.child.kill("SIGTERM");
    expect(await run.completed).toEqual({ code: 23, signal: null });
    expect(run.records()).toContainEqual(expect.objectContaining({ event: "SIGNAL_RECEIVED", signal: "SIGTERM" }));
  });

  it("continues deadline cleanup even when lifecycle and output fsync fail", async () => {
    const preload = "data:text/javascript," + encodeURIComponent('import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module"; fs.fsyncSync = () => { throw new Error("DO_NOT_LOG_STORAGE_DETAILS"); }; syncBuiltinESMExports();');
    const run = fixture('process.on("SIGTERM", () => process.exit(23)); setInterval(() => {}, 1000);', 250, preload);
    expect(await run.completed).toEqual({ code: 124, signal: null });
    expect(withoutNativeProxyWarning(run.stderr())).toBe("HTTP_DIAGNOSTIC_WRAPPER_WRITE_FAILED\n");
    expect(run.records().at(-1)).toMatchObject({ event: "CHILD_EXIT", exitCode: 23, deadlineReached: true });
  });

  it("keeps the directly spawned Node child in the wrapper's existing exec process group", async () => {
    const run = fixture(`
      const { readFileSync } = require("node:fs");
      process.on("SIGTERM", () => process.exit(23));
      process.stdout.write(readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ")[2]);
      setInterval(() => {}, 1000);
    `);
    await vi.waitFor(() => expect(readFileSync(join(run.output, "stdout.log"), "utf8")).toMatch(/^[0-9]+$/u));
    const childGroup = readFileSync(join(run.output, "stdout.log"), "utf8");
    const wrapperGroup = readFileSync(`/proc/${run.child.pid}/stat`, "utf8").split(") ")[1]!.split(" ")[2];
    const execGroup = readFileSync("/proc/self/stat", "utf8").split(") ")[1]!.split(" ")[2];
    expect(childGroup).toBe(wrapperGroup);
    expect(wrapperGroup).toBe(execGroup);
    run.child.kill("SIGTERM");
    expect(await run.completed).toEqual({ code: 23, signal: null });
  });
});
