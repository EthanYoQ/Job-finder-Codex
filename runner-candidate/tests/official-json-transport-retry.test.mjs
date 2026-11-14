import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {createSourceFetchRouter} from '../src/crawler/sourceFetchRouter.ts';

const capturedAt = '2026-11-07T00:00:00.000Z';
const longRetryAfter = {value: '120', delayMs: 120_000};
const shortRetryAfter = {value: '5', delayMs: 5_000};

function response(url, status, body = 'Temporarily unavailable', retryAfter) {
  return {status, body, finalUrl: url, contentType: 'application/json', capturedAt,
    ...(retryAfter ? {retryAfter} : {})};
}

const plans = buildStagedSourceCrawlPlans(candidateCompanies);

async function crawl(plan, http) {
  const requests = [], waits = [];
  const officialJson = createOfficialJsonSourceFetch({now: () => new Date(capturedAt), http: async request => {
    requests.push(request);
    return http(request);
  }});
  const unexpected = async () => assert.fail('Unexpected source fetcher');
  const fetch = createSourceFetchRouter({officialJson, moka: unexpected, fallback: unexpected,
    delay: async milliseconds => { waits.push(milliseconds); }});
  return {result: await fetch(plan), requests, waits};
}

for (const stage of ['ENTRY', 'PAGE', 'FACET_GLOBAL', 'FACET_COUNTRY']) {
  test(`Phenom ${stage} retains Retry-After without an early retry`, async () => {
    const facet = stage.startsWith('FACET');
    const plan = plans.find(p => p.source.id === `source-${facet ? 'roche' : 'organon'}-china-social`);
    const bootstrap = {widgetApiEndpoint: `${new URL(plan.source.officialEntryUrl).origin}/widgets`,
      country: 'cn', deviceType: 'desktop', locale: 'zh_cn', refNum: facet ? 'ROCHGLOBAL' : 'MECEUS',
      pageName: 'search-results', pageId: facet ? 'page11-ds' : 'page18-ds'};
    for (const retryAfter of [longRetryAfter, {invalid: true}]) {
      const {result, requests, waits} = await crawl(plan, ({url, body}) => {
        if (url === plan.source.officialEntryUrl && stage !== 'ENTRY') {
          return {...response(url, 200, `<script>var phApp=${JSON.stringify(bootstrap)};</script>`), contentType: 'text/html'};
        }
        if (stage === 'FACET_COUNTRY' && Object.keys(JSON.parse(body).selected_fields).length === 0) {
          return response(url, 200, JSON.stringify({refineSearch: {totalHits: 1, data: {
            jobs: [], aggregations: [{field: 'country', value: {'中国大陆': 1}}]
          }}}));
        }
        return response(url, 429, undefined, retryAfter);
      });
      assert.equal(result.ok, false);
      assert.deepEqual({calls: requests.length, waits, failure: result.transportFailure}, {
        calls: stage === 'ENTRY' ? 1 : stage === 'FACET_COUNTRY' ? 3 : 2,
        waits: [],
        failure: 'invalid' in retryAfter ? undefined : {
          code: 'OFFICIAL_HTTP_429', retryable: true, stage, retryAfterMs: 120_000
        }
      });
    }
  });
}

test(`Organon keeps the existing retry bound and 403 stop`, async () => {
  const plan = plans.find(p => p.source.id === 'source-organon-china-social');
  for (const status of [429, 503, 403]) {
    const {result, requests, waits} = await crawl(plan, ({url}) => response(url, status, undefined, shortRetryAfter));
    assert.equal(result.ok, false);
    assert.equal(requests.length, status === 403 ? 1 : 2);
    assert.deepEqual(waits, status === 403 ? [] : [10_000]);
    assert.equal(result.transportFailure?.retryAfterMs, status === 403 ? undefined : 5_000);
  }
});

const bmsPlan = plans.find(p => p.source.id === 'source-bms-china-social');
const bmsRows = Array.from({length: 11}, (_, i) => ({
  id: 137484251800 + i, name: `Synthetic Role ${i + 1}`, positionUrl: `/careers/job/${137484251800 + i}`,
  locations: ['Shanghai - CN'], standardizedLocations: ['Shanghai, Shanghai, CN'], postedTs: 1794009600,
  workLocationOption: 'onsite', locationFlexibility: null
}));

