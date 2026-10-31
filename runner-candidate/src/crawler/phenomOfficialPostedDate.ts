/** Exact Phenom timestamp grammar; compare local components before offset conversion to reject rollover.
 * dateCreated, page metadata, missing zones and inferred dates are deliberately not inputs.
 * No age or future-date judgment: HTTP start is not an upper bound on a response's posting time. */
export function phenomOfficialPostedDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2})(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second, millisecond] = match.slice(1, 8).map(Number);
  const offsetHour = Number(match[9]);
  const offsetMinute = Number(match[10]);
  if (!year || offsetHour > 23 || offsetMinute > 59) return undefined;
  const local = new Date(0);
  local.setUTCFullYear(year!, month! - 1, day);
  local.setUTCHours(hour!, minute, second, millisecond);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day ||
    local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecond) return undefined;
  const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (match[8] === "+" ? 1 : -1);
  const instant = local.getTime() - offset;
  if (!Number.isFinite(instant)) return undefined;
  return new Date(instant).toISOString();
}
