// Pure synthetic teaching models. These are NOT the production compiler or parser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);

// Reduced shared-value compiler: object fields become plain-part + shared-part.
// Flattening these parts can change insertion order and the NEXT sharing analysis.
function compile(terminal, context) {
  const counts = new Map(), values = new Map();
  function scan(value) {
    const key = JSON.stringify(value);
    counts.set(key, (counts.get(key) ?? 0) + 1); values.set(key, value);
    if (value && typeof value === 'object') Object.values(value).forEach(scan);
  }
  scan(terminal); scan(context);
  const keys = [...counts].filter(([key, count]) => count > 1 && key.length > 40).map(([key]) => key);
  const ids = new Map(keys.map((key, index) => [key, index]));
  function encode(value) {
    const key = JSON.stringify(value);
    if (ids.has(key)) return ['ref', ids.get(key)];
    if (!value || typeof value !== 'object') return ['literal', value];
    const plain = [], shared = [];
    for (const [name, child] of Object.entries(value)) {
      (ids.has(JSON.stringify(child)) ? shared : plain).push([name, encode(child)]);
    }
    return ['merge', plain, shared];
  }
  return JSON.stringify({defs: keys.map(key => values.get(key)), roots: [encode(terminal), encode(context)]});
}
function decode(source) {
  const packet = JSON.parse(source);
  function expand(node) {
    if (node[0] === 'ref') return clone(packet.defs[node[1]]);
    if (node[0] === 'literal') return node[1];
    return Object.fromEntries([...node[1], ...node[2]].map(([key, value]) => [key, expand(value)]));
  }
  return packet.roots.map(expand);
}
const shared = 'Invented shared value. '.repeat(5);
const terminal = {nested: {plain: 1, shared}};
const context = {nested: {shared, plain: 1}};
const original = compile(terminal, context);
const originBytes = Buffer.from(JSON.stringify(context));
const binding = {request: 'synthetic-request', source: 'synthetic-source', batch: 'synthetic-batch', candidate: 'synthetic-candidate'};
const descriptor = {...binding, originSha: sha(originBytes), packetSha: sha(Buffer.from(original))};
function review(packet, bytes, desc, expected = binding) {
  for (const [key, value] of Object.entries(expected)) if (desc[key] !== value) throw Error('BINDING');
  if (sha(bytes) !== desc.originSha || sha(Buffer.from(packet)) !== desc.packetSha) throw Error('BYTES');
  const saved = JSON.parse(bytes.toString('utf8')), [decodedTerminal, decodedContext] = decode(packet);
  assert.deepStrictEqual(saved, decodedContext);
  if (compile(decodedTerminal, saved) !== packet) throw Error('ROUNDTRIP');
  return true;
}

test('semantic decode succeeds but flattening changes the next shared declaration structure', () => {
  const [t, c] = decode(original);
  assert.deepStrictEqual(t, terminal); assert.deepStrictEqual(c, context);
  assert.notEqual(compile(t, c), original);
});
test('request-bound original context restores every compiler-model byte', () => {
  assert.equal(review(original, originBytes, descriptor), true);
});
test('equal semantics with wrong insertion order still fails the byte gate', () => {
  const reordered = Buffer.from(JSON.stringify({nested: {plain: 1, shared}}));
  assert.throws(() => review(original, reordered, {...descriptor, originSha: sha(reordered)}), /ROUNDTRIP/);
});
test('changed context content cannot pass by recomputing its hash', () => {
  const changed = Buffer.from(JSON.stringify({nested: {shared, plain: 2}}));
  assert.throws(() => review(original, changed, {...descriptor, originSha: sha(changed)}), assert.AssertionError);
});
test('each request/source/batch/candidate substitution is rejected', () => {
  for (const key of Object.keys(binding)) assert.throws(() => review(original, originBytes, {...descriptor, [key]: 'other'}), /BINDING/);
});
test('whitespace mutation is not silently canonicalized', () => {
  const spaced = ` ${original}`;
  assert.throws(() => review(spaced, originBytes, descriptor), /BYTES/);
  assert.throws(() => review(spaced, originBytes, {...descriptor, packetSha: sha(Buffer.from(spaced))}), /ROUNDTRIP/);
});
test('two invalid UTF8 bytes collide after decoding but not under raw-byte hashing', () => {
  const a = Buffer.from([0xff]), b = Buffer.from([0xfe]);
  assert.equal(a.toString('utf8'), b.toString('utf8'));
  assert.equal(sha(a.toString('utf8')), sha(b.toString('utf8')));
  assert.notEqual(sha(a), sha(b));
  assert.notEqual(sha(a), sha(a.toString('utf8')));
});
test('valid UTF8 preserves the existing byte hash; raw hash alone does not validate JSON', () => {
  const good = Buffer.from('{"synthetic":"示例"}'), bad = Buffer.from('not-json');
  assert.equal(sha(good), sha(good.toString('utf8')));
  const badDescriptor = {...descriptor, originSha: sha(bad)};
  assert.throws(() => review(original, bad, badDescriptor), SyntaxError);
});
test('a direct child must receive source selection before module evaluation', () => {
  const code = 'const selected=process.env.SYNTHETIC_SOURCE_ID??"default-source";process.stdout.write(selected)';
  const run = env => execFileSync(process.execPath, ['--input-type=module', '-e', code], {env, encoding: 'utf8'});
  assert.equal(run({}), 'default-source');
  assert.equal(run({SYNTHETIC_SOURCE_ID: 'intended-source'}), 'intended-source');
});

