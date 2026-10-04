import { spawn } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";

// Same-cloud foreground wrapper. No networking or publication of its own.
// A new private directory prevents accidental replacement of an earlier attempt.
const [directory, timeoutText, separator, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutText);
if (!directory || !/^[1-9][0-9]*$/u.test(timeoutText ?? "") || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs > 1_800_000 || separator !== "--" || !command) {
  console.error("Usage: node scripts/run-with-http-diagnostics.mjs <new-directory> <timeout-ms> -- <command> [args...]");
  process.exit(2);
}
const root = resolve(directory);
mkdirSync(root, { mode: 0o700 });
const stdout = openSync(join(root, "stdout.log"), "wx", 0o600);
const stderr = openSync(join(root, "stderr.log"), "wx", 0o600);
const lifecycle = openSync(join(root, "process.jsonl"), "wx", 0o600);
const started = performance.now();
let warningSent = false;
const storageWarning = () => {
  if (warningSent) return;
  warningSent = true;
  try { console.error("HTTP_DIAGNOSTIC_WRAPPER_WRITE_FAILED"); } catch { /* cleanup still required */ }
};
const marker = (event, detail = {}) => {
  try {
    writeSync(lifecycle, JSON.stringify({ schemaVersion: 1, event, recordedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started), wrapperPid: process.pid, ...detail }) + "\n");
    fsyncSync(lifecycle);
  } catch { storageWarning(); }
};
marker("WRAPPER_START", { timeoutMs });
const child = spawn(command, args, { env: { ...process.env,
  P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH: join(root, "http-requests.jsonl") },
  stdio: ["ignore", stdout, stderr], detached: false });
let deadlineReached = false, spawnFailed = false, escalation;
const signalChild = signal => {
  if (!child.pid) return;
  try { child.kill(signal); }
  catch (error) { if (error?.code !== "ESRCH") marker("SIGNAL_FAILED"); }
};
const stop = signal => {
  signalChild(signal);
  escalation ??= setTimeout(() => {
    marker("FORCE_KILL_ATTEMPT"); signalChild("SIGKILL");
  }, 10_000);
};
const deadline = setTimeout(() => { deadlineReached = true; marker("DEADLINE_REACHED"); stop("SIGTERM"); }, timeoutMs);
const onSignal = signal => { marker("SIGNAL_RECEIVED", { signal }); stop(signal); };
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);
child.once("spawn", () => marker("CHILD_STARTED", { childPid: child.pid }));
child.once("error", () => { spawnFailed = true; marker("SPAWN_FAILED"); });
child.once("close", (code, signal) => {
  clearTimeout(deadline); clearTimeout(escalation);
  process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal);
  for (const fd of [stdout, stderr]) { try { fsyncSync(fd); } catch { storageWarning(); } }
  const wrapperExitCode = deadlineReached ? 124 : spawnFailed ? 127 :
    code ?? (128 + (constants.signals[signal] ?? 1));
  marker("CHILD_EXIT", { childPid: child.pid ?? null, exitCode: code, signal,
    deadlineReached, wrapperExitCode });
  for (const fd of [stdout, stderr, lifecycle]) { try { closeSync(fd); } catch { storageWarning(); } }
  process.exitCode = wrapperExitCode;
});
