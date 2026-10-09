import { describe, expect, it } from "vitest";
import { assertControllingPlanBytesSha256, resolvePhase4GeneratorStartup }
  from "../../scripts/generate-phase4-release-manifest";

describe("Phase4 release manifest generator startup contract", () => {
  it("accepts only a fixed lowercase controlling-plan SHA environment input", () => {
    expect(() => resolvePhase4GeneratorStartup(["node", "script"], {})).toThrow(/controlling.plan/i);
    expect(() => resolvePhase4GeneratorStartup(["node", "script"], {
      PHASE4_CONTROLLING_PLAN_SHA256: "A".repeat(64)
    })).toThrow(/lowercase sha256/i);
    expect(resolvePhase4GeneratorStartup(["node", "script"], {
      PHASE4_CONTROLLING_PLAN_SHA256: "a".repeat(64)
    })).toEqual({ controllingPlanSha256: "a".repeat(64) });
  });

  it("rejects all caller CLI arguments", () => {
    expect(() => resolvePhase4GeneratorStartup(["node", "script", "--plan-sha", "a".repeat(64)], {
      PHASE4_CONTROLLING_PLAN_SHA256: "a".repeat(64)
    })).toThrow(/no caller-controlled/i);
  });

  it("binds the fixed startup digest to the controlling-plan bytes", () => {
    const bytes = Buffer.from("controlling plan\n");
    const digest = "d23192f535bad1a5f7d185eaa40af4bb573469839ab14ff24e46f82b8e59f54c";
    expect(() => assertControllingPlanBytesSha256(bytes, "0".repeat(64))).toThrow(/bytes/i);
    expect(() => assertControllingPlanBytesSha256(bytes, digest)).not.toThrow();
  });
});
