import { describe, expect, it } from "vitest";
import {
  hashCanonicalStringSet,
  validatePlannedSourceContract,
  validateRuntimeBatchIdentity
} from "../../src/crawler/runtimeBatchIdentity";

const emptyIdentity = {
  releaseCandidateId: "rc-empty",
  commitSha: "1".repeat(40),
  rosterSha256: "a".repeat(64),
  sourcePlanSha256: "b".repeat(64),
  sourceConfigSha256: "c".repeat(64),
  adapterBundleSha256: "d".repeat(64),
  batchKind: "FULL_RELEASE" as const,
  ownerId: "empty-contract-test",
  expectedPlannedSourceIds: [],
  expectedPlannedSourceSetSha256: hashCanonicalStringSet([]),
  expectedPlannedSourceCount: 0
};

describe("runtime planned source identity", () => {
  it("accepts the canonical empty planned-set count and hash contract", () => {
    expect(() => validateRuntimeBatchIdentity(emptyIdentity)).not.toThrow();
    expect(validatePlannedSourceContract(emptyIdentity, [])).toEqual([]);
  });

  it("still rejects empty-set count and hash mismatches", () => {
    expect(() => validateRuntimeBatchIdentity({ ...emptyIdentity, expectedPlannedSourceCount: 1 })).toThrow(/count/i);
    expect(() => validateRuntimeBatchIdentity({ ...emptyIdentity, expectedPlannedSourceSetSha256: "0".repeat(64) })).toThrow(/hash/i);
  });
});
