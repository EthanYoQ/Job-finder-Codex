import { LIMITS, TARGET, iso, requireFact, validateExpected, validateJob } from './contract.mjs';

/** Pure comparison. No normalization that could hide title/URL differences. */
export function comparePublicList(expected, jobs, displayedCount) {
  validateExpected(expected);
  requireFact(Array.isArray(jobs) && jobs.length <= LIMITS.maxJobs, 'INVALID_LIST');
  jobs.forEach(j => validateJob(j, true));
  const wanted = new Map(expected.jobs.map(j => [j.sourceJobId, j]));
  const actual = new Map(); const duplicateIds = [];
  for (const j of jobs) { if (actual.has(j.sourceJobId)) duplicateIds.push(j.sourceJobId); actual.set(j.sourceJobId, j); }
  const missingIds = [...wanted.keys()].filter(id => !actual.has(id)).sort();
  const extraIds = [...actual.keys()].filter(id => !wanted.has(id)).sort();
  const titleMismatches = [], urlMismatches = [], renderedTitleMismatches = [];
  for (const [id, j] of actual) {
    const e = wanted.get(id);
    if (e && e.officialTitle !== j.officialTitle) titleMismatches.push(id);
    if (e && e.officialUrl !== j.officialUrl) urlMismatches.push(id);
    if (j.renderedOriginalTitle !== j.officialTitle || (e && j.renderedOriginalTitle !== e.officialTitle))
      renderedTitleMismatches.push(id);
  }
  const removedVisibleIds = expected.removedIds.filter(id => actual.has(id)).sort();
  const structurallyExact = displayedCount === jobs.length && !duplicateIds.length && !missingIds.length
    && !titleMismatches.length && !urlMismatches.length && !renderedTitleMismatches.length;
  const exact = structurallyExact && !extraIds.length && !removedVisibleIds.length;
  // A known stale list permits one reload, never a pass. All current fields must already match.
  const knownStale = structurallyExact && expected.removedIds.length > 0
    && extraIds.join('\0') === [...expected.removedIds].sort().join('\0');
  return { status: exact ? 'EXACT' : knownStale ? 'KNOWN_STALE_REMOVALS' : 'MISMATCH',
    expectedCount: wanted.size, actualCount: jobs.length, uniqueActualCount: actual.size,
    displayedCount, duplicateIds: duplicateIds.sort(), missingIds, extraIds,
    titleMismatches: titleMismatches.sort(), urlMismatches: urlMismatches.sort(),
    renderedTitleMismatches: renderedTitleMismatches.sort(), removedVisibleIds };
}

export function compareSourceMinute(expectedObservedAt, sourceTime) {
  requireFact(sourceTime !== null, 'SOURCE_TIME_MISSING');
  requireFact(iso(expectedObservedAt), 'INVALID_EXPECTED_TIME');
  requireFact(sourceTime.companyId === TARGET.companyId && sourceTime.companyName === TARGET.companyName
    && sourceTime.officialEntry === TARGET.officialEntry && sourceTime.label === '最近成功更新', 'WRONG_TIME_SOURCE');
  requireFact(sourceTime.timezone === 'UTC' && sourceTime.timezoneEvidence === 'VISIBLE_UTC_LABEL', 'HOLD_TIME_UNKNOWN');
  requireFact(sourceTime.precision === 'minute', 'SOURCE_TIME_PRECISION_INSUFFICIENT');
  requireFact(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/.test(sourceTime.text), 'SOURCE_TIME_PRECISION_INSUFFICIENT');
  const parsed = sourceTime.text.replace(' ', 'T').replace(' UTC', ':00.000Z');
  requireFact(Number.isFinite(Date.parse(parsed)) && new Date(parsed).toISOString() === parsed, 'INVALID_SOURCE_MINUTE');
  const expectedMinute = expectedObservedAt.slice(0, 16).replace('T', ' ') + ' UTC';
  return { status: sourceTime.text === expectedMinute ? 'EXACT_MINUTE' : 'MISMATCH',
    expectedObservedAt, expectedMinute, observedMinute: sourceTime.text, precision: 'minute',
    secondsOrMillisecondsVerified: false };
}
