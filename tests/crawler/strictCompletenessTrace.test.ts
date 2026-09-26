import { afterEach, describe, expect, it, vi } from "vitest";
import { strictCompletenessTrace } from "../../src/crawler/strictCompletenessTrace";

describe("strict completeness trace", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays silent unless the bounded diagnostic switch is enabled", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(strictCompletenessTrace("STRICT_COMPLETENESS_GATE", "source-a", "FAILED")).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("removes control characters and bounds each untrusted token", () => {
    vi.stubEnv("STRICT_COMPLETENESS_GATE_TRACE", "1");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    strictCompletenessTrace("STRICT_HTML_PROOF", `source\n${"a".repeat(200)}`, `bad\r\n${"b".repeat(200)}`);
    const output = String(write.mock.calls[0]?.[0]);
    expect(output.split("\n")).toHaveLength(2);
    const [, sourceId, reason] = output.trimEnd().split(" ");
    expect(sourceId).toHaveLength(160);
    expect(reason).toHaveLength(160);
    expect(sourceId).toMatch(/^[A-Za-z0-9_.:-]+$/u);
    expect(reason).toMatch(/^[A-Za-z0-9_.:-]+$/u);
  });
});
