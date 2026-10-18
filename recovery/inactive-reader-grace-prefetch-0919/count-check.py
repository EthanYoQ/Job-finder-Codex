from pathlib import Path
import shutil,subprocess,json
b=Path(__file__).resolve().parent
old=b.parent/'inactive-reader-three-clones-20261018T0620Z/candidate'
for name,source in [('count-old',old),('count-new',b/'candidate')]:
 target=b/name
 shutil.copytree(source/'src',target/'src',dirs_exist_ok=True)
 if not (target/'node_modules').exists():(target/'node_modules').symlink_to((source/'node_modules').resolve(),target_is_directory=True)
 shutil.copy2(source/'package.json',target/'package.json')
 p=target/'src/domain/jobProjectionDeltaReceipt.ts';s=p.read_text();needle='export function parseJobProjectionDeltaReceipt(value: unknown, expectedSha256?: string): JobProjectionDeltaReceipt {'
 assert s.count(needle)==1
 p.write_text(s.replace(needle,needle+'\n  (globalThis as any).__deltaParseCalls = ((globalThis as any).__deltaParseCalls ?? 0) + 1;'))
s=(b/'check.mjs').read_text().replace('../inactive-reader-three-clones-20261018T0620Z/candidate/src/db/portablePublicSnapshotRepository.ts','./count-old/src/db/portablePublicSnapshotRepository.ts').replace('./candidate/src/db/portablePublicSnapshotRepository.ts','./count-new/src/db/portablePublicSnapshotRepository.ts')
s=s.replace('const output=await read(db,','globalThis.__deltaParseCalls=0; const output=await read(db,').replace('return{output,queries};','return{output,queries,parseCalls:globalThis.__deltaParseCalls};')
s=s.replace('if(!bad)assert.deepEqual(fresh.queries,old.queries);','if(!bad)assert.deepEqual(fresh.queries,old.queries);assert.equal(old.parseCalls-fresh.parseCalls,1);')
s=s.replace('queriedMemberResults:ids.length,','oldParseCalls:old.parseCalls,newParseCalls:fresh.parseCalls,queriedMemberResults:ids.length,')
s=s.replace('assert.deepEqual(a,b);', 'assert.deepEqual(a.output,b.output);assert.deepEqual(a.queries,b.queries);assert.equal(a.parseCalls-b.parseCalls,1);').replace("name:'original-novo-before',", "name:'original-novo-before',oldParseCalls:a.parseCalls,newParseCalls:b.parseCalls,")
(b/'count-check.mjs').write_text(s)
r=subprocess.run([str(b.parent/'connector-host-runtime/node'),'--import',str(b.parent/'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/tsx/dist/loader.mjs'),'count-check.mjs'],cwd=b,capture_output=True,text=True)
print(r.stdout);print(r.stderr if r.returncode else '')
assert r.returncode==0
(b/'count-check-result.json').write_text(r.stdout)
