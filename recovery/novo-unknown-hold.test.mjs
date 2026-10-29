import assert from 'node:assert/strict'; import fs from 'node:fs';
const text=fs.readFileSync(process.argv[2],'utf8'); const expr=text.match(/const hold=(.*?);if\(hold\)/)[1];
const check=(id,holds)=>Function('sourceId','load','return '+expr)(id,()=>holds);
assert.equal(check('source-cttq-social',{}),'UNRESOLVED_20261028_BATCH_READONLY');
assert.equal(check('source-novo-nordisk-china-social',{}),'EXPIRED_20261029_DIRECT_JOB_VERIFICATION_UNKNOWN_READONLY');
assert.equal(check('source-novo-nordisk-china-social',{'source-novo-nordisk-china-social':null}),'EXPIRED_20261029_DIRECT_JOB_VERIFICATION_UNKNOWN_READONLY');
assert.equal(check('source-abbvie-social',{}),undefined);
assert.equal(check('source-abbvie-social',{'source-abbvie-social':'EXISTING_HOLD'}),'EXISTING_HOLD');
console.log('5 exact hold assertions passed');
