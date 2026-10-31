import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

test('saved admin writes survive dashboard failure; unknown writes retain drafts without replay', async () => {
  const root = new URL('../web-candidate/dist/', import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      const path = request.url === '/admin' ? 'index.html' : request.url.slice(1);
      response.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(new URL(path, root)));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const model = {sources: [], feedbackQueue: [{id: 'feedback', companyName: 'Synthetic', description: 'Test', issueType: 'Test'}],
    recommendationQueue: [{id: 'recommendation', companyName: 'Synthetic', officialWebsiteUrl: 'https://example.invalid'}],
    categoryCorrectionQueue: [{jobId: 'job', companyName: 'Synthetic', jobTitle: 'Test', currentCategory: '销售', suggestedCategory: '销售'}]};
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.JOBFINDER_TEST_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true, chromiumSandbox: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync']});
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.addInitScript(() => sessionStorage.setItem('job-search-admin-token', 'synthetic-token'));
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    for (const [endpoint, button, message] of [
      ['feedback-review', '标记反馈已复核', '反馈复核已保存'],
      ['recommendation-review', '标记推荐已复核', '推荐复核已保存'],
      ['category-correction', '提交类目纠正', '分类修正已保存']
    ]) {
      let writes = 0, offline = false;
      await context.route(base + '/admin/api/dashboard', route => route.fulfill({status: offline ? 503 : 200,
        json: offline ? {error: 'WRITE_RESULT_UNKNOWN'} : model}));
      await context.route(base + '/admin/api/' + endpoint, route => {
        writes++; offline = true; return route.fulfill({status: 200, json: {status: 'SAVED'}});
      });
      await page.goto(base + '/admin');
      await page.getByLabel('纠正原因').fill('Retain this draft');
      await page.getByRole('button', {name: button, exact: true}).click();
      await page.getByRole('alert').filter({hasText: message}).waitFor();
      assert.equal(writes, 1);
      assert.equal(await page.getByRole('button', {name: button, exact: true}).isEnabled(), true);
      assert.equal(await page.getByLabel('纠正原因').inputValue(), 'Retain this draft');
      assert.equal(await page.getByText('提交结果尚未确认', {exact: false}).count(), 0);
      offline = false;
      await page.getByRole('button', {name: '刷新后台数据'}).click();
      await page.getByRole('alert').waitFor({state: 'hidden'});
      assert.equal(writes, 1);
      await context.unroute(base + '/admin/api/' + endpoint);
      await context.unroute(base + '/admin/api/dashboard');
    }
    let writes = 0;
    await context.route(base + '/admin/api/dashboard', route => route.fulfill({json: model}));
    await context.route(base + '/admin/api/category-correction', route => {
      writes++; return route.fulfill({status: 504, json: {error: 'WRITE_RESULT_UNKNOWN'}});
    });
    await page.goto(base + '/admin');
    await page.getByLabel('纠正原因').fill('Unknown draft');
    await page.getByRole('button', {name: '提交类目纠正'}).click();
    await page.getByRole('alert').filter({hasText: '提交结果尚未确认'}).waitFor();
    await page.getByRole('button', {name: '刷新后台数据'}).click();
    assert.equal(await page.getByRole('button', {name: '提交类目纠正'}).isDisabled(), true);
    assert.equal(await page.getByLabel('纠正原因').inputValue(), 'Unknown draft');
    assert.equal(writes, 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
