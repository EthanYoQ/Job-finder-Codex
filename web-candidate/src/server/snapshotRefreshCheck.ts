import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Bounds correlation lifetime only; never a cache freshness TTL. */
export const SNAPSHOT_CHECK_MAX_AGE_MS = 60_000;
export const SNAPSHOT_CHECK_MAX_LENGTH = 96;

/** A process-owned key and numeric watermarks need no per-client token storage. */
export function createSnapshotRefreshChecks() {
  const key = randomBytes(32);
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    issue(sequence: number, now: number): string {
      const payload = `${sequence}.${now + SNAPSHOT_CHECK_MAX_AGE_MS}`;
      return `${payload}.${sign(payload)}`;
    },
    read(token: string, latest: number, now: number): number | undefined {
      if (token.length > SNAPSHOT_CHECK_MAX_LENGTH || !/^[1-9]\d*\.\d+\.[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
      const [rawSequence, rawExpires, signature] = token.split(".");
      const sequence = Number(rawSequence), expires = Number(rawExpires);
      if (!Number.isSafeInteger(sequence) || sequence > latest || !Number.isSafeInteger(expires) ||
          now >= expires || expires - now > SNAPSHOT_CHECK_MAX_AGE_MS) return undefined;
      const expected = Buffer.from(sign(`${rawSequence}.${rawExpires}`));
      return timingSafeEqual(Buffer.from(signature!), expected) ? sequence : undefined;
    }
  };
}
