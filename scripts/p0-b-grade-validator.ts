import { runBGradeIndependentTraversalValidator } from "../src/crawler/traversalCertificate";
import {
  classifyBGradeIndependentTraversalFailure,
  safeBGradeIndependentTraversalFailureReason
} from "../src/crawler/independentTraversalDiagnostics";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort(new Error(`B-grade validator received ${signal}`)));
}

try {
  const rawInput = process.env.JOB_FINDER_B_GRADE_VALIDATOR_INPUT;
  if (!rawInput) throw new Error("B-grade validator input is required");
  const input = JSON.parse(rawInput) as Parameters<typeof runBGradeIndependentTraversalValidator>[0];
  const validation = await runBGradeIndependentTraversalValidator({ ...input, signal: controller.signal });
  process.stdout.write(JSON.stringify({ decision: "SUCCEEDED", validation }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    decision: "FAILED",
    failureCode: classifyBGradeIndependentTraversalFailure(error),
    message: safeBGradeIndependentTraversalFailureReason(error)
  }));
  process.exitCode = 1;
}