test(`BMS recovers after one network or 503 failure`, async () => {
  for (const failure of ['network', 503]) {
    let calls = 0;
    const {result, requests, waits} = await crawl(bmsPlan, ({url}) => {
      if (++calls === 1) {
        if (failure === 'network') throw Object.assign(new Error('connection reset'), {code: 'ECONNRESET'});
        return response(url, failure, undefined, shortRetryAfter);
      }
      return response(url, 200, JSON.stringify({status: 200, data: {count: 1, positions: bmsRows.slice(0, 1)}}));
    });
    assert.equal(result.ok, true, result.failureReason);
    assert.equal(result.payload.jobs.length, 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(waits, [10_000]);
  }
});

test(`BMS bounds persistent page failures and keeps captured evidence`, async () => {
  const {result, requests, waits} = await crawl(bmsPlan, ({url}) => {
    if (new URL(url).searchParams.get('start') === '10') return response(url, 503);
    return response(url, 200, JSON.stringify({status: 200, data: {count: 11, positions: bmsRows.slice(0, 10)}}));
  });
  assert.equal(result.ok, false);
  assert.deepEqual(requests.map(({url}) => Number(new URL(url).searchParams.get('start'))), [0, 10, 0, 10]);
  assert.deepEqual(waits, [10_000]);
  assert.deepEqual(result.transportFailure, {code: 'OFFICIAL_HTTP_503', retryable: true});
  assert.equal(result.fetchEvidence.artifacts.length, 2);
  assert.equal(result.fetchEvidence.pages.length, 1);
  assert.equal(result.fetchEvidence.pages[0].termination, 'ABORTED');
});

test(`BMS preserves 403 and 429 no-retry behavior`, async () => {
  for (const status of [403, 429]) {
    for (const retryAfter of [undefined, shortRetryAfter, longRetryAfter]) {
      const {result, requests, waits} = await crawl(bmsPlan, ({url}) => response(url, status, undefined, retryAfter));
      assert.equal(result.ok, false);
      assert.equal(requests.length, 1);
      assert.deepEqual(waits, []);
      assert.equal(result.transportFailure, undefined);
    }
  }
});

test(`BMS respects long or malformed Retry-After on 503`, async () => {
  for (const retryAfter of [longRetryAfter, {invalid: true}]) {
    const {result, requests, waits} = await crawl(bmsPlan, ({url}) => response(url, 503, undefined, retryAfter));
    assert.equal(result.ok, false);
    assert.equal(requests.length, 1);
    assert.deepEqual(waits, []);
    assert.deepEqual(result.transportFailure, 'invalid' in retryAfter ? undefined : {
      code: 'OFFICIAL_HTTP_503', retryable: true, retryAfterMs: 120_000
    });
  }
});

test(`Beisen and HCM failures retain Retry-After`, async () => {
  for (const sourceId of ['source-united-lab-social', 'source-lunan-social']) {
    const plan = plans.find(p => p.source.id === sourceId);
    const {result, requests, waits} = await crawl(plan, ({url}) => response(url, 429, undefined, longRetryAfter));
    assert.equal(result.ok, false);
    assert.deepEqual({calls: requests.length, waits, failure: result.transportFailure}, {
      calls: 1, waits: [], failure: {code: 'OFFICIAL_HTTP_429', retryable: true, retryAfterMs: 120_000}
    }, sourceId);
  }
  const count = {result: {count: 1, list: [{count__id: 1, id: 1}]}};
  const encodedCount = JSON.stringify({hcm_transfer_strategy: 'hb5',
    hcm_param: `rsp${Buffer.from(JSON.stringify(count)).toString('base64').replaceAll('a', '!').replaceAll('5', 'a')}`});
  const plan = plans.find(p => p.source.id === 'source-lunan-social');
  const {result, requests, waits} = await crawl(plan, ({url}) => url.includes('hcm.model.count')
    ? response(url, 200, encodedCount) : response(url, 429, undefined, longRetryAfter));
  assert.equal(result.ok, false);
  assert.deepEqual({calls: requests.length, waits, failure: result.transportFailure}, {
    calls: 2, waits: [], failure: {code: 'OFFICIAL_HTTP_429', retryable: true, retryAfterMs: 120_000}
  });
});