// Reduced fixed-profile workplace fallback. Field IDs are invented, not source data.
const fieldNames = {F1: 'Req status', F2: 'Primary job posting location', F3: 'Primary location', F4: 'Additional job posting locations', F5: 'Additional locations'};
const clean = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
function fixture() {
  const row = {id: 'synthetic-job', org: 'synthetic-org', title: 'Invented role', status: 'open', date: '2000-01-01', locations: []};
  const values = ['Open', 'Shanghai Example Plaza', 'Shanghai Example Plaza', '', ''];
  const detail = {...clone(row), fields: Object.fromEntries(Object.entries(fieldNames).map(([id, name], i) => [id, {name, value: values[i]}]))};
  return {row, detail};
}
function city(label) {
  const value = clean(label);
  if (/Hong\s*Kong|Taipei|Singapore|Beijing|remote|\bor\b|\band\b/iu.test(value)) throw Error('LOCATION');
  if (value === '上海' || value === '上海市' || value.toLowerCase() === 'shanghai') return '上海';
  // Closed synthetic fixture vocabulary, not a production city/facility grammar.
  if (['Shanghai Example Plaza', 'Shanghai Fictional Office'].includes(value)) return '上海';
  throw Error('LOCATION');
}
function resolve(row, detail) {
  for (const key of ['id', 'org', 'title', 'status', 'date']) if (row[key] !== detail[key]) throw Error('IDENTITY');
  if (row.org !== 'synthetic-org' || row.status !== 'open') throw Error('PROFILE');
  if (!Array.isArray(row.locations) || row.locations.length || !Array.isArray(detail.locations) || detail.locations.length) throw Error('STANDARD_PATH');
  const values = {};
  for (const [id, name] of Object.entries(fieldNames)) {
    const field = detail.fields[id];
    if (!field || Object.keys(field).sort().join(',') !== 'name,value' || field.name !== name || typeof field.value !== 'string') throw Error('FIELD');
    values[id] = clean(field.value);
  }
  if (values.F1 !== 'Open' || values.F2 !== values.F3 || values.F4 || values.F5) throw Error('CONFLICT');
  for (const [id, field] of Object.entries(detail.fields)) {
    if (!(id in fieldNames) && /location|country|city/iu.test(field.name) && String(field.value ?? '').trim()) throw Error('UNREVIEWED');
  }
  return {cities: [city(values.F2)], locationRaw: values.F2};
}
function captureArtifacts(row, detail) {
  return [['entry', {org: row.org}], ['page', {rows: [row]}], ['detail', detail]].map(([role, value]) => {
    const body = Buffer.from(JSON.stringify(value));
    return {role, body, hash: sha(body), requestedJob: role === 'detail' ? row.id : null};
  });
}
function replay(expectedRow, _detailNotTrusted, output, artifacts) {
  const roles = artifacts.map(item => item.role);
  if (new Set(roles).size !== 3 || roles.length !== 3 || !['entry', 'page', 'detail'].every(x => roles.includes(x))) throw Error('EVIDENCE_SET');
  const decoded = {};
  for (const artifact of artifacts) {
    if (sha(artifact.body) !== artifact.hash) throw Error('ARTIFACT_BYTES');
    decoded[artifact.role] = JSON.parse(artifact.body.toString('utf8'));
    if (artifact.role === 'detail' && artifact.requestedJob !== expectedRow.id) throw Error('REQUEST');
  }
  const row = decoded.page.rows[0];
  if (decoded.page.rows.length !== 1 || row.id !== expectedRow.id || row.org !== decoded.entry.org) throw Error('SOURCE_BINDING');
  if ('officialPublishedAt' in output) throw Error('UNPROVEN_DATE');
  assert.deepStrictEqual(output, resolve(row, decoded.detail));
}
test('strict replay independently reconstructs the same explicit workplace', () => {
  const {row, detail} = fixture();
  const output = resolve(row, detail);
  replay(row, detail, output, captureArtifacts(row, detail));
  assert.deepStrictEqual(output, {cities: ['上海'], locationRaw: 'Shanghai Example Plaza'});
});
test('both explicit city and reviewed single-facility labels work', () => {
  for (const label of ['Shanghai', '上海市', 'Shanghai Fictional Office']) assert.equal(city(label), '上海');
});
test('substring, foreign, ambiguous and remote labels reject', () => {
  for (const label of ['NotShanghai Example Plaza', 'Shanghai Singapore Plaza', 'Shanghai HongKong Plaza', 'Shanghai Beijing Office', 'Shanghai Shenzhen Office', 'Shanghai Macau Office', 'Shanghai Unreviewed Office', 'Shanghai Remote Office', 'Shanghai or Beijing', 'China', 'Unknown']) assert.throws(() => city(label));
});
test('every identity and source change rejects', () => {
  for (const key of ['id', 'org', 'title', 'status', 'date']) {
    const {row, detail} = fixture(); detail[key] = 'other';
    assert.throws(() => resolve(row, detail), /IDENTITY/);
  }
  const {row, detail} = fixture(); row.org = detail.org = 'other';
  assert.throws(() => resolve(row, detail), /PROFILE/);
});
test('missing standard fields and existing standard locations never use fallback', () => {
  for (const mutate of [x => delete x.locations, x => x.locations.push({city: '北京'})]) {
    const {row, detail} = fixture(); mutate(detail);
    assert.throws(() => resolve(row, detail), /STANDARD_PATH/);
  }
});
test('field rename, extra shape, wrong type and missing fields reject', () => {
  for (const mutate of [x => x.F2.name = 'Recruiter location', x => x.F2.extra = true, x => x.F2.value = [], x => delete x.F2]) {
    const {row, detail} = fixture(); mutate(detail.fields);
    assert.throws(() => resolve(row, detail), /FIELD/);
  }
});
test('different facilities, additional locations and non-open status reject', () => {
  for (const [key, value] of [['F3', 'Shanghai Other Office'], ['F4', 'Shanghai'], ['F5', 'Unknown'], ['F1', 'Frozen']]) {
    const {row, detail} = fixture(); detail.fields[key].value = value;
    assert.throws(() => resolve(row, detail), /CONFLICT/);
  }
});
test('new nonempty unreviewed workplace fields reject', () => {
  const {row, detail} = fixture(); detail.fields.F6 = {name: 'Workplace country', value: 'Singapore'};
  assert.throws(() => resolve(row, detail), /UNREVIEWED/);
});
test('output mutation and unsupported timestamp reject during replay', () => {
  const {row, detail} = fixture(), output = resolve(row, detail);
  assert.throws(() => replay(row, detail, {...output, cities: ['北京']}, captureArtifacts(row, detail)), assert.AssertionError);
  assert.throws(() => replay(row, detail, {...output, officialPublishedAt: '2000-01-01T00:00:00Z'}, captureArtifacts(row, detail)), /UNPROVEN_DATE/);
});
test('missing, extra or duplicate artifacts reject during replay', () => {
  const {row, detail} = fixture(), output = resolve(row, detail);
  const all = captureArtifacts(row, detail);
  for (const set of [all.slice(0, 2), [...all, {...all[0], role: 'extra'}], [all[0], all[1], all[1]]]) assert.throws(() => replay(row, detail, output, set), /EVIDENCE_SET/);
});

