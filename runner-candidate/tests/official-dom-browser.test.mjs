import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createChromiumDom } from '../src/crawler/local-browser/chromium-dom.mjs';
import { captureOfficialDom } from '../src/crawler/local-browser/official-dom.mjs';
import { reviewCspcDomHttp } from '../src/crawler/local-browser/cspc-dom-http-review.ts';
import { reviewBiDomHttp } from '../src/crawler/local-browser/bi-dom-http-review.ts';
import { createOfficialJsonSourceFetch } from '../src/crawler/officialJsonSourceFetch.ts';
import { createJnjCareersDomSourceFetch } from '../src/crawler/jnjCareersDomEvidence.ts';
import { runSourceCrawl } from '../src/crawler/runSourceCrawl.ts';
import { capturePfizerRenderedTraversal } from '../src/crawler/pfizerRenderedTraversal.ts';
import { createOfficialJsonRenderedTraversalValidation, parseBGradeIndependentTraversalValidation } from '../src/crawler/traversalCertificate.ts';
import { loadDirectPlans, identityForSource } from '../scripts/direct-round.ts';
import { runP0CrawlBatch } from '../src/crawler/runCrawlBatch.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { memoryDb } from './memory-db.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const title = 'Synthetic scientific role', id = '00000000-0000-4000-8000-000000000001';
const channel = '0beb3022-3214-4333-a2e7-20786c4916d5';
const cspcEntry = `https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/${channel}/officeWebsite.mob`;
const cspcDetail = `${cspcEntry}?jumpPageId=detail&detailRequestId=${id}&rootId=cspc&recruitWay=e264521b-64fa-4e3b-aec7-720913ac635d&configId=${channel}`;
const cspcRow = { REQUEST_ID: id, PUBLISH_NAME: title, JOB_DUTY: '1', JOB_REQUEST: '1', WORK_PLACE: '北京市' };
const rawCspc = JSON.stringify({ state: '1', total: '', jsonList: [cspcRow] });
const jnjUrl = 'https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const jnjDetail = 'https://www.careers.jnj.com/en/jobs/r-000001/synthetic-role/';
const pfizerCountry = '6cb77610a8a543aea2d6bc10457e35d4';
const pfizerDetail = `https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers/job/China/Synthetic_1234567?Location_Country=${pfizerCountry}`;
function cspcCandidateHtml() {
  const alphabet = 'y!89(*z02BCcdD_bEeGHIJKLmnNOPQopRMSTqrUklVstWXYZafgh3ij1uvwx456A7', standard = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const encoded = [...Buffer.from(id).toString('base64')].map(char => alphabet[standard.indexOf(char)]).join('') + 'yyryrtweasdasd';
  return `<script>var requestId='${encoded.slice(0, 2) + encoded.slice(-3) + encoded.slice(2, -3)}';</script>`;
}
const pages = {
  'cspc-list': `<h1>全部岗位</h1><input placeholder="请输入岗位名称"><div class="vxe-table--body"><table><tbody><tr><td><a target="_blank" href="${cspcDetail}">${title}</a></td></tr></tbody></table></div><div class="vxe-pager"><button class="vxe-pager--next-btn is--disabled" disabled>下一页</button><button class="vxe-pager--jump-next is--disabled" disabled>末页</button></div>`,
  'cspc-detail': `<div class="school-recruit-detail-head-L-h1"><span>${title}</span></div><h2>岗位职责</h2><div class="school-recruit-detail-textBox">1</div><h2>任职要求</h2><div class="school-recruit-detail-textBox">1</div><button onclick="parent.document.querySelector('#login').hidden=false">投递</button>`,
  'bi-list': `<div><a href="recruit_article_detail3.html?jobId=123">详情</a><span>${title}</span><span>1</span><span>上海</span><span>2026-10-01</span></div>`,
  'jnj-list': `<h1>Displaying 1 to 1 of 1 matching jobs</h1>${['team', 'subteam', 'country', 'state', 'location', 'type', 'pattern'].map(name => `<select multiple name="${name}" id="l-${name}">${name === 'country' ? '<option value="China" selected>China</option>' : ''}</select>`).join('')}<ul id="js-job-search-results" data-results="1"><li class="PageList-items-item card-job" data-id="r-000001"><a href="${jnjDetail}">${title}</a><div class="PagePromo-category">Pharmaceutical Sales</div><address class="PagePromo-location">Guiyang</address></li></ul><a aria-label="Page 1" href="${jnjUrl}">1</a>`,
  'jnj-detail': `<h1>${title}</h1><div id="js-job-detail" data-id="r-000001" data-jobtitle="${title}"><article class="RichTextBody"><ul class="job-meta"><li>Job title<span>${title}</span></li><li>Function<span>Pharmaceutical Sales</span></li><li>Location<span>Guiyang / China</span></li><li>Requisition number<span>R-000001</span></li></ul><h2>Description</h2><p>Job Description: ${'Responsibilities include scientific work and collaboration. '.repeat(6)}</p></article></div><a href="https://careers.jnj.com.cn/jnj/apply?exid=R-000001&m=1">Apply now</a>`,
  'pfizer-list': `<title>Search for Jobs</title><input><button>China clear filter</button><button>Clear All (1)</button><div data-automation-id="jobFoundText">1 JOBS FOUND</div><div data-automation-id="jobOutOfText">1 - 1 of 1 jobs</div><ul aria-label="Page 1 of 1"><li><a data-automation-id="jobTitle" href="${pfizerDetail}">${title}</a></li></ul>`,
  'pfizer-detail': `<title>Synthetic job</title><h1 data-automation-id="jobPostingHeader">${title}</h1><button>Apply</button><div data-automation-id="job-posting-details"><dl data-automation-id="requisitionId"><dd>1234567</dd></dl><dl data-automation-id="locations"><dd>China - Beijing</dd></dl></div><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', identifier: { value: '1234567' }, title, datePosted: '2026-10-01', jobLocation: { address: { addressCountry: 'China', addressLocality: 'CHN - Beijing' } } })}</script>`
};

