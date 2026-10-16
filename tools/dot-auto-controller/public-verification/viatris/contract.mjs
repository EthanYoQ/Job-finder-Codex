/** Public UI only. No tool, browser, database, fetch, filesystem, or session import. */
export const TARGET = Object.freeze({
  key: 'viatris', websiteUrl: 'https://job.orz.md/',
  sourceId: 'source-viatris-social', companyId: 'company-viatris',
  companyName: '晖致中国', directorySearch: '晖致', coordinate: 'B6',
  officialEntry: 'https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT',
});
export const LIMITS = Object.freeze({ totalMs: 120_000, stepMs: 15_000,
  reloads: 1, waitsPerStage: 2, waitsTotal: 8, steps: 40, maxJobs: 1000 });
export const ACTIONS = Object.freeze(['OPEN_HOME', 'CHECK_EXISTING_CONSENT',
  'ENTER_EXISTING_CONSENT', 'WAIT_VISIBLE', 'EXPAND_COMPANY', 'VIEW_ALL',
  'READ_LIST', 'OPEN_DIRECTORY', 'FILTER_COMPANY', 'READ_SOURCE_TIME', 'RELOAD']);
export const UNBOUND_PORT = Object.freeze({ enabled: false, kind: 'UNBOUND' });
export const EXISTING_CONSENT_LABEL = '我已阅读并同意 隐私政策 和 服务条款';
export class VerificationHold extends Error {
  constructor(code) { super(code); this.name = 'VerificationHold'; this.code = code; }
}
export class BrowserProtocolTimeout extends Error {
  constructor() { super('BROWSER_PROTOCOL_TIMEOUT'); this.name = 'BrowserProtocolTimeout'; }
}
export function requireFact(value, code) { if (!value) throw new VerificationHold(code); }
export function exactKeys(value, keys, code) {
  requireFact(value && typeof value === 'object' && !Array.isArray(value), code);
  const actual = Object.keys(value).sort();
  requireFact(actual.join('\0') === [...keys].sort().join('\0'), code);
}
export function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export const sha256Text = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Preserve the original html-table positionId string. Never infer it from a public URL.
export const idText = value => typeof value === 'string' && value.length > 0 && value.length <= 2000
  && !sensitiveAdapterValue(value);
