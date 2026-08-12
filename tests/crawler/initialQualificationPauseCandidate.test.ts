import { describe, expect, it, vi } from "vitest";
import {
  loadInitialQualificationPauseCandidateStatus,
  loadProductionInitialQualificationPauseCandidateStatus,
  type InitialQualificationPauseCandidateDb,
  type ProductionInitialQualificationPauseCandidateDeps
} from "../../src/crawler/initialQualificationPauseCandidate";
import type { InitialQualificationPauseEvidence } from "../../src/crawler/initialQualificationPauseEvidence";

const evidence = Object.freeze({
  releaseCandidateId: "rc-paused",
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64)
}) as InitialQualificationPauseEvidence;

function row(overrides: Partial<{
  id: string;
  status: string;
  commitSha: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
}> = {}) {
  return {
    id: evidence.releaseCandidateId,
    status: "INVALIDATED",
    commitSha: evidence.commitSha,
    rosterHash: evidence.rosterSha256,
    sourcePlanHash: evidence.sourcePlanSha256,
    sourceConfigHash: evidence.sourceConfigSha256,
    adapterBundleHash: evidence.adapterBundleSha256,
    ...overrides
  };
}

function db(candidate: ReturnType<typeof row> | null = row()): InitialQualificationPauseCandidateDb {
  return {
    releaseCandidate: {
      findUnique: vi.fn(async () => candidate)
    }
  };
}

describe("initial qualification pause candidate status", () => {
  it("returns the status only after an exact read-only candidate identity match", async () => {
    const database = db();

    await expect(loadInitialQualificationPauseCandidateStatus(database, evidence))
      .resolves.toBe("INVALIDATED");

    expect(database.releaseCandidate.findUnique).toHaveBeenCalledWith({
      where: { id: evidence.releaseCandidateId },
      select: {
        id: true,
        status: true,
        commitSha: true,
        rosterHash: true,
        sourcePlanHash: true,
        sourceConfigHash: true,
        adapterBundleHash: true
      }
    });
  });

  it.each([
    ["missing", null],
    ["candidate id", row({ id: "rc-other" })],
    ["commit", row({ commitSha: "9".repeat(40) })],
    ["roster", row({ rosterHash: "9".repeat(64) })],
    ["source plan", row({ sourcePlanHash: "9".repeat(64) })],
    ["source config", row({ sourceConfigHash: "9".repeat(64) })],
    ["adapter bundle", row({ adapterBundleHash: "9".repeat(64) })]
  ])("rejects %s drift", async (_label, candidate) => {
    await expect(loadInitialQualificationPauseCandidateStatus(db(candidate), evidence))
      .rejects.toThrow(/candidate.*identity|candidate.*missing/i);
  });

  it("returns a non-invalidated status so the bundle can reject it", async () => {
    await expect(loadInitialQualificationPauseCandidateStatus(
      db(row({ status: "RELEASED" })),
      evidence
    )).resolves.toBe("RELEASED");
  });
});

describe("production pause candidate database lifecycle", () => {
  function harness(candidate = row()) {
    const disconnect = vi.fn(async () => undefined);
    const client = { ...db(candidate), $disconnect: disconnect };
    const createClient = vi.fn(async (_databaseUrl: string) => client);
    const loadStatus = vi.fn(loadInitialQualificationPauseCandidateStatus);
    const deps: ProductionInitialQualificationPauseCandidateDeps = { createClient, loadStatus };
    return { deps, client, createClient, disconnect, loadStatus };
  }

  it("creates one client, performs the read, and always disconnects", async () => {
    const fixture = harness();
    const url = "postgresql://jobfinder:secret@postgres:5432/jobfinder";

    await expect(loadProductionInitialQualificationPauseCandidateStatus(url, evidence, fixture.deps))
      .resolves.toBe("INVALIDATED");

    expect(fixture.createClient).toHaveBeenCalledWith(url);
    expect(fixture.loadStatus).toHaveBeenCalledWith(fixture.client, evidence);
    expect(fixture.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after an identity failure", async () => {
    const fixture = harness(row({ commitSha: "9".repeat(40) }));
    await expect(loadProductionInitialQualificationPauseCandidateStatus(
      "postgresql://jobfinder:secret@postgres:5432/jobfinder",
      evidence,
      fixture.deps
    )).rejects.toThrow(/identity/i);
    expect(fixture.disconnect).toHaveBeenCalledOnce();
  });

  it.each([undefined, "", "not-a-url", "https://postgres/jobfinder"])(
    "rejects an invalid DATABASE_URL without exposing credentials: %s",
    async (databaseUrl) => {
      const fixture = harness();
      const secret = "do-not-leak";
      const input = databaseUrl ?? `postgresql://user:${secret}@/missing-host`;
      let failure: unknown;
      try {
        await loadProductionInitialQualificationPauseCandidateStatus(input, evidence, fixture.deps);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/DATABASE_URL/u);
      expect((failure as Error).message).not.toContain(secret);
      expect(fixture.createClient).not.toHaveBeenCalled();
      expect(fixture.disconnect).not.toHaveBeenCalled();
    }
  );
});
