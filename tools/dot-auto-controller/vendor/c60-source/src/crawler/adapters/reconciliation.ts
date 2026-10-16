import { createHash } from "node:crypto";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../normalizedJob";
import { canonicalStringSetSha256 } from "../sourceFetchEvidence";
import type { AdapterCollisionGroup, AdapterLoss, AdapterReconciliation, CrawlAdapterResult } from "./types";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const candidateValue = (job: NormalizedJobRecord) => JSON.stringify({
  key: buildJobDedupeKey(job), title: job.officialTitle, url: job.officialUrl,
  location: job.locationRaw, publishedAt: job.officialPublishedAt ?? ""
});
const compareUtf8 = (left: string, right: string) =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

export function reconcileAdapterRows(rawInputCount: number, parsedCount: number,
  valid: readonly NormalizedJobRecord[], adapterLosses: AdapterLoss[]): { jobs: NormalizedJobRecord[]; reconciliation: AdapterReconciliation } {
  const groups = new Map<string, NormalizedJobRecord[]>();
  for (const job of valid) { const key = buildJobDedupeKey(job); groups.set(key, [...(groups.get(key) ?? []), job]); }
  const jobs: NormalizedJobRecord[] = [];
  const collisionGroups: AdapterCollisionGroup[] = [];
  for (const [key, candidates] of groups) {
    const ordered = [...candidates].sort((a, b) => compareUtf8(candidateValue(a), candidateValue(b)));
    const winner = ordered[0]!; jobs.push(winner);
    if (ordered.length > 1) { const commitments = ordered.map((item, index) => sha(`${candidateValue(item)}#${index}`));
      collisionGroups.push({ dedupeKeySha256: sha(key), candidateKeySha256: commitments,
      winnerKeySha256: commitments[0]!, droppedCount: ordered.length - 1,
      dropReason: "DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER" });
    }
  }
  const outputKeys = jobs.map(buildJobDedupeKey).sort(compareUtf8);
  const unsigned = { rawInputCount, parsedCount, validBeforeDedupeCount: valid.length,
    dedupeInputCount: valid.length, dedupeOutputCount: jobs.length, adapterLosses, collisionGroups,
    outputJobKeyCommitments: outputKeys.map(sha), outputJobKeySetSha256: canonicalStringSetSha256(outputKeys) };
  const reconciliation: AdapterReconciliation = { ...unsigned, ledgerSha256: sha(JSON.stringify(unsigned)) };
  return { jobs, reconciliation };
}

export function assertAdapterReconciliation(result: Pick<CrawlAdapterResult, "jobs" | "observation" | "reconciliation">): AdapterReconciliation {
  const ledger = result.reconciliation;
  const fail = () => { throw new Error("Adapter reconciliation validation failed"); };
  if (!ledger) return fail();
  const unsigned = { ...ledger } as AdapterReconciliation;
  delete (unsigned as Partial<AdapterReconciliation>).ledgerSha256;
  if (sha(JSON.stringify(unsigned)) !== ledger.ledgerSha256) return fail();
  const parseLosses = ledger.adapterLosses.filter((loss) => loss.stage === "PARSE");
  const validationLosses = ledger.adapterLosses.filter((loss) => loss.stage === "VALIDATION");
  const indices = ledger.adapterLosses.map((loss) => loss.rawIndex);
  if (indices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= ledger.rawInputCount) || new Set(indices).size !== indices.length) return fail();
  if (ledger.rawInputCount !== ledger.parsedCount + parseLosses.length ||
    ledger.parsedCount !== ledger.validBeforeDedupeCount + validationLosses.length ||
    ledger.dedupeInputCount !== ledger.validBeforeDedupeCount) return fail();
  let dropped = 0;
  const collisionDedupeKeys = new Set<string>();
  for (const group of ledger.collisionGroups) {
    const winnerJob = result.jobs.find((job) => sha(buildJobDedupeKey(job)) === group.dedupeKeySha256);
    if (group.dropReason !== "DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER" ||
      !/^[0-9a-f]{64}$/u.test(group.dedupeKeySha256) || !winnerJob ||
      collisionDedupeKeys.has(group.dedupeKeySha256) ||
      group.candidateKeySha256.length < 2 || new Set(group.candidateKeySha256).size !== group.candidateKeySha256.length ||
      group.candidateKeySha256.some((value) => !/^[0-9a-f]{64}$/u.test(value)) ||
      !group.candidateKeySha256.includes(group.winnerKeySha256) ||
      group.winnerKeySha256 !== sha(`${candidateValue(winnerJob)}#0`) ||
      group.droppedCount !== group.candidateKeySha256.length - 1) return fail();
    collisionDedupeKeys.add(group.dedupeKeySha256);
    dropped += group.droppedCount;
  }
  if (ledger.dedupeOutputCount + dropped !== ledger.dedupeInputCount || result.jobs.length !== ledger.dedupeOutputCount ||
    result.observation.structuredJobCount !== ledger.dedupeOutputCount) return fail();
  const keys = result.jobs.map(buildJobDedupeKey).sort(compareUtf8);
  if (new Set(keys).size !== keys.length || JSON.stringify(keys.map(sha)) !== JSON.stringify(ledger.outputJobKeyCommitments) ||
    canonicalStringSetSha256(keys) !== ledger.outputJobKeySetSha256) return fail();
  return ledger;
}

export function emptyReconciliation(): AdapterReconciliation {
  return reconcileAdapterRows(0, 0, [], []).reconciliation;
}