// Same sensitive-assignment rule as the unchanged native safeAdapterValue.ts.
const ADAPTER_SENSITIVE_ASSIGNMENT = /(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|jwt|bearer|basic)\s*[:=]\s*\S+/iu;
function sensitiveAdapterValue(value) {
  let normalized=value.normalize('NFKC');
  for(let round=0;round<2;round++) {
    try { const decoded=decodeURIComponent(normalized).normalize('NFKC'); if(decoded===normalized)break; normalized=decoded; }
    catch { break; }
  }
  return ADAPTER_SENSITIVE_ASSIGNMENT.test(normalized);
}
export function officialJobUrl(value,id) {
  // Original receipt admission already validates and absolutizes the URL with
  // the native URL parser. Do not invent a source-specific path/host restriction.
  // This bounded public envelope is not a replacement for that native admission.
  return idText(id) && typeof value === 'string' && value.length <= 4000
    && /^https?:\/\/[^/?#@\s\\]+(?:[/?#][^\s\\]*)?$/.test(value)
    && !/[\u0000-\u001f\u007f]/u.test(value) && !sensitiveAdapterValue(value);
}
export function validateJob(job, rendered = false) {
  exactKeys(job, rendered ? ['sourceJobId','officialTitle','officialUrl','renderedOriginalTitle']
    : ['sourceJobId','officialTitle','officialUrl'], 'INVALID_JOB_FIELDS');
  requireFact(idText(job.sourceJobId), 'INVALID_JOB_ID');
  requireFact(typeof job.officialTitle === 'string' && job.officialTitle.length > 0
    && job.officialTitle.length <= 2000, 'INVALID_JOB_TITLE');
  requireFact(officialJobUrl(job.officialUrl, job.sourceJobId), 'INVALID_JOB_URL');
  if (rendered) requireFact(typeof job.renderedOriginalTitle === 'string'
    && job.renderedOriginalTitle.length > 0 && job.renderedOriginalTitle.length <= 2000,
  'INVALID_RENDERED_ORIGINAL_TITLE');
}
export function validateExpected(expected) {
  exactKeys(expected, ['batchId','sourceId','companyId','observedAt','expectedFileSha256','jobs','removedIds'],
    'INVALID_EXPECTED_FIELDS');
  requireFact(typeof expected.batchId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(expected.batchId), 'INVALID_BATCH');
  requireFact(expected.sourceId === TARGET.sourceId && expected.companyId === TARGET.companyId, 'SOURCE_NOT_ALLOWED');
  requireFact(iso(expected.observedAt) && sha256Text(expected.expectedFileSha256), 'INVALID_EXPECTED_EVIDENCE');
  requireFact(Array.isArray(expected.jobs) && expected.jobs.length <= LIMITS.maxJobs,
    'EXPECTED_INVALID_OR_OVERSIZE');
  requireFact(expected.jobs.length > 0, 'VIATRIS_ZERO_ROWS_FAILED');
  expected.jobs.forEach(j => validateJob(j));
  const ids = new Set(expected.jobs.map(j => j.sourceJobId));
  requireFact(ids.size === expected.jobs.length, 'DUPLICATE_EXPECTED_ID');
  requireFact(new Set(expected.jobs.map(j => j.officialUrl)).size === expected.jobs.length,
    'VIATRIS_AMBIGUOUS_EXPECTED_URL');
  requireFact(Array.isArray(expected.removedIds) && expected.removedIds.length <= LIMITS.maxJobs
    && expected.removedIds.every(idText) && new Set(expected.removedIds).size === expected.removedIds.length
    && expected.removedIds.every(id => !ids.has(id)), 'INVALID_REMOVED_IDS');
}

// The fields below are only public facts plus bounded protocol observations. Extra keys reject.
export function validateObservation(o, request, startedAt, finishedAt) {
  exactKeys(o, ['schemaVersion','action','observedAt','websiteUrl','sourceId','companyId','companyName',
    'view','state','errorBanner','consent','ui','jobs','sourceTime'], 'INVALID_OBSERVATION_FIELDS');
  requireFact(o.schemaVersion === 1 && o.action === request.action, 'PROTOCOL_ACTION_MISMATCH');
  requireFact(iso(o.observedAt) && Date.parse(o.observedAt) >= Date.parse(startedAt)
    && Date.parse(o.observedAt) <= Date.parse(finishedAt), 'UNVERIFIED_OBSERVATION_TIME');
  requireFact(o.websiteUrl === TARGET.websiteUrl && o.sourceId === TARGET.sourceId
    && o.companyId === TARGET.companyId && o.companyName === TARGET.companyName, 'WRONG_TARGET_OR_SOURCE');
  requireFact(['jobs','directory','consent'].includes(o.view), 'UNKNOWN_VIEW');
  requireFact(['READY','LOADING','ERROR','DENIED'].includes(o.state), 'UNKNOWN_UI_STATE');
  requireFact(typeof o.errorBanner === 'boolean', 'UNKNOWN_ERROR_BANNER');
  requireFact(o.state !== 'DENIED', 'EXPLICIT_DENIAL');
  requireFact(o.state !== 'ERROR' && !o.errorBanner, 'ERROR_BANNER');
  exactKeys(o.consent, ['state','recognizedExistingFlow','materialChangeNotice','checkboxLabel',
    'checkboxChecked','entryEnabled'], 'INVALID_CONSENT_FIELDS');
  requireFact(['ACCEPTED','EXISTING_REQUIRED','CHANGED','UNKNOWN','DENIED'].includes(o.consent.state), 'UNKNOWN_CONSENT');
  requireFact(o.consent.state !== 'DENIED', 'EXPLICIT_DENIAL');
  requireFact(o.consent.state !== 'CHANGED' && o.consent.state !== 'UNKNOWN'
    && o.consent.recognizedExistingFlow === true && o.consent.materialChangeNotice === false,
  'CONSENT_CHANGED_OR_UNVERIFIED');
  requireFact(o.consent.checkboxLabel === null || o.consent.checkboxLabel === EXISTING_CONSENT_LABEL,
    'CONSENT_CHANGED_OR_UNVERIFIED');
  if (o.consent.state === 'EXISTING_REQUIRED') requireFact(o.consent.checkboxLabel === EXISTING_CONSENT_LABEL,
    'CONSENT_CHANGED_OR_UNVERIFIED');
  requireFact(typeof o.consent.checkboxChecked === 'boolean' && typeof o.consent.entryEnabled === 'boolean',
    'INVALID_CONSENT_CONTROLS');
  exactKeys(o.ui, ['companyExpanded','viewAllVisible','allJobsVisible','displayedCount','directoryFiltered'],
    'INVALID_UI_FIELDS');
  for (const key of ['companyExpanded','viewAllVisible','allJobsVisible','directoryFiltered'])
    requireFact(typeof o.ui[key] === 'boolean', 'UNKNOWN_UI_CONTROLS');
  requireFact(o.ui.displayedCount === null || (Number.isSafeInteger(o.ui.displayedCount)
    && o.ui.displayedCount >= 0 && o.ui.displayedCount <= LIMITS.maxJobs), 'INVALID_DISPLAYED_COUNT');
  requireFact(o.jobs === null || (request.action === 'READ_LIST' && Array.isArray(o.jobs)
    && o.jobs.length <= LIMITS.maxJobs), 'UNREQUESTED_LIST_DATA');
  if (o.jobs) o.jobs.forEach(j => validateJob(j, true));
  requireFact(o.sourceTime === null || request.action === 'READ_SOURCE_TIME', 'UNREQUESTED_SOURCE_TIME');
  if (o.sourceTime !== null) {
    exactKeys(o.sourceTime, ['companyId','companyName','officialEntry','label','text','precision','timezone','timezoneEvidence'], 'INVALID_SOURCE_TIME_FIELDS');
    requireFact(o.sourceTime.companyId === TARGET.companyId && o.sourceTime.companyName === TARGET.companyName
      && o.sourceTime.officialEntry === TARGET.officialEntry
      && o.sourceTime.label === '最近成功更新', 'WRONG_TIME_SOURCE');
    requireFact(typeof o.sourceTime.text === 'string' && o.sourceTime.text.length <= 80
      && typeof o.sourceTime.precision === 'string', 'INVALID_SOURCE_TIME');
    requireFact(o.sourceTime.precision === 'minute', 'SOURCE_TIME_PRECISION_INSUFFICIENT');
    // Validate before journaling: arbitrary objects cannot be treated as public timezone facts.
    requireFact(o.sourceTime.timezone === 'UTC'
      && o.sourceTime.timezoneEvidence === 'VISIBLE_UTC_LABEL', 'HOLD_TIME_UNKNOWN');
  }
}
