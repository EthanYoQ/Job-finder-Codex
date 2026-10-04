// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture(code: string, timeout = 5000, preload?: string) {
  const directory = mkdtempSync(join(tmpdir(), "http-wrapper-test-")); directories.push(directory);
  const output = join(directory, "attempt");
  const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), "scripts/run-with-http-diagnostics.mjs", output, String(timeout), "--",
    process.execPath, "-e", code], { cwd: resolve("."), stdio: "pipe" });
  let wrapperStderr = "";
  child.stderr.on("data", chunk => { wrapperStderr += String(chunk); });
  const completed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { output, completed, child, stderr: () => wrapperStderr,
    records: () => readFileSync(join(output, "process.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)) };
}

describe("same-cloud diagnostic wrapper (no network)", () => {
  it("persists exact stdout/stderr and actual nonzero exit without logging command arguments", async () => {
    const run = fixture('const secret = "DO_NOT_LOG_ARG"; process.stdout.write("stdout\\n"); process.stderr.write("stderr\\n"); process.exitCode = 7;');
    expect(await run.completed).toEqual({ code: 7, signal: null });
    expect(readFileSync(join(run.output, "stdout.log"), "utf8")).toBe("stdout\n");
    expect(readFileSync(join(run.output, "stderr.log"), "utf8")).toBe("stderr\n");
    expect(run.records().map(row => row.event)).toEqual(["WRAPPER_START", "CHILD_STARTED", "CHILD_EXIT"]);
    expect(run.records().at(-1)).toMatchObject({ exitCode: 7, signal: null, wrapperExitCode: 7, deadlineReached: false });
    expect(readFileSync(join(run.output, "process.jsonl"), "utf8")).not.toContain("DO_NOT_LOG_ARG");
    expect(statSync(join(run.output, "stdout.log")).mode & 0o777).toBe(0o600);
  });

  it("bounds the child with SIGTERM and records the child's real exit separately from deadline status", async () => {
    const run = fixture('process.on("SIGTERM", () => { process.stderr.write("cancelled\\n"); process.exit(23); }); setInterval(() => {}, 1000);', 250);
    expect(await run.completed).toEqual({ code: 124, signal: null });
    expect(readFileSync(join(run.output, "stderr.log"), "utf8")).toBe("cancelled\n");
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
    expect(run.stderr()).toBe("HTTP_DIAGNOSTIC_WRAPPER_WRITE_FAILED\n");
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
