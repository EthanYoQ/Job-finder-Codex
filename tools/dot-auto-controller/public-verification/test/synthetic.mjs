import { TARGET, EXISTING_CONSENT_LABEL } from '../contract.mjs';
export const clone = v => structuredClone(v);
export const job = id => ({ sourceJobId: String(id), officialTitle: `Synthetic role ${id}`,
  officialUrl: `https://jobs.takeda.com/job/shanghai/synthetic-role/1113/${id}` });
export const rendered = j => ({ ...j, renderedOriginalTitle: j.officialTitle });
export function expected(count = 2) {
  return { batchId: 'synthetic-batch-only', sourceId: TARGET.sourceId, companyId: TARGET.companyId,
    observedAt: '2026-10-11T15:23:18.748Z', expectedFileSha256: 'a'.repeat(64),
    jobs: Array.from({ length: count }, (_, n) => job(1000 + n)), removedIds: ['9001','9002','9003'] };
}
export function sourceTime(text = '2026-10-11 15:23 UTC') {
  return { companyId: TARGET.companyId, companyName: TARGET.companyName,
    officialEntry: TARGET.officialEntry, label: '最近成功更新', text, precision: 'minute',
    timezone: 'UTC', timezoneEvidence: 'VISIBLE_UTC_LABEL' };
}
export function fakePort(e, { staleBefore = false, staleAfter = false, consent = false,
  loadingAt = null, loadingForever = false, mutate = null, throwsAt = null, error = null,
  allInitiallyVisible = false } = {}) {
  const calls = []; let reloads = 0, accepted = !consent, checked = false;
  let view = 'jobs', expanded = false, all = false, filtered = false, loading = false;
  const p = { enabled: true, kind: 'SYNTHETIC', targetKey: TARGET.key, calls,
    async execute(request) {
      calls.push(request);
      const action = request.action;
      if (throwsAt === action) throw error;
      if (action === 'OPEN_HOME' || action === 'RELOAD') {
        if (action === 'RELOAD') reloads++;
        accepted = !consent; checked = false; view = accepted ? 'jobs' : 'consent';
        expanded = false; all = false; filtered = false;
      }
      if (action === 'CHECK_EXISTING_CONSENT') checked = true;
      if (action === 'ENTER_EXISTING_CONSENT') { accepted = true; view = 'jobs'; }
      if (action === 'EXPAND_COMPANY') { expanded = true; all = allInitiallyVisible; }
      if (action === 'VIEW_ALL') all = true;
      if (action === 'OPEN_DIRECTORY') { view = 'directory'; filtered = false; }
      if (action === 'FILTER_COMPANY') filtered = true;
      if (action === 'WAIT_VISIBLE' && !loadingForever) loading = false;
      if (action === loadingAt) loading = true;
      const stale = reloads ? staleAfter : staleBefore;
      const jobs = [...e.jobs, ...(stale ? e.removedIds.map(job) : [])].map(rendered);
      const o = { schemaVersion: 1, action, observedAt: new Date().toISOString(),
        websiteUrl: TARGET.websiteUrl, sourceId: TARGET.sourceId, companyId: TARGET.companyId,
        companyName: TARGET.companyName, view, state: loading ? 'LOADING' : 'READY', errorBanner: false,
        consent: { state: accepted ? 'ACCEPTED' : 'EXISTING_REQUIRED', recognizedExistingFlow: true,
          materialChangeNotice: false, checkboxLabel: accepted ? null : EXISTING_CONSENT_LABEL,
          checkboxChecked: checked, entryEnabled: checked },
        ui: { companyExpanded: expanded, viewAllVisible: expanded && !all,
          allJobsVisible: all, displayedCount: view === 'jobs' ? jobs.length : null,
          directoryFiltered: filtered },
        jobs: action === 'READ_LIST' ? jobs : null,
        sourceTime: action === 'READ_SOURCE_TIME' ? sourceTime() : null };
      return mutate ? (await mutate(o, { action, reloads, calls })) ?? o : o;
    } };
  return p;
}