test('raw evidence corruption and wrong request binding reject before replay', () => {
  const {row, detail} = fixture(), output = resolve(row, detail);
  const bytesChanged = captureArtifacts(row, detail); bytesChanged[2].body[0] ^= 1;
  assert.throws(() => replay(row, detail, output, bytesChanged), /ARTIFACT_BYTES/);
  const wrongRequest = captureArtifacts(row, detail); wrongRequest[2].requestedJob = 'other';
  assert.throws(() => replay(row, detail, output, wrongRequest), /REQUEST/);
  const altered = captureArtifacts(row, detail), d = JSON.parse(altered[2].body);
  d.fields.F3.value = 'Shanghai Other Office';
  altered[2].body = Buffer.from(JSON.stringify(d)); altered[2].hash = sha(altered[2].body);
  assert.throws(() => replay(row, detail, output, altered), /CONFLICT/);
});
test('label cleanup is explicit and original evidence bytes stay intact', () => {
  const {row, detail} = fixture();
  detail.fields.F2.value = detail.fields.F3.value = '  Shanghai   Example Plaza  ';
  const artifacts = captureArtifacts(row, detail), before = Buffer.from(artifacts[2].body);
  const output = resolve(row, detail);
  assert.equal(output.locationRaw, 'Shanghai Example Plaza');
  replay(row, detail, output, artifacts);
  assert.deepStrictEqual(artifacts[2].body, before);
  assert.equal(JSON.parse(before).fields.F2.value, '  Shanghai   Example Plaza  ');
});

test('review uses original byte pins before replacement decoding', () => {
  const a = Buffer.concat([Buffer.from('{"marker":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  const b = Buffer.concat([Buffer.from('{"marker":"'), Buffer.from([0xfe]), Buffer.from('"}')]);
  const packet = compile({synthetic: true}, JSON.parse(a.toString('utf8')));
  const bound = {...binding, originSha: sha(a), packetSha: sha(Buffer.from(packet))};
  assert.equal(review(packet, a, bound), true); // Only this small model's schema and identity, not production validity.
  assert.throws(() => review(packet, b, bound), /BYTES/);
  assert.throws(() => review(packet, a, {...bound, originSha: sha(a.toString('utf8'))}), /BYTES/);
});
