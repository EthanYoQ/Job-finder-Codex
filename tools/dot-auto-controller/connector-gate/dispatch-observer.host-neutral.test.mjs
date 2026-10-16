import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {cloneEvidenceData, equalEvidenceData} from './dispatch-observer.mjs';

const source = fs.readFileSync(new URL('./dispatch-observer.mjs', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('./dispatch-observer.functions.js', import.meta.url), 'utf8');
const smoke = fs.readFileSync(new URL('./dispatch-observer.functions.smoke.js', import.meta.url), 'utf8');
const returned = '\nreturn Object.freeze({createDispatchObserver,restoreDispatchObserver,cloneEvidenceData,equalEvidenceData});\n';

test('functions bundle is the exact fixed source transform, with no hidden implementation', () => {
  assert.equal(bundle, source.replace(/^export /gm, '') + returned);
  assert.doesNotMatch(bundle, /^import\b|^export\b|structuredClone|node:util|\brequire\s*\(/m);
});

test('same pure smoke runs in a realm without Node globals or structuredClone', async () => {
  const context = vm.createContext({setTimeout(){return 1;},clearTimeout(){}});
  assert.equal(vm.runInContext('typeof structuredClone', context), 'undefined');
  assert.equal(vm.runInContext('typeof process', context), 'undefined');
  assert.equal(vm.runInContext('typeof require', context), 'undefined');
  const body = '(async()=>{const observerAPI=(function(){' + bundle + '})();' + smoke + '})()';
  const result = await vm.runInContext(body, context);
  assert.equal(result.passed, true);assert.equal(result.calls, 1);
  assert.equal(result.realPort, 'DISABLED');assert.equal(result.sameOriginalPromise, true);
});

test('clone retains explicit undefined, nested arrays, finite numbers and negative zero', () => {
  const original={a:undefined,b:[undefined,null,-0,0,1.5,true,'值'],nested:{missing:undefined}};
  const cloned=cloneEvidenceData(original);
  assert.deepEqual(cloned,original);assert.notEqual(cloned,original);assert.notEqual(cloned.b,original.b);
  assert.equal(Object.hasOwn(cloned,'a'),true);assert.equal(Object.is(cloned.b[2],-0),true);
});

test('deep equality preserves original data distinctions without JSON stringify shortcuts', () => {
  assert.equal(equalEvidenceData({b:2,a:1},{a:1,b:2}),true);
  assert.equal(equalEvidenceData({a:undefined},{}),false);
  assert.equal(equalEvidenceData([undefined],[]),false);
  assert.equal(equalEvidenceData(-0,0),false);
  assert.equal(equalEvidenceData([1],{'0':1}),false);
  assert.equal(equalEvidenceData({a:{b:1}},{a:{b:2}}),false);
});

test('own __proto__ remains plain data and cannot change the clone prototype', () => {
  const input=JSON.parse('{"__proto__":{"injected":true},"constructor":"data"}');
  const cloned=cloneEvidenceData(input);
  assert.equal(Object.getPrototypeOf(cloned),Object.prototype);
  assert.equal(Object.hasOwn(cloned,'__proto__'),true);assert.equal(cloned.injected,undefined);
  assert.equal(equalEvidenceData(input,cloned),true);
});

for (const [name, create] of [
  ['function',()=>()=>{}],['symbol',()=>Symbol('TEST_ONLY')],['bigint',()=>1n],
  ['NaN',()=>NaN],['Infinity',()=>Infinity],['Date',()=>new Date(0)],['RegExp',()=>/x/],
  ['Map',()=>new Map()],['Set',()=>new Set()],['Error',()=>Error('TEST_ONLY')],
  ['typed array',()=>new Uint8Array([1])],['null prototype',()=>Object.create(null)],
  ['class instance',()=>new(class TestOnly {})()],['custom prototype',()=>Object.create({a:1})],
  ['symbol key',()=>({[Symbol('TEST_ONLY')]:1})],['sparse array',()=>new Array(1)],
  ['custom array property',()=>Object.assign([1],{extra:2})],
]) {
  test(`strict evidence rejects ${name}, even when both equality references are identical`, () => {
    const value=create();assert.throws(()=>cloneEvidenceData(value),/EVIDENCE_/);
    assert.throws(()=>equalEvidenceData(value,value),/EVIDENCE_/);
  });
}

test('cycles are rejected while repeated acyclic JSON-shaped values remain data', () => {
  const cycle={};cycle.self=cycle;assert.throws(()=>cloneEvidenceData(cycle),/EVIDENCE_CYCLE/);
  const shared={a:1};assert.deepEqual(cloneEvidenceData({a:shared,b:shared}),{a:{a:1},b:{a:1}});
});

test('accessors and nonenumerable properties are rejected without invocation', () => {
  let calls=0;const getter={};Object.defineProperty(getter,'x',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>cloneEvidenceData(getter),/EVIDENCE_PROPERTY_DESCRIPTOR/);assert.equal(calls,0);
  const hidden={};Object.defineProperty(hidden,'x',{value:1,enumerable:false});
  assert.throws(()=>cloneEvidenceData(hidden),/EVIDENCE_PROPERTY_DESCRIPTOR/);
});

test('frozen original JSON evidence is supported without prototype or descriptor relaxation', () => {
  const original=Object.freeze({a:Object.freeze([Object.freeze({b:undefined})])});
  assert.equal(equalEvidenceData(original,cloneEvidenceData(original)),true);
});
