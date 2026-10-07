// Pure synthetic regression: contains no captured source data or runtime identities.
import assert from 'node:assert/strict';
import test from 'node:test';
import {compileAtomicJsonDeclarations} from '../../producer/src/db/atomicJsonDeclarations.ts';
import {decodeDeclarations} from '../../hosts/servier/host/runtime/review-packet-envelope.mts';
const value="Synthetic shared subtree '. \\\" \n "+'x'.repeat(180);
const terminal={nested:{plain:1,shared:value}},context={nested:{shared:value,plain:1}};
const source=compileAtomicJsonDeclarations(terminal,context);
test('different original insertion order yields valid native declarations that are not idempotent after flattening',()=>{assert.throws(()=>decodeDeclarations(source),/HOST_JSON_COMPILER_ROUNDTRIP/);});
test('original context retains meaning and native compiler recreates every declaration byte',()=>{const decoded=decodeDeclarations(source,{context});assert.deepEqual(decoded.context,context);assert.equal(compileAtomicJsonDeclarations(decoded.terminal,decoded.context),source);});
test('semantically equal reordered context still fails the unchanged full byte gate',()=>{assert.throws(()=>decodeDeclarations(source,{context:{nested:{plain:1,shared:value}}}),/HOST_JSON_COMPILER_ROUNDTRIP/);});
test('changed context value fails independently before byte regeneration',()=>{assert.throws(()=>decodeDeclarations(source,{context:{nested:{shared:value,plain:2}}}),/HOST_CONTEXT_ORIGIN_SEMANTIC_MISMATCH/);});
test('single-byte declaration whitespace is not normalized away',()=>{assert.throws(()=>decodeDeclarations(source.replace(' jsonb := ','  jsonb := '),{context}),/HOST_JSON_DECLARATION/);});
test('legacy directly reversible declarations preserve the original no-origin path',()=>{const s=compileAtomicJsonDeclarations({x:1},{y:2});assert.deepEqual(decodeDeclarations(s),{terminal:{x:1},context:{y:2}});});
