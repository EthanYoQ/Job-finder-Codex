import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCipheriv } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createChromiumDom } from '../src/crawler/local-browser/chromium-dom.mjs';
import { captureHybridDom } from '../src/crawler/local-browser/hybrid-dom.mjs';
import { captureBayerIndependentDetails, replayBayerHybridTraversal } from '../src/crawler/bayerMokaRenderedTraversal.ts';
import { captureServierIndependentDetails, replayServierHybridTraversal } from '../src/crawler/servierMokaRenderedTraversal.ts';
import { captureSanofiChineseIndependent, replaySanofiChineseIndependent } from '../src/crawler/sanofiChineseRenderedTraversal.ts';
import { createOfficialJsonRenderedTraversalValidation, parseBGradeIndependentTraversalValidation } from '../src/crawler/traversalCertificate.ts';
import { loadDirectPlans, identityForSource } from '../scripts/direct-round.ts';
import { createSanofiChineseSourceFetch, SANOFI_CN_ENTRY } from '../src/crawler/sanofiChineseNative.ts';
import { runP0CrawlBatch } from '../src/crawler/runCrawlBatch.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { memoryDb } from './memory-db.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const id = '00000000-0000-4000-8000-000000000001', title = '中文岗位1', date = '2026-09-01';
const iv = '0123456789abcdef', key = 'abcdef0123456789';
function encrypted(data) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
  return JSON.stringify({ necromancer: key, data: cipher.update(JSON.stringify({ success: true, data }), 'utf8', 'base64') + cipher.final('base64') });
}
function mokaHtml(bayer) {
  return `<meta charset="utf-8">${bayer ? ['Pharmaceuticals', 'Consumer Health'].map(name => `<label>${name} <input type="checkbox"><span class="no-adaptive-tooltip">${name}</span></label>`).join('') : ''}
    <input aria-label="Search"><div><span>已选 ${bayer ? 1 : 0} 条件</span><span>|</span><span>1 结果</span></div>
    <span class="Pagination-page-size-changer-x">30 行/页</span>
    <a href="#/job/${id}"><span class="title-x">${title}</span><span class="published-at-x">发布于 ${date}</span></a>
    <div><button class="Pagination-is-active" data-page="1">1</button><button class="Pagination-forward" disabled>下一页</button></div>
    ${bayer ? `<script>document.querySelectorAll('input[type=checkbox]').forEach(e=>e.onchange=()=>{if([...document.querySelectorAll('input[type=checkbox]')].every(x=>x.checked))location.hash='#/jobs?283170[0]=Pharmaceuticals&283170[1]=Consumer Health&page=1&pageSize=30'})</script>` : ''}`;
}
const detailUrl = new URL('https://jobs.sanofi.cn/工作/role/3036/101').href;
const sanofiHtml = `<meta charset="utf-8"><section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="1" data-total-pages="1" data-total-job-results="1" data-records-per-page="15"><ul id="search-results-list"><li><button class="js-save-job-btn" data-job-id="101"></button><a data-job-id="101" href="${detailUrl}"><h2>${title}</h2><span class="job-location">中国</span></a></li></ul><input class="pagination-current" value="1" max="1"><a class="next disabled">下一页</a></section>`;
const sanofiDetail = `<meta name="job-ats-req-id" content="R9000001"><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', identifier: { value: 'R9000001' }, title, url: detailUrl, hiringOrganization: { name: 'General Medicines' }, description: '中文职责和要求1', jobLocation: [{ address: { addressCountry: 'China' } }] })}</script><main id="content"><div class="job-description section7-title"><h1>${title}</h1><a data-job-id="101" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9000001">立即申请</a></div><div class="job-description section7-details" data-job-id="101"><div class="ats-description">中文职责和要求1</div><a data-job-id="101" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9000001">立即申请</a></div></main>`;
const sanofiNative = `<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司"><input id="positionStatus" value="PUBLISHING"><input id="positionName" value="${title}"><input id="positionId" value="000000000000000000000001"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-extend"><span class="city">广西壮族自治区-南宁</span></div><div class="position-description">中文职责和要求1</div>`;

