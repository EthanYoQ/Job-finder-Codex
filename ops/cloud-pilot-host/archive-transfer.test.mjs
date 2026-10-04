import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {packArchiveTransfer,unpackArchiveTransfer} from './archive-transfer.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const body=Buffer.from(JSON.stringify({publicBusiness:'招聘职位数据'.repeat(1000)}));
test('compression restores the exact original archive bytes',()=>{
 const packed=packArchiveTransfer(body);assert.ok(packed.length<body.length/10);
 assert.deepEqual(unpackArchiveTransfer(packed,sha(body),body.length),body);
});
test('restoration accepts only the caller-bound original hash and size',()=>{
 const packed=packArchiveTransfer(body);
 assert.throws(()=>unpackArchiveTransfer(packed,'f'.repeat(64),body.length),/TRANSFER_ORIGINAL_BINDING/);
 assert.throws(()=>unpackArchiveTransfer(packed,sha(body),body.length+1),/TRANSFER_ORIGINAL_BINDING/);
});
test('truncated, altered, extra-field and noncanonical envelopes fail closed',()=>{
 const packed=packArchiveTransfer(body),v=JSON.parse(packed);
 assert.throws(()=>unpackArchiveTransfer(packed.subarray(0,packed.length-3),sha(body),body.length));
 for(const altered of [{...v,extra:'x'},{...v,chunks:[v.chunks[0]+'=',...v.chunks.slice(1)]},{...v,chunks:[v.chunks[0].slice(0,-4),...v.chunks.slice(1)]},{...v,byteCount:17*1024*1024}])assert.throws(()=>unpackArchiveTransfer(Buffer.from(JSON.stringify(altered)),sha(body),body.length));
});
test('an inflated payload cannot exceed the reviewed byte bound',()=>{
 const v=JSON.parse(packArchiveTransfer(body));v.byteCount=100;
 assert.throws(()=>unpackArchiveTransfer(Buffer.from(JSON.stringify(v)),sha(body),100));
});
