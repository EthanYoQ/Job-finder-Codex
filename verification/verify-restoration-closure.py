#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,re
N=Path(__file__).resolve().parent.parent;V=N/'verification';a=json.loads((V/'SAFE_SOURCE_ALLOWLIST.json').read_text());m=json.loads((V/'SAFE_SOURCE_FILE_MANIFEST.json').read_text());safe=set(a['safeFiles'])
for rec in m:
 p=N/rec['path'];assert p.is_file() and not p.is_symlink();assert hashlib.sha256(p.read_bytes()).hexdigest()==rec['sha256'];assert p.stat().st_size==rec['bytes']
for source,target in a['restoreMappings'].items():assert source in safe and target in a['privateBindingFiles']
H=N/'hosts/novartis-next/host';binder=(H/'runtime/prepare-owner-binding.mts').read_text()
assert "join(host,'runtime/load-host-state.unbound.template.js')" in binder
assert "join(base,'supervision/start-monitor-novartis-next-combined.unbound.template.js')" in binder
assert "join(host,'runtime/load-host-state.js')" not in binder
assert "join(base,'supervision/start-monitor-novartis-next-combined.js')" not in binder
for name in ['runtime/load-host-state.unbound.template.js','../supervision/start-monitor-novartis-next-combined.unbound.template.js']:
 assert 'const expectedCandidate=null; // OWNER_CANDIDATE_BINDING' in (H/name).read_text()
assert 'const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING' in (H/'runtime/load-host-state.unbound.template.js').read_text()
for path in ['hosts/novartis-next/host/control-base.template.json','hosts/novartis-next/host/activation.unbound.template.json','hosts/novartis-next/host/owner-binding-input.template.json']:
 t=json.loads((N/path).read_text());assert t['candidate'] is None and t['databaseIdentity'] is None
assert json.loads((N/'owner/baseline-manifest.template.json').read_text())['expectedCandidate'] is None
assert 'const expectedCandidate = null; // OWNER_CANDIDATE_BINDING' in (N/'owner/publish-and-monitor-owner.template.js').read_text()
assert not any('registration' in Path(p).parts or any(part.startswith(('run-','owner-run-','recovery-run-')) for part in Path(p).parts[:-1]) for p in safe)
# Every test code and fixed fixture dependency is explicitly included; run outputs are excluded.
for rel in ['owner/tests/owner.test.mjs','owner/tests/run-owner-tests.sh','owner/tests/real-apply-patch-terminal-fixture.json','owner/tests/original-22-case-names.json','host-gate-tests/verify-owner-gates.mts','host-gate-tests/verify-starter-gates.mjs','host-gate-tests/verify-completion-gates.mjs','host-gate-tests/verify-binder-restoration.mts','host-gate-tests/verify-supervisor-launch-boundary.mjs','host-gate-tests/fixtures/real-supervisor-exit42-exec-result.json','host-gate-tests/run-offline.sh']:assert rel in safe
print(json.dumps({'safeFilesVerified':len(m),'restoreMappingsVerified':len(a['restoreMappings']),'candidateAndDatabaseRemainUnbound':True,'binderReadsImmutableTemplates':True,'codeAndFixtureClosureVerified':True,'registrationAuthority':False}))
