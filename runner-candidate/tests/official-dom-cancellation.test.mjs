import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { withLocalOfficialDom } from '../src/crawler/localOfficialSourceFetch.ts';
import { captureLocalOfficialDom } from '../src/crawler/local-browser/official-dom.mjs';
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from '../src/crawler/officialHttpRuntimeLimits.ts';

const plan = { source: { id: 'source-boehringer-ingelheim-china-social' } };

test('validator entry propagates SIGTERM cancellation to independent HTTP requests', () => {
  const entry = new URL('../scripts/p0-b-grade-validator.ts', import.meta.url).href;
  const limits = new URL('../src/crawler/officialHttpRuntimeLimits.ts', import.meta.url).href;
  const replacement = `
    import assert from 'node:assert/strict';
    import {currentOfficialSourceAttemptSignal, fetchWithOfficialTimeout} from ${JSON.stringify(limits)};
    export async function runBGradeIndependentTraversalValidator({signal}) {
      assert.equal(currentOfficialSourceAttemptSignal(), signal);
      let cancelled = false;
      await assert.rejects(fetchWithOfficialTimeout('http://127.0.0.1/synthetic', {}, {
        fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {cancelled = true; reject(init.signal.reason);}, {once:true});
          queueMicrotask(() => process.emit('SIGTERM'));
        })
      }), /B-grade validator received SIGTERM/);
      assert.equal(cancelled, true);
      return {httpCancelled: true};
    }`;
  // Keep this child independent of newer synchronous preload hooks.
  const loader = `
    export async function load(url, context, next) {
      return url.endsWith('/src/crawler/traversalCertificate.ts')
        ? {format:'module',shortCircuit:true,source:${JSON.stringify(replacement)}} : next(url, context);
    }`;
  const script = `
    import {register} from 'node:module';
    register('data:text/javascript,'+encodeURIComponent(${JSON.stringify(loader)}));
    await import(${JSON.stringify(entry)});`;
  const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15_000,
    env: {...process.env, JOB_FINDER_B_GRADE_VALIDATOR_INPUT: JSON.stringify({sourceId:'source-sanofi-china-social'})}
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.deepEqual(JSON.parse(child.stdout), {decision:'SUCCEEDED',validation:{httpCancelled:true}});
});

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
