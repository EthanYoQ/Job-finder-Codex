import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { candidateCompanies } from "../data/companyRegistry";

const sourceIds = new Set(candidateCompanies.flatMap(company => company.sources.map(source => source.id)));
const timestamp = z.string().datetime({ offset: true });
const slot = z.string().regex(/^\d{13}$/);
const record = z.object({
  kind: z.literal("live"),
  slot,
  trigger: z.enum(["timer", "manual"]),
  complete: z.boolean(),
  webReadback: z.boolean(),
  capturedSourceIds: z.array(z.string().refine(id => sourceIds.has(id))).max(sourceIds.size),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: timestamp
});
const state = z.object({
  timerSlots: z.array(slot),
  records: z.array(record),
  dailySince: timestamp.optional(),
  qualifyingDays: z.array(z.string().date()).max(3).optional()
});

export type RefreshStatus = { status: "UNAVAILABLE" } | {
  status: "AVAILABLE";
  timerSlots: string[];
  records: Omit<z.infer<typeof record>, "kind">[];
  dailySince?: string;
  qualifyingDays?: string[];
};

/** Availability means readable receipts, not successful or stable scheduled runs. */
export function createRefreshStatusReader(snapshotFile: string, scheduleFile?: string): () => Promise<RefreshStatus> {
  const file = scheduleFile ?? resolve(snapshotFile) + ".schedule.json";
  return async () => {
    try {
      const parsed = state.parse(JSON.parse(await readFile(file, "utf8")));
      return {
        status: "AVAILABLE",
        timerSlots: parsed.timerSlots.slice(-16),
        records: parsed.records.slice(-16).map(({ kind: _kind, ...publicRecord }) => publicRecord),
        ...(parsed.dailySince === undefined ? {} : { dailySince: parsed.dailySince }),
        ...(parsed.qualifyingDays === undefined ? {} : { qualifyingDays: parsed.qualifyingDays })
      };
    } catch {
      // Neither stale success nor raw filesystem/validation errors are public status.
      return { status: "UNAVAILABLE" };
    }
  };
}
