export type OfficialRetryAfter = { value: string; delayMs: number } | { invalid: true };

/** Keep only an unambiguous bounded header, never arbitrary upstream text. */
export function parseOfficialRetryAfter(value: string | null, observedAtMs: number): OfficialRetryAfter | undefined {
  if (value === null) return undefined;
  if (value.length > 64 || !Number.isFinite(observedAtMs)) return { invalid: true };
  const normalized = value.replace(/^[ \t]+|[ \t]+$/gu, "");
  if (/^[0-9]{1,10}$/u.test(normalized)) {
    return { value: normalized, delayMs: Number(normalized) * 1_000 };
  }
  // Accept canonical IMF-fixdate only; obsolete, duplicate or ambiguous dates fail closed.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/u.test(normalized)) return { invalid: true };
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== normalized) return { invalid: true };
  return { value: normalized, delayMs: Math.max(0, timestamp - observedAtMs) };
}
