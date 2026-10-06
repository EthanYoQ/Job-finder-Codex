// LOCAL PROPOSAL ONLY. Does not navigate, reload, modify filters, or write captures.
'use strict';
const filterNames = ['team', 'subteam', 'country', 'state', 'location', 'type', 'pattern'];
const normalize = value => String(value).replace(/\s+/gu, ' ').trim();

function checkListReadiness(state, expectedPage, expectedTotal) {
  const reasons = [];
  if (state.keyword !== '') reasons.push('KEYWORD_NOT_EMPTY');
  if (JSON.stringify(state.filters.map(f => f.name)) !== JSON.stringify(filterNames)) reasons.push('FILTER_SET_OR_ORDER');
  for (const filter of state.filters) {
    const expected = filter.name === 'country' ? [{text: 'China', value: 'China'}] : [];
    if (JSON.stringify(filter.selectedOptions) !== JSON.stringify(expected)) reasons.push('FILTER_' + filter.name);
  }
  const match = normalize(state.heading).match(/^Displaying (\d+) to (\d+) of (\d+) matching jobs$/u);
  if (!match) reasons.push('HEADING_FORMAT');
  const [from, to, total] = match ? match.slice(1).map(Number) : [NaN, NaN, NaN];
  if (!Number.isInteger(total) || total < 1 || total > 400) reasons.push('TOTAL_OUTSIDE_ORIGINAL_CONTRACT');
  if (expectedTotal !== undefined && total !== expectedTotal) reasons.push('TOTAL_CHANGED');
  if (String(total) !== state.resultCount) reasons.push('HEADING_RESULT_ATTRIBUTE_MISMATCH');
  if (from !== (expectedPage - 1) * 20 + 1 || to !== Math.min(expectedPage * 20, total)) reasons.push('PAGE_RANGE_MISMATCH');
  if (state.identities.length !== to - from + 1) reasons.push('CARD_COUNT_MISMATCH');
  if (new Set(state.identities.map(i => i.officialId)).size !== state.identities.length) reasons.push('DUPLICATE_ID');
  for (const item of state.identities) {
    if (!/^r-\d+$/u.test(item.officialId) || item.links.length !== 1 || !normalize(item.links[0]?.title ?? '')) reasons.push('CARD_IDENTITY_FORMAT');
    if (item.links.length === 1 && !item.links[0].url.startsWith('https://www.careers.jnj.com/en/jobs/' + item.officialId + '/')) reasons.push('CARD_URL_ID_MISMATCH');
  }
  const canonical = 'https://www.careers.jnj.com/en/jobs/?' + (expectedPage > 1 ? 'page=' + expectedPage + '&' : '') + 'country=China&origin=global#results';
  const alias = 'https://www.careers.jnj.com/en/jobs/?search=&country=China&origin=global';
  if (state.url !== canonical && !(expectedPage === 1 && state.url === alias)) reasons.push('PAGE_URL_MISMATCH');
  const nativePageNumbers = state.pagination.map(p => p.label.match(/^(?:Page |Last page )(\d+)$/u)).filter(Boolean).map(m => Number(m[1]));
  const pageCount = Math.ceil(total / 20);
  if (Math.max(...nativePageNumbers) !== pageCount) reasons.push('NATIVE_PAGE_COUNT_MISMATCH');
  if (expectedPage < pageCount && !state.pagination.some(p => p.label === 'Next page' && p.url === 'https://www.careers.jnj.com/en/jobs/?page=' + (expectedPage + 1) + '&country=China&origin=global#results')) reasons.push('NEXT_PAGE_MISMATCH');
  return {ready: reasons.length === 0, reasons, total, pageCount, from, to};
}

// Each supported locator wait and read gets the remaining overall budget.
// No timers, navigation, reloads, network requests, or filter changes are used.
async function waitForListReadiness(tab, expectedPage, expectedTotal, timeoutMs = 15000) {
  const readinessStartedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error('LIST_READINESS_TIMEOUT');
    return ms;
  };
  const ids = ['l-team', 'l-subteam', 'l-country', 'l-state', 'l-location', 'l-type', 'l-pattern'];
  const emptyIds = ids.filter(id => id !== 'l-country');
  const scopeSelector = 'body' + ids.map(id => ':has(#' + id + ')').join('') +
    ':has(#l-country option[value="China"]:checked)' +
    ':not(:has(#l-country option:checked:not([value="China"])))' +
    emptyIds.map(id => ':not(:has(#' + id + ' option:checked))').join('');
  await tab.playwright.locator(scopeSelector).waitFor({state: 'attached', timeoutMs: remaining()});
  const first = (expectedPage - 1) * 20 + 1;
  await tab.playwright.getByRole('heading', {name: new RegExp('^Displaying ' + first + ' to \\d+ of \\d+ matching jobs$'), exact: true}).waitFor({state: 'visible', timeoutMs: remaining()});
  const state = await tab.playwright.getByRole('searchbox', {name: 'Keywords', exact: true}).evaluate(keyword => {
    const doc = keyword.ownerDocument;
    const root = doc.querySelector('#js-job-search-results');
    return {
      keyword: keyword.value,
      url: doc.URL,
      heading: [...doc.querySelectorAll('h2')].find(e => e.innerText.startsWith('Displaying'))?.innerText ?? '',
      filters: [...doc.querySelectorAll('select')].map(e => ({id: e.id, name: e.name, selectedOptions: [...e.selectedOptions].map(o => ({text: o.text, value: o.value}))})),
      resultCount: root?.getAttribute('data-results') ?? null,
      identities: root ? [...root.children].map(e => ({officialId: e.getAttribute('data-id'), links: [...e.querySelectorAll('a.js-view-job')].map(a => ({title: a.innerText, url: a.href}))})) : [],
      pagination: [...doc.querySelectorAll('nav[aria-label="Pagination"] a')].map(a => ({label: a.getAttribute('aria-label'), url: a.href})),
    };
  }, undefined, {timeoutMs: remaining()});
  remaining();
  const result = checkListReadiness(state, expectedPage, expectedTotal);
  if (!result.ready) {
    const error = new Error('LIST_READINESS_REJECTED: ' + result.reasons.join(','));
    error.nonqualifyingState = state;
    throw error;
  }
  return {kind: 'NONQUALIFYING_LIST_READINESS_GATE_ONLY', qualifyingCapture: false, readinessStartedAt, state, result};
}

module.exports = {checkListReadiness, waitForListReadiness};
