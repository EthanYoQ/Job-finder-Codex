'use strict';
// Pure bounded sorting only. Exact localeCompare calls from portablePublicationApi.ts.
// No module imports, filesystem, network, child processes or dynamic resources.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  raw += chunk;
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join(',') !== 'cities,companies,provinces') throw Error();
    for (const name of ['cities', 'provinces']) {
      if (!Array.isArray(value[name]) || value[name].length > 10000
          || value[name].some(label => typeof label !== 'string' || label.length > 512)) throw Error();
    }
    if (!Array.isArray(value.companies) || value.companies.length > 500
        || value.companies.some(row => !row || typeof row.id !== 'string' || typeof row.pinyin !== 'string'
          || row.id.length > 512 || row.pinyin.length > 512)) throw Error();
    const result = JSON.stringify({
      cities: value.cities.sort((a, b) => a.localeCompare(b, 'zh-CN')),
      provinces: value.provinces.sort((a, b) => a.localeCompare(b, 'zh-CN')),
      companies: value.companies.sort((a, b) => a.pinyin.localeCompare(b.pinyin) || a.id.localeCompare(b.id)).map(row => row.id)
    });
    if (Buffer.byteLength(result, 'utf8') > 1024 * 1024) throw Error();
    process.stdout.write(result);
  } catch (_) { process.stderr.write('SORT_INPUT_INVALID'); process.exitCode = 2; }
});
