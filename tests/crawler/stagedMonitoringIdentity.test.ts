import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import {
  loadProductionStagedMonitoringIdentity,
  loadStagedMonitoringIdentity,
  type ProductionStagedMonitoringIdentityDeps,
  type StagedMonitoringIdentityDb
} from "../../src/crawler/stagedMonitoringIdentity";

const resolver = vi.hoisted(() => vi.fn());

vi.mock("../../src/crawler/stagedScheduleAuthority", () => ({
  resolveCurrentStagedScheduleAuthority: resolver
}));

const runtimeIdentity = Object.freeze({
  releaseCandidateId: "rc-staged-monitor",
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  batchKind: "SCHEDULED" as const,
  ownerId: "staged-scheduler",
  expectedPlannedSourceIds: ["source-a", "source-b"],
  expectedPlannedSourceSetSha256: hashCanonicalStringSet(["source-a", "source-b"]),
  expectedPlannedSourceCount: 2
});

const evidenceIdentity = Object.freeze({
  releaseCandidateId: runtimeIdentity.releaseCandidateId,
  commitSha: runtimeIdentity.commitSha,
  rosterSha256: runtimeIdentity.rosterSha256,
  sourcePlanSha256: runtimeIdentity.sourcePlanSha256,
  sourceConfigSha256: runtimeIdentity.sourceConfigSha256,
  adapterBundleSha256: runtimeIdentity.adapterBundleSha256,
  plannedSourceSetSha256: runtimeIdentity.expectedPlannedSourceSetSha256,
  plannedSourceCount: runtimeIdentity.expectedPlannedSourceCount
});

function readOnlyDb(): StagedMonitoringIdentityDb {
  return {
    releaseCandidate: {
      findMany: vi.fn(async () => [])
    }
  };
}

beforeEach(() => {
  resolver.mockReset();
  resolver.mockResolvedValue({ companies: [], plans: [], identity: runtimeIdentity });
});

describe("staged monitoring identity", () => {
  it("resolves staged authority exactly once and returns only its canonical evidence identity", async () => {
    const db = readOnlyDb();

    await expect(loadStagedMonitoringIdentity(db)).resolves.toEqual(evidenceIdentity);

    expect(loadStagedMonitoringIdentity).toHaveLength(1);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(db);
    expectTypeOf<keyof StagedMonitoringIdentityDb>().toEqualTypeOf<"releaseCandidate">();
  });

  it("propagates staged resolver rejection without consulting caller authority", async () => {
    const authorityError = new Error("staged authority unavailable");
    resolver.mockRejectedValueOnce(authorityError);

    await expect(loadStagedMonitoringIdentity(readOnlyDb())).rejects.toBe(authorityError);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

describe("production staged monitoring database lifecycle", () => {
  function harness(loadIdentity = vi.fn(async () => evidenceIdentity)) {
    const disconnect = vi.fn(async () => undefined);
    const client = { ...readOnlyDb(), $disconnect: disconnect };
    const createClient = vi.fn(async (_databaseUrl: string) => client);
    const deps: ProductionStagedMonitoringIdentityDeps = { createClient, loadIdentity };
    return { deps, client, createClient, disconnect, loadIdentity };
  }

  it("creates one client for the authority read and disconnects after success", async () => {
    const fixture = harness();

    await expect(loadProductionStagedMonitoringIdentity(
      "postgresql://jobfinder:secret@postgres:5432/jobfinder",
      fixture.deps
    )).resolves.toEqual(evidenceIdentity);

    expect(fixture.createClient).toHaveBeenCalledTimes(1);
    expect(fixture.createClient).toHaveBeenCalledWith("postgresql://jobfinder:secret@postgres:5432/jobfinder");
    expect(fixture.loadIdentity).toHaveBeenCalledTimes(1);
    expect(fixture.loadIdentity).toHaveBeenCalledWith(fixture.client);
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when authority resolution fails and propagates the failure", async () => {
    const authorityError = new Error("no matching staged release candidate");
    const fixture = harness(vi.fn(async () => { throw authorityError; }));

    await expect(loadProductionStagedMonitoringIdentity(
      "postgresql://jobfinder:secret@postgres:5432/jobfinder",
      fixture.deps
    )).rejects.toBe(authorityError);
    expect(fixture.disconnect).toHaveBeenCalledTimes(1);
  });

  it("never returns authority when disconnect fails", async () => {
    const fixture = harness();
    fixture.disconnect.mockRejectedValueOnce(new Error("disconnect failed"));

    await expect(loadProductionStagedMonitoringIdentity(
      "postgresql://jobfinder:secret@postgres:5432/jobfinder",
      fixture.deps
    )).rejects.toThrow("disconnect failed");
  });

  it.each([undefined, "", "not-a-url", "https://postgres/jobfinder"])(
    "rejects missing or non-PostgreSQL DATABASE_URL %s before creating a client",
    async (databaseUrl) => {
      const fixture = harness();
      await expect(loadProductionStagedMonitoringIdentity(databaseUrl, fixture.deps)).rejects.toThrow(/DATABASE_URL/u);
      expect(fixture.createClient).not.toHaveBeenCalled();
      expect(fixture.loadIdentity).not.toHaveBeenCalled();
      expect(fixture.disconnect).not.toHaveBeenCalled();
    }
  );
});
