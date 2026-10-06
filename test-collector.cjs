// NONQUALIFYING SYNTHETIC TESTS ONLY. No source navigation, capture, replay, or publication.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const before = fs.readFileSync(path.join(__dirname, 'collector-before.js'), 'utf8');
const fixed = fs.readFileSync(path.join(__dirname, 'collector-fixed.js'), 'utf8');
const hrefA = 'https://example.invalid/apply?exid=SYNTHETIC-A&m=1';
const hrefB = 'https://example.invalid/apply?exid=SYNTHETIC-B&m=1';
const hrefReordered = 'https://example.invalid/apply?m=1&exid=SYNTHETIC-A';
const link = (href, options = {}) => ({href, text: 'Apply now', visible: true, visibility: 'visible', ...options});
const cases = [
  {name: 'same_exact_href_collapses_to_one', links: [link(hrefA), link(hrefA)], expected: [hrefA]},
  {name: 'different_hrefs_remain_distinct', links: [link(hrefA), link(hrefB)], expected: [hrefA, hrefB]},
  {name: 'mixed_duplicates_keep_first_seen_order', links: [link(hrefB), link(hrefA), link(hrefB)], expected: [hrefB, hrefA]},
  {name: 'no_url_normalization_or_query_reordering', links: [link(hrefA), link(hrefReordered)], expected: [hrefA, hrefReordered]},
  {name: 'hidden_anchor_does_not_create_a_destination', links: [link(hrefB, {visible: false}), link(hrefA)], expected: [hrefA]},
  {name: 'visibility_hidden_anchor_is_excluded', links: [link(hrefB, {visibility: 'hidden'}), link(hrefA)], expected: [hrefA]},
  {name: 'visibility_collapsed_anchor_is_excluded', links: [link(hrefB, {visibility: 'collapse'}), link(hrefA)], expected: [hrefA]},
  {name: 'unrelated_link_is_excluded', links: [link(hrefB, {text: 'Sign up'}), link(hrefA)], expected: [hrefA]},
  {name: 'no_apply_stays_empty_for_original_gate', links: [], expected: []},
];
const originalBody = '<div id="js-job-detail" data-id="synthetic-only"><article class="RichTextBody">SYNTHETIC NONQUALIFYING BODY</article></div>';
const originalText = 'SYNTHETIC NONQUALIFYING BODY Job Description: ' + 'Fixture text. '.repeat(30);
const originalDom = 'SYNTHETIC NONQUALIFYING DOM; not an official source observation';
const title = 'Associate MSL Manager - IBD';
const rawTitle = 'Associate MSL Manager  - IBD';
const fakeUrl = 'https://example.invalid/nonqualifying-synthetic-detail/';

async function run(source, fixture) {
  const outputs = [];
  const anchors = fixture.links.map(a => ({
    href: a.href,
    innerText: a.text,
    getClientRects: () => a.visible ? [{width: 100, height: 20}] : [],
    fixtureVisibility: a.visibility,
  }));
  const article = {innerText: originalText};
  const root = {
    outerHTML: originalBody,
    innerText: originalText,
    getAttribute: name => name === 'data-id' ? 'synthetic-only' : name === 'data-jobtitle' ? rawTitle : null,
    querySelector: selector => selector === 'article.RichTextBody' ? article : null,
    querySelectorAll: selector => selector === 'article.RichTextBody' ? [article] : selector === '.job-meta > li' ? [{innerText: 'Job title\n' + title}, {innerText: 'Requisition number\nSYNTHETIC-ONLY'}] : [],
  };
  class SyntheticClock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2000-01-01T00:00:00.000Z'])); }
  }
  const sandbox = {
    Date: SyntheticClock,
    document: {
      querySelector: selector => selector === '#js-job-detail' ? root : selector === 'h1' ? {innerText: title} : null,
      querySelectorAll: selector => selector === 'a' ? anchors : [],
    },
    getComputedStyle: element => ({visibility: element.fixtureVisibility}),
    jnjRefreshTab: {
      playwright: {domSnapshot: async () => originalDom, evaluate: async fn => fn()},
      url: async () => fakeUrl,
    },
    nodeRepl: {write: value => outputs.push(value)},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {timeout: 1000});
  await sandbox.jnjReadDetail({url: fakeUrl, title});
  assert.equal(outputs.length, 1);
  return JSON.parse(outputs[0]);
}

(async () => {
  const results = [];
  for (const fixture of cases) {
    const oldObservation = await run(before, fixture);
    const newObservation = await run(fixed, fixture);
    assert.deepEqual(newObservation.applyLinks.map(a => a.href), fixture.expected);
    assert.ok(newObservation.applyLinks.every(a => a.text === 'Apply now'));
    const {applyLinks: oldLinks, ...oldRemainder} = oldObservation;
    const {applyLinks: newLinks, ...newRemainder} = newObservation;
    assert.deepEqual(newRemainder, oldRemainder);
    assert.equal(newObservation.body.html, originalBody);
    assert.equal(newObservation.dom, originalDom);
    assert.equal(newObservation.check.title, rawTitle);
    assert.equal(newObservation.check.title.replace(/\s+/gu, ' ').trim(), newObservation.heading);
    results.push({name: fixture.name, passed: true, inputHrefs: fixture.links.map(a => a.href), originalApplyLinks: oldLinks, fixedApplyLinks: newLinks, allOtherObservationFieldsUnchanged: true});
  }
  const report = {
    kind: 'NONQUALIFYING_SYNTHETIC_COLLECTOR_FIXTURES',
    qualifyingCapture: false,
    sourceNavigationPerformed: false,
    producerReplayRun: false,
    scope: 'Collector-only synthetic checks; not eligible for any publisher',
    collectorSha256: crypto.createHash('sha256').update(fixed).digest('hex'),
    passed: results.length,
    cases: results,
  };
  fs.writeFileSync(path.join(__dirname, 'NONQUALIFYING-synthetic-test-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({kind: report.kind, passed: report.passed, collectorSha256: report.collectorSha256}));
})().catch(error => { console.error(error); process.exitCode = 1; });
