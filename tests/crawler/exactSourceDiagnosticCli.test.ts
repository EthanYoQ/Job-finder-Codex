import { describe, expect, it } from "vitest";
import {
  parseExactSourceDiagnosticCommand,
  runExactSourceDiagnosticCommand
} from "../../scripts/p0-exact-source-diagnostic";

describe("exact-source diagnostic CLI", () => {
  it("parses one to five repeated source IDs for prepare", () => {
    expect(parseExactSourceDiagnosticCommand([
      "prepare",
      "--session", "/diagnostic/session.json",
      "--source-id", "source-a",
      "--source-id", "source-b"
    ])).toEqual({
      command: "prepare",
      sessionPath: "/diagnostic/session.json",
      sourceIds: ["source-a", "source-b"]
    });
  });

  it("parses report paths without accepting source selection", () => {
    expect(parseExactSourceDiagnosticCommand([
      "report",
      "--session", "/diagnostic/session.json",
      "--report", "/diagnostic/report.json"
    ])).toEqual({
      command: "report",
      sessionPath: "/diagnostic/session.json",
      reportPath: "/diagnostic/report.json"
    });
  });

  it("publishes the prepared NON_CERTIFYING session", async () => {
    const writes: Array<{ path: string; value: unknown }> = [];
    const session = {
      schemaVersion: "exact-source-diagnostic-v1" as const,
      mode: "NON_CERTIFYING" as const,
      releaseCandidateId: "rc-1",
      commitSha: "a".repeat(40),
      preparedAt: "2026-08-14T12:00:00.000Z",
      requests: [{ requestId: "request-1", sourceId: "source-a" }]
    };

    await expect(runExactSourceDiagnosticCommand({
      command: "prepare",
      sessionPath: "/diagnostic/session.json",
      sourceIds: ["source-a"]
    }, {
      prepare: async () => session,
      report: async () => { throw new Error("not used"); },
      writeJson: async (path, value) => { writes.push({ path, value }); }
    })).resolves.toEqual({ exitCode: 0 });
    expect(writes).toEqual([{ path: "/diagnostic/session.json", value: session }]);
  });
});
