import { describe, expect, it, vi } from "vitest";
import {
  bGradeValidatorChildEnvironment,
  createIsolatedBGradeTraversalValidator,
  executeBGradeValidatorCommand,
  runIsolatedBGradeTraversalValidator
} from "../../src/crawler/isolatedBGradeTraversalValidator";
import { createViatrisBrowserTraversalValidation } from "../../src/crawler/traversalCertificate";
import { classifyBGradeIndependentTraversalFailure } from "../../src/crawler/independentTraversalDiagnostics";

const input = {
  sourceId: "source-viatris-social",
  companyId: "company-viatris",
  entryUrl: "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT",
  sourceConfigSha256: "a".repeat(64),
  surfaceIds: ["surface-viatris-social"],
  channelIds: ["source:source-viatris-social:default"]
} as const;

function validation() {
  return createViatrisBrowserTraversalValidation({
    sourceConfigSha256: input.sourceConfigSha256,
    surfaceIds: input.surfaceIds,
    channelIds: input.channelIds,
    pages: [{
      pageNumber: 1,
      declaredTotalPages: 1,
      sourceJobIds: ["job-1"],
      nextControlPresent: false
    }],
    observedAt: "2026-08-16T00:00:00.000Z",
    expiresAt: "2026-08-23T00:00:00.000Z"
  });
}

