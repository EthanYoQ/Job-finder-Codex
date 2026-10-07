#!/usr/bin/env node
// Synthetic JSON model, not a production parser or a reproduction of an OOM.
// No dependencies, network, environment secrets, production input, or writes.
import assert from 'node:assert/strict';

function parser(counter) {
  return (body, options) => {
    counter.calls++;
    const parsed = JSON.parse(body);
    return Object.freeze(parsed.rows.map(row => Object.freeze({
      id: row.id, title: options.uppercase ? row.title.toUpperCase() : row.title,
    })));
  };
}

// One immutable input and options per scope; identity cannot drift between rows.
function scope(body, options, parse) {
  const fixedOptions = Object.freeze({ ...options });
  let document;
  let closed = false;
  return {
    get() {
      assert.equal(closed, false, 'closed context cannot be reused');
      return document ??= parse(body, fixedOptions);
    },
    close() { document = undefined; body = undefined; closed = true; },
    hasDocument() { return document !== undefined; },
  };
}

async function run(body, options, indexes, reuse, counters, inspect = () => {}, cancel = false) {
  const parse = parser(counters);
  const context = scope(body, options, parse);
  const results = [];
  try {
    for (const index of indexes) {
      await Promise.resolve(); // Interleave concurrent scopes deterministically.
      if (cancel && results.length > 0) throw new Error('cancelled');
      // Pre-parse rejection must remain lazy, including on malformed input.
      if (index < 0) { results.push({ rejected: 'INDEX_INVALID', index }); continue; }
      const document = reuse ? context.get() : parse(body, options);
      const row = document[index];
      if (!row || !row.title) results.push({ rejected: 'TITLE_INVALID', index });
      else results.push({ ...row });
    }
    return results;
  } finally {
    context.close();
    inspect(context);
  }
}

let checks = 0;
const noRetainedDocument = context => {
  assert.equal(context.hasDocument(), false);
  assert.throws(() => context.get(), /closed context/);
  checks++;
};
const body = JSON.stringify({ padding: 'x'.repeat(2_130_000), rows:
  Array.from({ length: 155 }, (_, id) => ({ id, title: id === 7 ? '' : `role-${id}` })) });
const indexes = [-1, ...Array.from({ length: 155 }, (_, i) => i), 999];
const oldCount = { calls: 0 }, newCount = { calls: 0 };
const baseline = await run(body, {}, indexes, false, oldCount, noRetainedDocument);
const optimized = await run(body, {}, indexes, true, newCount, noRetainedDocument);
assert.deepEqual(optimized, baseline);
assert.equal(oldCount.calls, 156);
assert.equal(newCount.calls, 1);
assert.equal(optimized.filter(row => row.rejected).length, 3);
checks++;

// Same length and logical URL can have different content; scopes stay separate.
const a = JSON.stringify({ rows: [{ id: 1, title: 'alpha' }] });
const b = JSON.stringify({ rows: [{ id: 1, title: 'bravo' }] });
assert.equal(a.length, b.length);
const concurrent = await Promise.all([
  run(a, {}, [0, 0], true, { calls: 0 }, noRetainedDocument),
  run(b, {}, [0, 0], true, { calls: 0 }, noRetainedDocument),
  run(a, { uppercase: true }, [0], true, { calls: 0 }, noRetainedDocument),
]);
assert.deepEqual(concurrent.map(rows => rows.map(row => row.title)), [
  ['alpha', 'alpha'], ['bravo', 'bravo'], ['ALPHA'],
]);
checks++;

for (const reuse of [false, true]) {
  const count = { calls: 0 };
  assert.deepEqual(await run('invalid', {}, [-1], reuse, count, noRetainedDocument),
    [{ rejected: 'INDEX_INVALID', index: -1 }]);
  assert.equal(count.calls, 0);
  await assert.rejects(run('invalid', {}, [0], reuse, count, noRetainedDocument), SyntaxError);
  const cancelledCount = { calls: 0 };
  await assert.rejects(run(a, {}, [0, 0], reuse, cancelledCount, noRetainedDocument, true), /cancelled/);
  assert.equal(cancelledCount.calls, 1);
  checks++;
}

// Parse options are captured, not a mutable external identity.
const options = { uppercase: false };
const frozenScope = scope(a, options, parser({ calls: 0 }));
options.uppercase = true;
assert.equal(frozenScope.get()[0].title, 'alpha');
assert.throws(() => { frozenScope.get()[0].title = 'modified'; }, TypeError);
frozenScope.close();
noRetainedDocument(frozenScope);
checks++;

console.log(JSON.stringify({ status: 'PASS', checks, baselineParseCalls: oldCount.calls,
  reusedParseCalls: newCount.calls, scope: 'synthetic invariants only; no OOM reproduction or GC/RSS claim' }));
