import { describe, expect, it } from "vitest";
import { runFullReleaseOracleProductionScenario } from "./helpers/fullReleaseOracleProductionScenario";

describe("FULL_RELEASE production oracle integration", () => {
  it("rejects fixed-dummy no-key v3 envelopes at command and batch entry before DB mutation", async () => {
    const command = await runFullReleaseOracleProductionScenario("no-key-command" as never);
    expect(command).toMatchObject({ status: 0, rejected: true, syncCalls: 0, transactionCalls: 0, batchCreates: 0 });
    expect(command.error).toMatch(/registry|signing key/i);
    const batch = await runFullReleaseOracleProductionScenario("no-key-batch" as never);
    expect(batch).toMatchObject({ status: 0, rejected: true, transactionCalls: 0, batchCreates: 0 });
    expect(batch.error).toMatch(/registry|signing key/i);
  });
  it("rejects invalid oracle at command and batch entry before any DB mutation", async () => {
    const command = await runFullReleaseOracleProductionScenario("invalid-command");
    expect(command).toMatchObject({ status: 0, rejected: true, syncCalls: 0, transactionCalls: 0, batchCreates: 0 });
    const batch = await runFullReleaseOracleProductionScenario("invalid-batch");
    expect(batch).toMatchObject({ status: 0, rejected: true, transactionCalls: 0, batchCreates: 0 });
  });

  it("rejects a current-runtime self-derived signer pair at command entry before DB mutation", async () => {
    const result = await runFullReleaseOracleProductionScenario("self-derived-command" as never);
    expect(result).toMatchObject({ status: 0, rejected: true, syncCalls: 0, transactionCalls: 0, batchCreates: 0 });
    expect(result.error).toMatch(/signature|identity|registry/i);
  });

  it("rejects a known test-key fetch-derived pair before mutation even under NODE_ENV=test", async () => {
    const result = await runFullReleaseOracleProductionScenario("known-test-key-command");
    expect(result).toMatchObject({ status: 0, rejected: true, syncCalls: 0, transactionCalls: 0, batchCreates: 0 });
    expect(result.error).toMatch(/registry|trusted|test key/i);
  });

  it.each([
    ["empty-incomplete-audits-command", /company|audit|roster|60/i],
    ["empty-wrong-roster-command", /roster|confirmed/i],
    ["empty-untrusted-signature-command", /signature|registry|trusted|key/i]
  ] as const)("rejects fixed-dummy no-key %s before command mutation", async (mode,errorPattern) => {
    const result = await runFullReleaseOracleProductionScenario(mode);
    expect(result).toMatchObject({status:0,rejected:true,syncCalls:0,transactionCalls:0,batchCreates:0});
    expect(result.error).toMatch(errorPattern);
  });
});
