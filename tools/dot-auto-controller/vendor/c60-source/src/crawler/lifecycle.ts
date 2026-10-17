import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";

export type LifecycleStatus = "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE";

export interface JobSnapshot {
  dedupeKey: string;
  record: NormalizedJobRecord;
  lifecycleStatus: LifecycleStatus;
  missingSuccessfulCrawlCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LifecycleDecision extends JobSnapshot {
  isNew: boolean;
}

export interface ApplyCrawlObservationOptions {
  observation?: LifecycleObservationTruth;
  /** Legacy runtime compatibility only; cannot advance misses without explicit observation truth. */
  crawlSucceeded?: boolean;
  /** Legacy runtime compatibility only; cannot establish atomic commit eligibility. */
  completenessVerified?: boolean;
  observedAt: string;
  baselineCompletedBeforeCrawl: boolean;
}

export type LifecycleObservationTruth =
  | { disposition: "TRUSTED_COMPLETE"; atomicCommitEligible: true }
  | { disposition: "TRUSTED_PARTIAL"; atomicCommitEligible: true }
  | { disposition: "CRAWL_FAILED" | "INCOMPLETE" | "BLOCKED" | "SKIPPED" | "UNAUDITED" | "NON_ATOMIC"; atomicCommitEligible: false };

export function applyCrawlObservation(
  previousJobs: readonly JobSnapshot[],
  currentJobs: readonly NormalizedJobRecord[],
  options: ApplyCrawlObservationOptions
): LifecycleDecision[] {
  validatePreviousSnapshots(previousJobs);
  const observedAtEpoch = parseStrictUtcTimestamp(options.observedAt);
  if (previousJobs.some((snapshot) => observedAtEpoch < parseStrictUtcTimestamp(snapshot.lastSeenAt))) {
    throw new Error("OBSERVATION_TIMESTAMP_PRECEDES_LAST_SEEN");
  }
  const previousByKey = new Map(previousJobs.map((snapshot) => [snapshot.dedupeKey, snapshot]));
  const explicitTruth=options.observation;
  if ((explicitTruth && (!(["TRUSTED_COMPLETE", "TRUSTED_PARTIAL"] as string[]).includes(explicitTruth.disposition) ||
      explicitTruth.atomicCommitEligible !== true)) ||
      (!explicitTruth && options.crawlSucceeded !== true)) {
    return [...previousJobs].sort(compareSnapshots).map((snapshot) => ({
      ...snapshot,
      isNew: false
    }));
  }
  const canTrustMissingJobs=explicitTruth?.disposition === "TRUSTED_COMPLETE" && explicitTruth.atomicCommitEligible === true;

  const currentByKey = new Map<string, NormalizedJobRecord>();

  for (const record of currentJobs) {
    const key = buildJobDedupeKey(record);
    const existing = currentByKey.get(key);
    if (!existing || compareUtf8(canonicalJson(record), canonicalJson(existing)) < 0) currentByKey.set(key, record);
  }

  const decisions: LifecycleDecision[] = [];

  for (const [dedupeKey, record] of [...currentByKey].sort(([left], [right]) => compareUtf8(left, right))) {
    const previous = previousByKey.get(dedupeKey);
    const isNew =
      previous === undefined &&
      options.baselineCompletedBeforeCrawl &&
      !record.isBaseline;

    decisions.push({
      dedupeKey,
      // Normalized records are treated as immutable reducer inputs; preserve references.
      record,
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      firstSeenAt: previous?.firstSeenAt ?? options.observedAt,
      lastSeenAt: options.observedAt,
      isNew
    });
  }

  for (const previous of [...previousJobs].sort(compareSnapshots)) {
    if (currentByKey.has(previous.dedupeKey)) {
      continue;
    }

    const missingSuccessfulCrawlCount = previous.missingSuccessfulCrawlCount + 1;

    if (!canTrustMissingJobs) { decisions.push({...previous,isNew:false}); continue; }

    decisions.push({
      ...previous,
      lifecycleStatus: "OFFLINE",
      missingSuccessfulCrawlCount,
      isNew: false
    });
  }

  return decisions;
}

function validatePreviousSnapshots(previousJobs: readonly JobSnapshot[]): void {
  const keys=new Set<string>();
  for (const snapshot of previousJobs) {
    const firstSeenAt=parseStrictUtcTimestamp(snapshot.firstSeenAt);
    const lastSeenAt=parseStrictUtcTimestamp(snapshot.lastSeenAt);
    // Read old GRACE/SUSPECTED snapshots unchanged until a trusted complete observation.
    const count = snapshot.missingSuccessfulCrawlCount;
    const validStatus = count === 0 ? snapshot.lifecycleStatus === "ACTIVE" :
      snapshot.lifecycleStatus === "OFFLINE" ||
      (count === 1 && snapshot.lifecycleStatus === "ACTIVE") ||
      (count === 2 && snapshot.lifecycleStatus === "SUSPECTED_OFFLINE");
    if (keys.has(snapshot.dedupeKey) || snapshot.dedupeKey !== buildJobDedupeKey(snapshot.record) ||
        !Number.isSafeInteger(snapshot.missingSuccessfulCrawlCount) || snapshot.missingSuccessfulCrawlCount < 0 ||
        !validStatus || firstSeenAt > lastSeenAt) {
      throw new Error("INVALID_PRIOR_LIFECYCLE_SNAPSHOT");
    }
    keys.add(snapshot.dedupeKey);
  }
}

function parseStrictUtcTimestamp(value: string): number {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value);
  if(!match)throw new Error("INVALID_LIFECYCLE_TIMESTAMP");
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]),millis=Number(match[7] ?? "0");
  const maxDay=[4,6,9,11].includes(month)?30:month===2?(year%4===0&&(year%100!==0||year%400===0)?29:28):31;
  if(month<1||month>12||day<1||day>maxDay||hour>23||minute>59||second>59)throw new Error("INVALID_LIFECYCLE_TIMESTAMP");
  const date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,millis);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||date.getUTCSeconds()!==second||date.getUTCMilliseconds()!==millis)throw new Error("INVALID_LIFECYCLE_TIMESTAMP");
  return date.getTime();
}

function compareSnapshots(left: JobSnapshot, right: JobSnapshot): number { return compareUtf8(left.dedupeKey,right.dedupeKey); }
function compareUtf8(left:string,right:string):number { return Buffer.from(left,"utf8").compare(Buffer.from(right,"utf8")); }
function canonicalJson(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>compareUtf8(a,b)).map(([k,v])=>`${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