test('CSPC, BI, JNJ and Pfizer use original collectors on sandboxed loopback pages', { timeout: 90000 }, async () => {
  const requests = [], contexts = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(pages[request.url.slice(1)] ?? 'missing synthetic page');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cua;
  try {
    const sandboxed = { async launch(options) {
      assert.equal(options.chromiumSandbox, true);
      const browser = await chromium.launch(options);
      return { close: () => browser.close(), async newContext() {
        const context = await browser.newContext({ serviceWorkers: 'block' }); contexts.push(context);
        await context.route('**/*', async route => {
          const url = new URL(route.request().url()); let name;
          if (url.hostname === 'ehr.e-cspc.com') {
            if (url.pathname === '/synthetic-list') name = 'cspc-list';
            else if (url.pathname === '/synthetic-detail') name = 'cspc-detail';
            else return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<iframe style="width:900px;height:600px" id="recruit-content-iframe" src="/${url.search ? 'synthetic-detail' : 'synthetic-list'}"></iframe><div id="login" hidden><h1>登录</h1><label>密码<input type="password"></label></div>` });
          } else if (url.hostname === 'campus.51job.com') name = 'bi-list';
          else if (url.hostname === 'www.careers.jnj.com') name = url.pathname === '/en/jobs/' ? 'jnj-list' : 'jnj-detail';
          else if (url.hostname === 'pfizer.wd1.myworkdayjobs.com') name = url.pathname.includes('/job/') ? 'pfizer-detail' : 'pfizer-list';
          else return route.abort();
          await route.fulfill({ contentType: 'text/html; charset=utf-8', body: await (await fetch(`${base}/${name}`)).text() });
        }); return context;
      } };
    } };
    cua = await createChromiumDom({ chromium: sandboxed, executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium' });
    const plans = await loadDirectPlans(), plan = sourceId => plans.find(row => row.sourceId === sourceId).plan;
    const runStartedAt = new Date().toISOString(), dispatchBefore = new Date(Date.now() + 1800000).toISOString();
    const cspc = await captureOfficialDom('source-cspc-social', cua, runStartedAt);
    const cspcFetch = createOfficialJsonSourceFetch({ allowBrowserFallback: false, http: async request => ({ status: 200,
      finalUrl: request.url, capturedAt: new Date().toISOString(), contentType: request.method === 'POST' ? 'application/json' : 'text/html',
      body: request.method === 'POST' ? rawCspc : request.url.includes('officePage.mob') ? cspcCandidateHtml() : '<html>Synthetic entry</html>' }) });
    const cspcResult = await runSourceCrawl(plan('source-cspc-social'), { fetch: cspcFetch });
    assert.equal(cspcResult.truth.completenessVerified, true, JSON.stringify(cspcResult));
    const cspcInput = { ...cspc, plan: plan('source-cspc-social'), replayedEvidence: cspcResult.fetchEvidence, runStartedAt, dispatchBefore, now: new Date().toISOString() };
    assert.equal(reviewCspcDomHttp(cspcInput).status, 'PASS');
    assert.equal(cspc.applications.observations[0].applicationSubmitted, false);
    assert.throws(() => reviewCspcDomHttp({ ...cspcInput, applications: { ...cspc.applications, observations: [] } }));
    const bi = await captureOfficialDom('source-boehringer-ingelheim-china-social', cua);
    const biInput = { ...bi, plan: plan('source-boehringer-ingelheim-china-social'), uiContract: { exclusions: [] }, now: new Date().toISOString(), dispatchBefore,
      replayedEvidence: { artifacts: [{ logicalKey: '51job-page-0001', body: `jsoncallback(${JSON.stringify({ resultbody: { totalnum: '1', joblist: [{ jobid: '123', jobname: title, jobareaname: '上海' }] } })})` }] } };
    assert.equal(reviewBiDomHttp(biInput).status, 'PASS');
    assert.throws(() => reviewBiDomHttp({ ...biInput, dom: { ...bi.dom, jobs: [{ ...bi.dom.jobs[0], title: 'Mismatch' }] } }));
    const jnj = await captureOfficialDom('source-johnson-innovative-medicine-social', cua);
    const jnjPlan = plan('source-johnson-innovative-medicine-social');
    const jnjResult = await runSourceCrawl(jnjPlan, { fetch: createJnjCareersDomSourceFetch(jnj) });
    assert.equal(jnjResult.truth.completenessVerified, true, JSON.stringify(jnjResult));
    assert.equal(jnjResult.jobs.length, 1);
    assert.equal((await createJnjCareersDomSourceFetch({ ...jnj, details: [] })(jnjPlan)).ok, false);
    const memory = memoryDb(), db = memory.db, workspaceRoot = await mkdtemp(join(tmpdir(), 'jnj-direct-synthetic-'));
    const h = 'a'.repeat(64), identity = identityForSource({ id: 'instabox-synthetic', commitSha: 'a'.repeat(40), rosterHash: h, sourcePlanHash: h, sourceConfigHash: h, adapterBundleHash: h }, jnjPlan.source.id);
    await withPortableCrawlLease(db, async lease => {
      const result = await runP0CrawlBatch([jnjPlan], { db, identity, now: () => new Date(), publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1', portableLease: lease,
        workspaceRoot, evidenceSubdirectory: 'evidence', fetch: async (...args) => createJnjCareersDomSourceFetch(await captureOfficialDom(jnjPlan.source.id, cua))(...args),
        getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => false, getTrustedCompletenessBaseline: async () => null });
      assert.equal(result.status, 'SUCCESS', JSON.stringify(memory.rows));
    });
    assert.equal(memory.jobWrites(), 1);
    const pfizerPage = await contexts[0].newPage(), pfizer = await capturePfizerRenderedTraversal(pfizerPage);
    const row = plans.find(row => row.sourceId === 'source-pfizer-china-social');
    const observedAt = pfizer[0].rawRows[0].rawPayload.capturedAt;
    const validation = createOfficialJsonRenderedTraversalValidation({ sourceId: row.sourceId, companyId: row.companyId,
      sourceConfigSha256: row.sourceConfigSha256, surfaceIds: [row.plan.source.surfaceId], channelIds: row.plan.expectedChannels.map(channel => channel.channelId),
      observedAt, expiresAt: new Date(Date.parse(observedAt) + 1800000).toISOString(), pages: pfizer });
    assert.equal(parseBGradeIndependentTraversalValidation(validation).sourceId, row.sourceId);
    assert.equal(pfizer[0].rawRows.length, 1);
    await pfizerPage.close();
    assert.ok(requests.length >= 6);
  } finally { await cua?.close(); await new Promise(resolve => server.close(resolve)); }
});

