import { captureLocalOfficialDom } from './local-browser/official-dom.mjs';
import { reviewCspcDomHttp } from './local-browser/cspc-dom-http-review';
import { reviewBiDomHttp } from './local-browser/bi-dom-http-review';
import { replayBiUiSemanticContract } from './biUiSemanticContract';
import { createJnjCareersDomSourceFetch } from './jnjCareersDomEvidence';
import type { SourceFetchFunction } from './runSourceCrawl';
import { currentOfficialSourceAttemptSignal } from './officialHttpRuntimeLimits';

/** Fresh DOM is mandatory for these routes; a failed browser never falls back to HTTP. */
export function withLocalOfficialDom(http: SourceFetchFunction): SourceFetchFunction {
  return async (plan, tracker) => {
    const sourceId = plan.source.id;
    if (!['source-cspc-social', 'source-boehringer-ingelheim-china-social', 'source-johnson-innovative-medicine-social'].includes(sourceId)) return http(plan, tracker);
    const runStartedAt = new Date().toISOString();
    const capture = await captureLocalOfficialDom(sourceId, runStartedAt, currentOfficialSourceAttemptSignal());
    if (sourceId === 'source-johnson-innovative-medicine-social') {
      if (!capture.lists || !capture.details) throw Error('JNJ_DOM_CAPTURE_REQUIRED');
      return createJnjCareersDomSourceFetch({ lists: capture.lists, details: capture.details })(plan, tracker);
    }
    const result = await http(plan, tracker);
    if (!result.ok || !result.fetchEvidence) return result;
    const input = { ...capture, plan, replayedEvidence: result.fetchEvidence, runStartedAt,
      now: new Date().toISOString(), dispatchBefore: new Date(Date.parse(runStartedAt) + 30 * 60_000).toISOString() };
    if (sourceId === 'source-cspc-social') reviewCspcDomHttp({ ...input, dom: capture.dom, applications: capture.applications });
    else {
      const script = result.fetchEvidence.artifacts.find(a => a.logicalKey === '51job-ui-script');
      if (!script || typeof script.body !== 'string') throw Error('BI_DOM_NATIVE_SCRIPT_REQUIRED');
      reviewBiDomHttp({ ...input, uiContract: replayBiUiSemanticContract(script.body) });
    }
    return result;
  };
}

