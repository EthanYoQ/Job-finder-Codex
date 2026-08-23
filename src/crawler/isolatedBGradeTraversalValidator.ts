import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import {
  parseBGradeIndependentTraversalValidation,
  type BGradeIndependentTraversalValidation,
  type runBGradeIndependentTraversalValidator
} from "./traversalCertificate";
import {
  B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES,
  tagBGradeIndependentTraversalFailure
} from "./independentTraversalDiagnostics";
import { productionTsxProcessArgs } from "../ops/productionTsxProcess";

type ValidatorInput = Parameters<typeof runBGradeIndependentTraversalValidator>[0];
type ExecuteValidatorProcess = (
  input: Omit<ValidatorInput, "signal">,
  signal: AbortSignal | undefined
) => Promise<string>;

const processResponseSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("SUCCEEDED"),
    validation: z.unknown()
  }).strict(),
  z.object({
    decision: z.literal("FAILED"),
    failureCode: z.enum(B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES),
    message: z.string().min(1).max(2_000)
  }).strict()
]);

const RETRIABLE_VALIDATOR_FAILURE_CODES = new Set<string>([
  "B_GRADE_BROWSER_NAVIGATION_FAILED",
  "B_GRADE_BROWSER_READINESS_FAILED",
  "B_GRADE_VALIDATOR_EXECUTION_FAILED"
] as const);

export function createIsolatedBGradeTraversalValidator(
  execute: ExecuteValidatorProcess
): (input: ValidatorInput) => Promise<BGradeIndependentTraversalValidation> {
  return async (input) => {
    const { signal, ...serializableInput } = input;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let output: string;
      try {
        output = await execute(serializableInput, signal);
      } catch (error) {
        if (signal?.aborted) {
          throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
        }
        if (attempt === 1) continue;
        throw tagBGradeIndependentTraversalFailure(error, "B_GRADE_VALIDATOR_EXECUTION_FAILED");
      }
      if (signal?.aborted) {
        throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
      }
      const response = processResponseSchema.parse(JSON.parse(output));
      if (response.decision === "FAILED") {
        if (attempt === 1 && RETRIABLE_VALIDATOR_FAILURE_CODES.has(response.failureCode)) {
          continue;
        }
        throw tagBGradeIndependentTraversalFailure(new Error(response.message), response.failureCode);
      }
      const validation = parseBGradeIndependentTraversalValidation(response.validation);
      if (validation.sourceId !== input.sourceId || validation.companyId !== input.companyId ||
          validation.sourceConfigSha256 !== input.sourceConfigSha256 ||
          !sameStrings(validation.surfaceIds, input.surfaceIds) ||
          !sameStrings(validation.channelIds, input.channelIds)) {
        throw new Error("Isolated B-grade traversal result binding mismatch");
      }
      return validation;
    }
    throw new Error("Isolated B-grade traversal retry loop exhausted without a result");
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const CHILD_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
const CHILD_ENVIRONMENT_ALLOWLIST = new Set([
  "COMSPEC",
  "FONTCONFIG_PATH",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LOGNAME",
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR"
]);
const CHILD_FORCE_KILL_GRACE_MS = 5_000;

export function bGradeValidatorChildEnvironment(
  parentEnvironment: NodeJS.ProcessEnv,
  input: Omit<ValidatorInput, "signal">
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(parentEnvironment).filter(
    ([key]) => CHILD_ENVIRONMENT_ALLOWLIST.has(key.toUpperCase())
  ));
  return {
    ...environment,
    JOB_FINDER_B_GRADE_VALIDATOR_INPUT: JSON.stringify(input)
  };
}

export async function executeBGradeValidatorCommand(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  forceKillGraceMs = CHILD_FORCE_KILL_GRACE_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    let forceKillTimer: NodeJS.Timeout | undefined;
    let child: ChildProcess;
    let spawnError: Error | undefined;
    let outputLimitError: Error | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    const cleanup = () => {
      signal?.removeEventListener("abort", abortChild);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    const abortChild = () => {
      signalValidatorProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(
        () => signalValidatorProcessTree(child, "SIGKILL"),
        forceKillGraceMs
      );
      forceKillTimer.unref();
    };
    child = spawn(
      executable,
      [...args],
      {
        env: environment,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const collect = (target: Buffer[]) => (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > CHILD_OUTPUT_MAX_BYTES) {
        outputLimitError = new Error("Isolated B-grade traversal process exceeded its output limit");
        signalValidatorProcessTree(child, "SIGKILL");
        return;
      }
      target.push(bytes);
    };
    child.stdout?.on("data", collect(stdoutChunks));
    child.stderr?.on("data", collect(stderrChunks));
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, closeSignal) => {
      if (process.platform !== "win32") {
        signalValidatorProcessTree(child, "SIGKILL");
      }
      cleanup();
      const output = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const error = outputLimitError ?? spawnError ?? (code === 0
        ? undefined
        : new Error(`validator process exited with code ${String(code)} signal ${String(closeSignal)}`));
      if (output.length > 0) {
        if (!error) {
          resolve(output);
          return;
        }
        try {
          if (processResponseSchema.parse(JSON.parse(output)).decision === "FAILED") {
            resolve(output);
            return;
          }
        } catch {
          // Fall through to the process error. A non-zero process may only
          // return the explicit FAILED envelope.
        }
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(
        stderr.slice(0, 2_000) || error?.message || "Isolated B-grade traversal process produced no result",
        { cause: error }
      ));
    });
    signal?.addEventListener("abort", abortChild, { once: true });
    if (signal?.aborted) abortChild();
  });
}

function signalValidatorProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || (process.platform === "win32" && child.exitCode !== null)) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      child.kill(signal);
    }
  }
}

async function executeProductionValidator(
  input: Omit<ValidatorInput, "signal">,
  signal: AbortSignal | undefined
): Promise<string> {
  return executeBGradeValidatorCommand(
    process.execPath,
    productionTsxProcessArgs("scripts/p0-b-grade-validator.ts"),
    bGradeValidatorChildEnvironment(process.env, input),
    signal
  );
}

export const runIsolatedBGradeTraversalValidator =
  createIsolatedBGradeTraversalValidator(executeProductionValidator);
