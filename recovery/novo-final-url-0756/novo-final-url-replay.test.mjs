import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [vendor] = process.argv.slice(2);
assert(vendor, 'usage: node --import <tsx loader> test.mjs <vendor>');
const source = fs.readFileSync(new URL('./replay-original-json-archive.mts', import.meta.url), 'utf8');
const expression = source.match(/return \{status:artifact\.httpStatus,body:bodies\.get\(artifact\.path\),finalUrl:([^\n]+?),contentType:/)?.[1];
assert(expression, 'actual replay response finalUrl expression required');
const finalUrl = new Function('moka', 'sanofi', 'd', 'artifact', 'req', `return (${expression});`);
const d = {terminal: {sourceId: 'source-novo-nordisk-china-social'}};
const request = 'https://career2.successfactors.eu/career?career_ns=job_listing&company=novonordisk&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB&career_job_req_id=123&selected_lang=en_GB';
const detail = {requestedUrl: 'https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.123.en_GB.html'};
const application = {logicalKey: 'novo-application-123.en_GB', finalUrl: 'https://careers.novonordisk.com/job/Example/456/'};
// Deliberately small artificial pages, never raw captured content.
const detailBody = `<div id="careerjobdisplay"><h1>Example role</h1><a href="${request.replaceAll('&', '&amp;')}">Apply</a></div>`;
const applicationBody = '<div class="jobDisplay"><div class="job"><h1 data-careersite-propertyid="title">Example role</h1><div class="jobGeoLocation">Beijing, CN</div></div><a class="apply" href="/talentcommunity/apply/456/?locale=en_GB">Apply now</a></div>';
const {novoNativeApplicationUrl, novoApplicationStatus} = await import(pathToFileURL(path.join(vendor, 'src/crawler/novoChinaQuality.ts')));
assert.equal(novoNativeApplicationUrl(detailBody, detail.requestedUrl, '123.en_GB'), request);
assert.equal(novoApplicationStatus(applicationBody, request, 'Beijing'), undefined, 'old request URL reproduces UNKNOWN');
const selected = finalUrl(false, false, d, application, {url: request});
assert.equal(selected, application.finalUrl, 'recorded final URL preserved byte for byte');
assert.equal(novoApplicationStatus(applicationBody, selected, 'Beijing')?.status, 'ACTIVE');

for (const invalid of [undefined, request, selected.replace('careers.novonordisk.com', 'example.com'), selected.replace('/456/', '/457/'), selected + '?changed=1']) {
  const replayed = finalUrl(false, false, d, {...application, finalUrl: invalid}, {url: request});
  assert.equal(replayed, invalid, 'do not synthesize or repair a missing/mismatched archived destination');
  assert.equal(novoApplicationStatus(applicationBody, replayed, 'Beijing'), undefined, 'invalid destination remains UNKNOWN');
}
assert.equal(novoApplicationStatus(applicationBody, selected, 'Shanghai'), undefined, 'wrong location remains UNKNOWN');
assert.equal(novoNativeApplicationUrl(detailBody, detail.requestedUrl, '124.en_GB'), undefined, 'wrong requisition remains unbound');

const req = {url: 'https://example.com/original?key=value'};
assert.equal(finalUrl(false, false, d, {...application, logicalKey: 'novo-native-entry'}, req), req.url, 'non-application URL handling unchanged');
assert.equal(finalUrl(false, false, {terminal: {sourceId: 'other'}}, application, req), req.url, 'other sources unchanged');
assert.equal(finalUrl(true, false, d, application, req), application.finalUrl, 'Moka final URL handling unchanged');
assert.equal(finalUrl(false, true, d, {...application, kind: 'ATS_PAGE'}, req), application.finalUrl, 'Sanofi ATS page handling unchanged');
console.log('PASS: recorded Novo final URL restores ACTIVE; missing/wrong destination, posting ID, city and requisition remain UNKNOWN/unbound; other response branches unchanged; artificial fixtures only');
