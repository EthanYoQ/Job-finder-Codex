import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { withLocalOfficialDom } from '../src/crawler/localOfficialSourceFetch.ts';
import { captureLocalOfficialDom } from '../src/crawler/local-browser/official-dom.mjs';
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from '../src/crawler/officialHttpRuntimeLimits.ts';

const plan = { source: { id: 'source-boehringer-ingelheim-china-social' } };

test('a pre-aborted source never launches Chromium', async () => {
  const original = chromium.launch; let launches = 0;
  chromium.launch = async () => { launches++; throw Error('Unexpected launch'); };
  try {
    await assert.rejects(captureLocalOfficialDom(plan.source.id, undefined, AbortSignal.abort(Error('source stopped'))), /source stopped/);
    assert.equal(launches, 0);
  } finally { chromium.launch = original; }
});

for (const cause of ['source deadline', 'lease cancellation']) test(`${cause} closes the waiting DOM browser without HTTP fallback`, { timeout: 2000 }, async () => {
  const original = chromium.launch; let closes = 0, httpCalls = 0, rejectWait, started;
  const waiting = new Promise(resolve => { started = resolve; });
  chromium.launch = async () => ({
    async close() { closes++; rejectWait?.(Error('synthetic browser closed')); },
    async newContext() {
      const locator = { first() { return locator; }, waitFor() { started(); return new Promise((_resolve, reject) => { rejectWait = reject; }); } };
      const page = { once() {}, async goto() {}, async close() {}, url: () => 'https://campus.51job.com/BI/recruitSociety.html', locator: () => locator };
      return { on() {}, async newPage() { return page; }, pages: () => [page] };
    }
  });
  const fetch = withLocalOfficialDom(async () => { httpCalls++; throw Error('HTTP must not run after cancelled DOM'); });
  let capture;
  try {
    if (cause === 'source deadline') {
      const attempt = runWithOfficialSourceAttemptTimeout(() => { capture = fetch(plan); return capture; }, 25);
      await assert.rejects(attempt, /Official source attempt exceeded/);
    } else {
      const controller = new AbortController();
      const attempt = runWithOfficialSourceCancellation(controller.signal, () => { capture = fetch(plan); return capture; });
      await waiting;
      controller.abort(Error('lease lost'));
      await assert.rejects(attempt, /synthetic browser closed/);
    }
    await assert.rejects(capture, /synthetic browser closed/);
    assert.equal(closes, 1);
    assert.equal(httpCalls, 0);
  } finally { chromium.launch = original; }
});
