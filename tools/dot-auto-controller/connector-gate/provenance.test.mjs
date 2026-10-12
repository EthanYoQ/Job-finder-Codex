import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json')));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{encoding:'utf8',maxBuffer:4*1024*1024}));
test('new connector gate files never inherit historical source origin',()=>{
 const entries=exported.entries.filter(f=>f.path.startsWith('tools/dot-auto-controller/connector-gate/'));
 assert(entries.length>0);
 for(const entry of entries)assert.deepEqual(entry.provenance,{kind:'new-connector-publication-review-source'});
});
test('compiler derivative retains exact original hash and explicit derivative base',()=>{
 const source=manifest.files.find(f=>f.path==='src/db/ingestionRepository.ts');
 const entry=exported.entries.find(f=>f.path==='tools/dot-auto-controller/vendor/c60-source/src/db/ingestionRepository.ts');
 assert.equal(source.classification,'CONNECTOR_PUBLICATION_REVIEW_DERIVATIVE');
 assert.equal(source.originSha256,'56a16ca89ae417c1613cb37f7beb53db82dbc55f181219c6db7f48b7e487223b');
 assert.equal(source.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');
 assert.equal(entry.provenance.kind,'connector-publication-review-derivative');
 assert.equal(entry.provenance.derivativeBaseCommit,source.derivativeBaseCommit);
 assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
});

test('integrated original worker derivatives preserve exact base hashes',()=>{
 const before={"src/crawler/cloudSourcePilotRelay.ts": "06a0a626947365e241ae9d7de02e11f21496da21f4d3d8d497a6b6739f7823e6", "src/crawler/cloudDbStartedPilot.ts": "42d9f7df49559f1f969aba6296c7d6c9bab226d73fb9186ed6f86f87d54cb6b3", "scripts/p0-cloud-portable-source-pilot.ts": "a62a002c67716551ed23af7263b08a3d2d6486efcf31d9b4889b7042731fe98f"};
 for(const [relative,hash] of Object.entries(before)){const source=manifest.files.find(f=>f.path===relative),entry=exported.entries.find(f=>f.path==='tools/dot-auto-controller/vendor/c60-source/'+relative);assert.equal(source.classification,'CONNECTOR_PUBLICATION_REVIEW_DERIVATIVE');assert.equal(source.originSha256,hash);assert.equal(source.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');assert.equal(entry.provenance.kind,'connector-publication-review-derivative');assert.equal(entry.sha256,source.sha256);}
});
