import { sourceFetchDiagnostic } from "../src/crawler/sourceFetchDiagnostics";
import { runBGradeIndependentTraversalValidator } from "../src/crawler/traversalCertificate";
import { runWithOfficialSourceCancellation } from "../src/crawler/officialHttpRuntimeLimits";
import { withWorkdayRequestPolicy } from "../src/crawler/workdayRequestPolicy";
import { serializeBGradeTransportObservation, serializeBGradeValidatorSuccess } from "../src/crawler/isolatedBGradeTraversalValidator";
import { withSourceTransportObservation, type SourceTransportObservation } from "../src/crawler/sourceTransportObservation";
import {
  classifyBGradeIndependentTraversalFailure,
  safeBGradeIndependentTraversalFailureReason
} from "../src/crawler/independentTraversalDiagnostics";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort(new Error(`B-grade validator received ${signal}`)));
}

let sourceId = "INVALID_SOURCE_ID";
let transportObservation: SourceTransportObservation | undefined;
try {
  const rawInput = process.env.JOB_FINDER_B_GRADE_VALIDATOR_INPUT;
  if (!rawInput) throw new Error("B-grade validator input is required");
  const input = JSON.parse(rawInput) as Parameters<typeof runBGradeIndependentTraversalValidator>[0];
  sourceId = input.sourceId;
  const workdayRoot = input.sourceId === "source-pfizer-china-social" ? process.env.JOBFINDER_WORKDAY_POLICY_ROOT : undefined;
  const run = () => withSourceTransportObservation(sourceId, observation => {
    transportObservation = observation;
    process.stderr.write(serializeBGradeTransportObservation(observation));
  }, () => runWithOfficialSourceCancellation(controller.signal,
    () => runBGradeIndependentTraversalValidator({ ...input, signal: controller.signal })));
  const validation = await (workdayRoot ? withWorkdayRequestPolicy(workdayRoot, run) : run());
  process.stdout.write(serializeBGradeValidatorSuccess(validation, transportObservation));
} catch (error) {
  process.stdout.write(JSON.stringify({
    decision: "FAILED",
    diagnostic: sourceFetchDiagnostic(sourceId, {error}),
    failureCode: classifyBGradeIndependentTraversalFailure(error),
    message: safeBGradeIndependentTraversalFailureReason(error),
    ...(transportObservation ? { transportObservation } : {})
  }));
  process.exitCode = 1;
}