describe("isolated B-grade traversal validator", () => {
  it("returns a strictly validated result from the subprocess seam", async () => {
    const expected = validation();
    const run = createIsolatedBGradeTraversalValidator(async () => JSON.stringify({
      decision: "SUCCEEDED",
      validation: expected
    }));

    await expect(run(input)).resolves.toEqual(expected);
  });

  it("preserves a typed validator failure returned by the subprocess", async () => {
    const run = createIsolatedBGradeTraversalValidator(async () => JSON.stringify({
      decision: "FAILED",
      failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
      message: "official entry navigation failed"
    }));

    const error = await run(input).catch((caught: unknown) => caught);
    expect(classifyBGradeIndependentTraversalFailure(error))
      .toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
  });

  it("retries one isolated navigation or readiness failure with a fresh subprocess", async () => {
    const expected = validation();
    const execute = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        decision: "FAILED",
        failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
        message: "official list did not become ready"
      }))
      .mockResolvedValueOnce(JSON.stringify({ decision: "SUCCEEDED", validation: expected }));
    const run = createIsolatedBGradeTraversalValidator(execute);

    await expect(run(input)).resolves.toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retries one subprocess execution failure with a fresh process", async () => {
    const expected = validation();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("validator process exited without a result"))
      .mockResolvedValueOnce(JSON.stringify({ decision: "SUCCEEDED", validation: expected }));
    const run = createIsolatedBGradeTraversalValidator(execute);

    await expect(run(input)).resolves.toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("retries one typed validator execution failure returned by the subprocess", async () => {
    const expected = validation();
    const execute = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        decision: "FAILED",
        failureCode: "B_GRADE_VALIDATOR_EXECUTION_FAILED",
        message: "browser process terminated before producing evidence"
      }))
      .mockResolvedValueOnce(JSON.stringify({ decision: "SUCCEEDED", validation: expected }));
    const run = createIsolatedBGradeTraversalValidator(execute);

    await expect(run(input)).resolves.toEqual(expected);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops after two subprocess execution failures with a closed failure code", async () => {
    const execute = vi.fn(async () => {
      throw new Error("validator process exited without a result");
    });
    const run = createIsolatedBGradeTraversalValidator(execute);

    const error = await run(input).catch((caught: unknown) => caught);
    expect(classifyBGradeIndependentTraversalFailure(error))
      .toBe("B_GRADE_VALIDATOR_EXECUTION_FAILED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops after two typed validator execution failures with the original closed code", async () => {
    const execute = vi.fn(async () => JSON.stringify({
      decision: "FAILED",
      failureCode: "B_GRADE_VALIDATOR_EXECUTION_FAILED",
      message: "browser process terminated before producing evidence"
    }));
    const run = createIsolatedBGradeTraversalValidator(execute);

    const error = await run(input).catch((caught: unknown) => caught);
    expect(classifyBGradeIndependentTraversalFailure(error))
      .toBe("B_GRADE_VALIDATOR_EXECUTION_FAILED");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("never retries a successful envelope whose source binding is invalid", async () => {
    const execute = vi.fn(async () => JSON.stringify({
      decision: "SUCCEEDED",
      validation: { ...validation(), sourceConfigSha256: "b".repeat(64) }
    }));
    const run = createIsolatedBGradeTraversalValidator(execute);

    await expect(run(input)).rejects.toThrow("Isolated B-grade traversal result binding mismatch");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("stops after two transient browser failures and never retries a policy failure", async () => {
    const readinessExecute = vi.fn(async () => JSON.stringify({
      decision: "FAILED",
      failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
      message: "official list did not become ready"
    }));
    const readinessRun = createIsolatedBGradeTraversalValidator(readinessExecute);

    const readinessError = await readinessRun(input).catch((caught: unknown) => caught);
    expect(classifyBGradeIndependentTraversalFailure(readinessError))
      .toBe("B_GRADE_BROWSER_READINESS_FAILED");
    expect(readinessExecute).toHaveBeenCalledTimes(2);

    const policyExecute = vi.fn(async () => JSON.stringify({
      decision: "FAILED",
      failureCode: "B_GRADE_POLICY_BINDING_FAILED",
      message: "registered policy mismatch"
    }));
    const policyRun = createIsolatedBGradeTraversalValidator(policyExecute);

    const policyError = await policyRun(input).catch((caught: unknown) => caught);
    expect(classifyBGradeIndependentTraversalFailure(policyError)).toBe("B_GRADE_POLICY_BINDING_FAILED");
    expect(policyExecute).toHaveBeenCalledOnce();
  });

  it("keeps the parent abort authoritative when process shutdown rejects", async () => {
    const controller = new AbortController();
    const reason = new Error("source deadline reached");
    const run = createIsolatedBGradeTraversalValidator(async () => {
      controller.abort(reason);
      throw new Error("target closed during subprocess shutdown");
    });

    const error = await run({ ...input, signal: controller.signal }).catch((caught: unknown) => caught);
    expect(error).toBe(reason);
    expect(classifyBGradeIndependentTraversalFailure(error)).toBe("B_GRADE_VALIDATOR_ABORTED");
  });

  it("force-terminates a real validator subprocess that ignores graceful abort", async () => {
    const controller = new AbortController();
    const reason = new Error("source deadline reached");
    const run = createIsolatedBGradeTraversalValidator((serializableInput, signal) =>
      executeBGradeValidatorCommand(
        process.execPath,
        ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        bGradeValidatorChildEnvironment(process.env, serializableInput),
        signal,
        100
      ));
    const startedAt = Date.now();
    const pending = run({ ...input, signal: controller.signal });
    setTimeout(() => controller.abort(reason), 50);

    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBe(reason);
    expect(classifyBGradeIndependentTraversalFailure(error)).toBe("B_GRADE_VALIDATOR_ABORTED");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("executes the production child-process adapter", async () => {
    const error = await runIsolatedBGradeTraversalValidator({
      ...input,
      sourceId: "source-unregistered"
    }).catch((caught: unknown) => caught);

    expect(classifyBGradeIndependentTraversalFailure(error)).toBe("B_GRADE_SOURCE_BINDING_FAILED");
  });

  it("does not expose parent process credentials to the browser subprocess", () => {
    const environment = bGradeValidatorChildEnvironment({
      PATH: "runtime-path",
      DATABASE_URL: "postgresql://user:password@db/private",
      ADMIN_INITIAL_PASSWORD: "admin-secret",
      GITHUB_TOKEN: "repository-token",
      GH_PAT: "alternate-token-name",
      AWS_ACCESS_KEY_ID: "cloud-identity",
      HTTP_PROXY: "http://proxy-user:proxy-password@proxy.internal:8080",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock"
    }, input);

    expect(environment).toMatchObject({
      PATH: "runtime-path",
      JOB_FINDER_B_GRADE_VALIDATOR_INPUT: JSON.stringify(input)
    });
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("ADMIN_INITIAL_PASSWORD");
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
    expect(environment).not.toHaveProperty("GH_PAT");
    expect(environment).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    expect(environment).not.toHaveProperty("HTTP_PROXY");
    expect(environment).not.toHaveProperty("SSH_AUTH_SOCK");
  });
});
