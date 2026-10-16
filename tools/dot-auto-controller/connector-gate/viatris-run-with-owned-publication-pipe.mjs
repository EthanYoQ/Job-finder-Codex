/** Inactive wrapper derivative; original diagnostics and budget retained. */
import { validateLaunchSeed, validateLaunch, validateGateMessage, validateOutcomeMessage, makeFrame } from "./viatris-pipe-protocol.mjs";
import { spawn } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";

// Same-cloud foreground wrapper. No networking or publication of its own.
// A new private directory prevents accidental replacement of an earlier attempt.
const [launchJson, directory, timeoutText, separator, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutText);
// Mode selects this fixed transport implementation; it grants no host authority.
// LIVE launch argv/package/challenge are restricted by the pinned composition CLI.
if (!["TEST_ONLY", "LIVE"].includes(process.env.JOBFINDER_OWNED_PIPE_MODE)) { console.error("PIPE_REAL_LAUNCH_DISABLED"); process.exit(2); }
const launchSeed = validateLaunchSeed(JSON.parse(launchJson));
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
// Capture before spawn/import work. The child must never restart this budget.
const outerDeadline = Date.now() + timeoutMs;
const launch = validateLaunch({...launchSeed, outerDeadline});
let pipeSequence=0,pipeHeld=false,pipeReviewSeen=false,pipeReviewBinding=null,pipeOutcomeSeen=false;
const pipeFrame=(event,detail={})=>{
  try { writeSync(1,makeFrame(pipeSequence++,event,launch,detail)); }
  catch { pipeHeld=true; marker("PIPE_FORWARD_FAILED"); }
};
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
marker("WRAPPER_START", { timeoutMs, outerDeadline });
const child = spawn(command, args, { env: { ...process.env,
  P0_PILOT_OUTER_DEADLINE_MS: String(outerDeadline),
  JOBFINDER_VIATRIS_OWNED_PIPE_MODE: "VIATRIS_OWNED_PIPE_CANDIDATE_V1",
  JOBFINDER_VIATRIS_LAUNCH_CHALLENGE: launchSeed.launchChallenge,
  P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH: join(root, "http-requests.jsonl") },
  stdio: ["ignore", stdout, stderr, "ipc"], detached: false });
let deadlineReached = false, spawnFailed = false, escalation;
const PIPE_SAFE_REASONS=new Set(["EBADF", "EIO", "EPIPE", "PIPE_ALREADY_STARTED", "PIPE_BUFFER_SIZE", "PIPE_CLOCK", "PIPE_DEADLINE_ORDER", "PIPE_DISPATCH_EXPIRED", "PIPE_DUPLICATE_REVIEW", "PIPE_FOREIGN_SESSION", "PIPE_FORWARD_FAILED", "PIPE_FRAME_JSON", "PIPE_FRAME_SIZE", "PIPE_HASH", "PIPE_ID", "PIPE_LAUNCH_BINDING", "PIPE_LIVE_SESSION_REQUIRED", "PIPE_NOT_DISPATCHABLE", "PIPE_NOT_RAW_STREAM", "PIPE_NO_LIVE_OUTCOME", "PIPE_NO_LIVE_REVIEW", "PIPE_OUTCOME_HASH", "PIPE_OUTCOME_NOT_VERIFIED", "PIPE_OUTCOME_ORDER", "PIPE_OUTCOME_TOOL_MISMATCH", "PIPE_OUTCOME_TUPLE", "PIPE_OUTCOME_TYPE", "PIPE_OUTER_EXPIRED", "PIPE_POLL_STATE", "PIPE_REAL_LAUNCH_DISABLED", "PIPE_REAL_PORT_DISABLED", "PIPE_RELAY_REQUEST_MISMATCH", "PIPE_REVIEW_ORDER", "PIPE_SCHEMA", "PIPE_SCOPE", "PIPE_SEQUENCE", "PIPE_START_ORDER", "PIPE_TERMINAL", "PIPE_TIME", "PIPE_TOOL_EXIT", "PIPE_TOOL_PORT", "PIPE_TOOL_SHAPE", "PIPE_TYPE", "PIPE_UNKNOWN_EVENT", "PIPE_UNTRUSTED_OUTPUT"]);
const safePipeReason=e=>PIPE_SAFE_REASONS.has(e?.message)?e.message:PIPE_SAFE_REASONS.has(e?.code)?e.code:"PIPE_VALIDATION_FAILED";
child.on("message", message => {
  if (pipeHeld) return;
  let phase=message?.type === "PRODUCER_OUTCOME_VERIFIED_V1"?"OUTCOME_VALIDATE":"REVIEW_VALIDATE";
  try {
    if (message?.type === "PRODUCER_OUTCOME_VERIFIED_V1") {
      if (!pipeReviewSeen || pipeOutcomeSeen) throw Error("PIPE_OUTCOME_ORDER");
      const outcome=validateOutcomeMessage(message,pipeReviewBinding);pipeOutcomeSeen=true;
      marker("PIPE_OUTCOME_VALIDATED",{sequence:pipeSequence,reviewSeen:pipeReviewSeen,outcomeSeen:pipeOutcomeSeen,outerDeadline});
      pipeFrame("OUTCOME_VERIFIED",{outcome});
    } else {
      if (pipeReviewSeen) throw Error("PIPE_DUPLICATE_REVIEW");
      const reviewed=validateGateMessage(message,launch,Date.now());
      pipeReviewSeen=true;pipeReviewBinding=reviewed;
      phase="REVIEW_FORWARD";
      writeSync(1,makeFrame(pipeSequence++,"REVIEW_CONSUMED",reviewed));
      marker("PIPE_REVIEW_FORWARDED",{sequence:pipeSequence,reviewSeen:pipeReviewSeen,outcomeSeen:pipeOutcomeSeen,outerDeadline});
    }
  } catch(error) { pipeHeld=true; marker("PIPE_PROTOCOL_HOLD",{phase,reason:safePipeReason(error),sequence:pipeSequence,reviewSeen:pipeReviewSeen,outcomeSeen:pipeOutcomeSeen,outerDeadline}); pipeFrame("PROTOCOL_HOLD"); }
});
const signalChild = signal => {
  if (!child.pid) return;
  try { child.kill(signal); }
  catch (error) { if (error?.code !== "ESRCH") marker("SIGNAL_FAILED"); }
};
const stop = signal => {
  if (!pipeHeld) { pipeHeld=true; pipeFrame("PROTOCOL_HOLD"); }
  signalChild(signal);
  escalation ??= setTimeout(() => {
    marker("FORCE_KILL_ATTEMPT"); signalChild("SIGKILL");
  }, 10_000);
};
const deadline = setTimeout(() => { deadlineReached = true; marker("DEADLINE_REACHED"); stop("SIGTERM"); }, Math.max(0, timeoutMs - (performance.now() - started)));
const onSignal = signal => { marker("SIGNAL_RECEIVED", { signal }); stop(signal); };
process.on("SIGTERM", onSignal);
process.on("SIGINT", onSignal);
child.once("spawn", () => { marker("CHILD_STARTED", { childPid: child.pid }); pipeFrame("STARTED"); });
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
  pipeFrame("CHILD_TERMINAL", {exitCode:code,signal});
  process.exitCode = wrapperExitCode;
});
