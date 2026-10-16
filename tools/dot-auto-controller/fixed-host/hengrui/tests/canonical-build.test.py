from pathlib import Path
import hashlib,importlib.util,json,os,tempfile
from contextlib import nullcontext
F=Path(__file__).resolve().parents[1];D=F;P=F/'build-functions-entry.py'
spec=importlib.util.spec_from_file_location('canonical',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
live_root_existed_before=m.LIVE_ROOT.exists()
reports=[]
def test(name,fn):
 fn();reports.append({'name':name,'passed':True})
def need(ok):
 if not ok:raise RuntimeError('TEST_ASSERT')
def reject(fn):
 try:fn()
 except Exception:return
 raise RuntimeError('TEST_EXPECTED_REJECTION')
sources=m.load_source_inputs();result=m.render_entry(sources)
test('canonical-default-regenerates-exact',lambda:need(result==(F/'functions-entry.js').read_bytes()))
test('default-disabled-no-future-identity',lambda:need(b'"enabled":false' in result and b'UNQUALIFIED' in result and b'0000000000000000000000000000000000000000000000000000000000000000' in result))
test('fixed-live-root-not-v4-fixture-root',lambda:need(str(m.LIVE_ROOT).encode() in result and b'fixed-functions-host-v4-' not in result))
test('no-local-evidence-or-fixture-file-dependency',lambda:need(b'evidence/dependency-pins' not in P.read_bytes() and b'test-only-data.json' not in P.read_bytes()))
test('source-pin-set-closed',lambda:need(set(sources)==set(m.DEPENDENCIES+m.OWN_INPUTS)))
test('candidate-period-original-positive',lambda:need(bool(m.CANDIDATE_ID.fullmatch('candidate.release-1_2'))))
for bad in ['-bad','_bad','.bad','a'*129,"a' OR TRUE"]:
 test('candidate-original-negative-'+str(len(reports)),lambda bad=bad:need(not m.CANDIDATE_ID.fullmatch(bad)))
test('candidate-original-length128',lambda:need(bool(m.CANDIDATE_ID.fullmatch('a'*128))))
test('same-original-outcome-compiler-sha',lambda:need(m.sha(m.compile_original_read_outcome(sources[m.DEPENDENCIES[3]].decode()).encode())=='9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442'))
test('outcome-compiler-tamper-rejected',lambda:reject(lambda:m.compile_original_read_outcome(sources[m.DEPENDENCIES[3]].decode().replace('SELECT','SELECT /* changed */'))))
# Original core generator validates known input/output hashes before composition.
bad=dict(sources);bad[m.DEPENDENCIES[0]]+=b'\n'
test('pipe-source-tamper-rejected',lambda:reject(lambda:m.render_entry(bad)))
bad2=dict(sources);bad2['fixed-host/hengrui/fixed-preimport-launch.py.in']+=b'\n'
test('cli-template-tamper-rejected',lambda:reject(lambda:m.render_entry(bad2)))
bad3=dict(sources);bad3['fixed-host/hengrui/body.template.js']=bad3['fixed-host/hengrui/body.template.js'].replace(m.ROOT_TOKEN.encode(),b'caller/path')
test('body-root-template-required',lambda:reject(lambda:m.render_entry(bad3)))
test('test-deployment-is-not-live',lambda:reject(lambda:m.render_entry(sources,{'kind':'TEST_ONLY_UNREGISTERED'},'a'*64)))
test('arbitrary-default-selector-rejected',lambda:reject(lambda:m.render_entry(sources,None,'a'*64)))
evidence=Path(os.environ.get('HENGRUI_PROFILE_TEST_EVIDENCE','/tmp/hengrui-fixed-profile-tests')).resolve()
assert not evidence.is_relative_to(m.PACKAGE.parents[1])
evidence.mkdir(parents=True,exist_ok=True)
with nullcontext(tempfile.mkdtemp(prefix='canonical-file-tests-',dir=evidence)) as raw:
 root=Path(raw);out=root/'out';out.mkdir();good=out/'artifact.js';m.write_exclusive(good,b'abc')
 test('fixed-wx-source-writer',lambda:need(good.read_bytes()==b'abc'))
 test('existing-artifact-no-overwrite',lambda:reject(lambda:m.write_exclusive(good,b'changed')))
 test('existing-artifact-preserved',lambda:need(good.read_bytes()==b'abc'))
 link=root/'candidate';link.symlink_to(out,target_is_directory=True)
 test('parent-symlink-write-rejected',lambda:reject(lambda:m.write_exclusive(link/'not-created.js',b'x')))
 test('parent-symlink-zero-write',lambda:need(not (out/'not-created.js').exists()))
 leaf=out/'linked.js';leaf.symlink_to(good)
 test('leaf-symlink-write-rejected',lambda:reject(lambda:m.write_exclusive(leaf,b'x')))
 test('relative-output-rejected',lambda:reject(lambda:m.write_exclusive(Path('relative.js'),b'x')))
 test('read-symlink-rejected',lambda:reject(lambda:m.read_regular(leaf)))
 hard=out/'hard';os.link(good,hard)
 test('read-multiple-hardlink-rejected',lambda:reject(lambda:m.read_regular(good)))
# No mutation of LIVE root is performed by this test suite.
need(m.LIVE_ROOT.exists()==live_root_existed_before)
out={'schemaVersion':1,'kind':'CANONICAL_SOURCE_BUILD_UNIT_TESTS','passed':True,'cases':len(reports),'sourceSha256':m.sha(P.read_bytes()),'defaultEntrySha256':m.sha(result),'liveRootCreated':False,'productionCalls':0,'tests':reports}
print(json.dumps(out,indent=2))