test('sandboxed original DOM collectors feed native Bayer, Servier and Sanofi B validation using loopback fixtures only', { timeout: 60000 }, async () => {
  const requests = [], intercepted = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const name = request.url.slice(1);
    if (name === 'bayer-dom') response.end(mokaHtml(true));
    else if (name === 'servier-dom') response.end(mokaHtml(false));
    else if (name === 'sanofi-dom') response.end(sanofiHtml);
    else if (name === 'sanofi-detail') response.end(sanofiDetail);
    else if (name === 'sanofi-native') response.end(sanofiNative);
    else if (name === 'sanofi-main-entry') response.end('<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="1" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>');
    else if (name === 'sanofi-main-list') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ results: sanofiHtml, filters: '<section id="search-filters"><input class="filter-checkbox"></section>', hasJobs: true, hasContent: false })); }
    else {
      const bayer = name.startsWith('bayer'), org = bayer ? 'bayer' : 'shiweiya', siteId = bayer ? '148387' : '47734';
      if (name.endsWith('entry')) response.end(`<input id="init-data" value='${JSON.stringify({ aesIv: iv, mode: 'social', siteId, org: { id: org, siteId: Number(siteId) } })}'>`);
      else response.end(encrypted({ id, orgId: org, siteId, title, status: 'open', closedAt: null, publishedAt: `${date}T09:00:00`, showIsCampus: true,
        jobDescription: '<p>Complete synthetic responsibilities and requirements.</p>',
        locations: [{ country: '中国', countryDescription: '中国', cityName: '北京市', cityId: 110000, provinceName: '北京市' }], locDepCampusList: [{ locationIds: [110000] }],
        customFields: bayer ? { '283170': { name: 'Division', value: 'Pharmaceuticals' }, '290891': { name: '国家', value: 'China' } } : {} }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cua;
  try {
    const sandboxed = { async launch(options) {
      assert.equal(options.chromiumSandbox, true);
      const browser = await chromium.launch(options);
      return { close: () => browser.close(), async newContext() {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (!['app.mokahr.com', 'jobs.sanofi.cn'].includes(url.hostname)) return route.abort();
          intercepted.push(url.href);
          const name = url.hostname === 'jobs.sanofi.cn' ? 'sanofi' : url.pathname.includes('/bayer/') ? 'bayer' : 'servier';
          await route.fulfill({ contentType: 'text/html; charset=utf-8', body: await (await fetch(`${base}/${name}-dom`)).text() });
        });
        return context;
      } };
    } };
    cua = await createChromiumDom({ chromium: sandboxed, executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium' });
    const plans = await loadDirectPlans();
    for (const [name, sourceId, capture, replay] of [
      ['bayer', 'source-bayer-healthcare-social', captureBayerIndependentDetails, replayBayerHybridTraversal],
      ['servier', 'source-servier-china-social', captureServierIndependentDetails, replayServierHybridTraversal],
      ['sanofi', 'source-sanofi-china-social', captureSanofiChineseIndependent, replaySanofiChineseIndependent]
    ]) {
      const dom = await captureHybridDom(sourceId, cua);
      const http = async request => {
        const suffix = name === 'sanofi' ? new URL(request.url).hostname === 'jobs.sanofi.cn' ? 'detail' : 'native' : request.method === 'POST' ? 'detail' : 'entry';
        const body = await (await fetch(`${base}/${name}-${suffix}`)).text();
        return { status: 200, finalUrl: request.url, contentType: 'text/html; charset=utf-8', body, capturedAt: new Date().toISOString() };
      };
      const captured = await capture({ dom, http });
      assert.equal(replay(captured.pages).rawCount, 1);
      const row = plans.find(row => row.sourceId === sourceId);
      const validation = createOfficialJsonRenderedTraversalValidation({ sourceId, companyId: row.companyId,
        sourceConfigSha256: row.sourceConfigSha256, surfaceIds: [row.plan.source.surfaceId],
        channelIds: row.plan.expectedChannels.map(channel => channel.channelId), ...captured,
        expiresAt: new Date(Date.parse(captured.observedAt) + 1800000).toISOString() });
      assert.equal(parseBGradeIndependentTraversalValidation(validation).sourceId, sourceId);
      await assert.rejects(capture({ dom, http: async () => ({ status: 503, body: 'synthetic unavailable' }) }));
      if (name === 'sanofi') {
        const memory = memoryDb();
        const mainHttp = async request => {
          if (request.url !== SANOFI_CN_ENTRY && new URL(request.url).pathname !== '/search-results') return http(request);
          const response = await fetch(`${base}/sanofi-main-${request.url === SANOFI_CN_ENTRY ? 'entry' : 'list'}`);
          return { status: 200, finalUrl: request.url, contentType: response.headers.get('content-type'), body: await response.text(), capturedAt: new Date().toISOString() };
        };
        const candidate = { id: 'synthetic-browser-candidate', commitSha: 'a'.repeat(40), rosterHash: 'b'.repeat(64), sourcePlanHash: 'c'.repeat(64), sourceConfigHash: 'd'.repeat(64), adapterBundleHash: 'e'.repeat(64) };
        const workspaceRoot = await mkdtemp(join(tmpdir(), 'job-finder-hybrid-test-'));
        const result = await withPortableCrawlLease(memory.db, lease => runP0CrawlBatch([row.plan], {
          db: memory.db, identity: identityForSource(candidate, sourceId), now: () => new Date(),
          publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1', portableLease: lease,
          getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => false,
          getTrustedCompletenessBaseline: async () => null,
          fetch: createSanofiChineseSourceFetch({ http: mainHttp }),
          runIndependentTraversalValidator: async () => {
            const fresh = await capture({ dom: await captureHybridDom(sourceId, cua), http });
            return createOfficialJsonRenderedTraversalValidation({ sourceId, companyId: row.companyId, sourceConfigSha256: row.sourceConfigSha256,
              surfaceIds: [row.plan.source.surfaceId], channelIds: row.plan.expectedChannels.map(channel => channel.channelId), ...fresh,
              expiresAt: new Date(Date.parse(fresh.observedAt) + 1800000).toISOString() });
          },
          workspaceRoot, evidenceSubdirectory: 'evidence'
        }));
        assert.equal(result.status, 'SUCCESS', JSON.stringify(memory.rows));
        assert.equal(memory.jobWrites(), 1);
        assert.equal(memory.rows[0].completenessCertificate.schemaVersion, 'sanofi-cn-dual-chain-attestation-v1');
        assert(memory.artifacts.some(artifact => artifact.extractorLocator === 'sanofi-cn-independent-original-v1'));
      }
    }
    assert.equal(intercepted.length, 4);
    assert(requests.includes('/sanofi-native'));
    assert.equal((await cua.getState()).tabs.length, 0);
  } finally { if (cua) await cua.close(); await new Promise(resolve => server.close(resolve)); }
});
