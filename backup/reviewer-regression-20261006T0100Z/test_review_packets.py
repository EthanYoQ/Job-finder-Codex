#!/usr/bin/env python3
"""Offline CLI regression: run the actual restoration recipe and reviewer on synthetic packets.

No SQL is executed. Packet files live only in a disposable temporary directory.
The accepted fixture exercises the reviewer contract, not production evidence admission.
"""
import copy, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
R2 = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent.parent
SELECTION = {key: f'source-{key}-china-social' for key in ['merck', 'gilead', 'organon']}
OLD_SOURCES = [f'source-{key}-china-social' for key in ['astellas', 'grifols', 'bms', 'biogen']]
CANDIDATE = 'dot-cloud-restored-fb0b8e3-20261005T2028Z'
PROJECT = 'yiopvxysxrtrnvqxwgbx'
EXPECTED_REVIEWERS = json.loads((HERE / 'CHANGE_RELATIONSHIP.json').read_text())['parentReviewedFixedReviewerSha256']
SHA = lambda data: hashlib.sha256(data).hexdigest()
ENV = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONOPTIMIZE': '', 'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1'}
RESULTS = []

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def synthetic_r2(root, recipe):
    """Execute the real recipe in an isolated tree; no production host path is writable here."""
    archive_rel = Path('code80-portable66-contracts/operations/external-host66')
    archive = R2 / archive_rel
    manifest = json.loads((archive / 'FILE_MANIFEST.json').read_text())
    for item in manifest:
        rel = Path(item['archivePath']).relative_to('operations/external-host66')
        original = archive / rel
        assert SHA(original.read_bytes()) == item['sha256'] and original.stat().st_size == item['byteCount']
        target = root / archive_rel / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    for name in ['FILE_MANIFEST.json', 'RESTORE_LIMITATIONS.json']:
        shutil.copyfile(archive / name, root / archive_rel / name)
    # This metadata is explicitly synthetic and can authorize no capture or database work.
    build = {'schemaVersion': 2, 'commitSha': 'f' * 40, 'sourceTreeSha256': 'a' * 64, 'runtimeTreeSha256': 'b' * 64, 'contentSha256': 'c' * 64}
    control = {'projectId': PROJECT, 'candidate': {'id': CANDIDATE, 'goalId': 'SYNTHETIC_ONLY', 'version': 46}, 'build': build, 'expiresAt': '2000-01-01T00:00:00Z'}
    verification = root / 'verification'
    dump(verification / 'candidate46-input.json', control)
    dump(verification / 'CANDIDATE46_REGISTERED.json', {'candidate': {'id': CANDIDATE, 'version': 46}})
    dump(verification / 'restored-build-identity.json', build)
    dump(root / 'PUBLISHER-ACTIVE-STATE.json', {'runtimeCandidate': {'id': CANDIDATE, 'version': 46, 'commit': build['commitSha'], 'sourceTreeSha256': build['sourceTreeSha256'], 'runtimeTreeSha256': build['runtimeTreeSha256']}, 'pendingReadOnlyTerminalSources': []})
    destination = verification / 'restore-portable66-next-host46.py'
    shutil.copyfile(recipe, destination)
    return destination

def fixture(source_id, config_sha, batch):
    row = {'id': batch + '--' + source_id, 'releaseCandidateId': CANDIDATE, 'sourceId': source_id, 'sourceConfigHash': config_sha, 'batchId': batch, 'startedAt': '2000-01-01T00:00:00Z', 'finishedAt': '2000-01-01T00:00:01Z', 'rawCount': 2, 'validCount': 2, 'dedupeOutputCount': 2, 'transportState': 'SUCCEEDED', 'adapterState': 'SUCCEEDED', 'completenessState': 'VERIFIED', 'atomicCommitState': 'COMMITTED', 'canonicalCurrentJobSetSha256': SHA(b'SYNTHETIC_ONLY_JOB_KEYS'), 'canonicalOutputSetSha256': SHA(b'SYNTHETIC_ONLY_JOB_KEYS')}
    cert = {'schemaVersion': 'plan-bound-source-quality-v1', 'policyId': 'PLAN_BOUND_SOURCE_QUALITY_V1', 'binding': {key: row[field] for key, field in [('sourceId', 'sourceId'), ('sourceResultId', 'id'), ('batchId', 'batchId'), ('releaseCandidateId', 'releaseCandidateId'), ('sourceConfigSha256', 'sourceConfigHash')]}, 'counts': {'rawCount': row['rawCount'], 'finalUniqueJobCount': row['dedupeOutputCount']}, 'output': {'canonicalJobKeySetSha256': row['canonicalCurrentJobSetSha256']}, 'acquisition': {'startedAt': row['startedAt'], 'finishedAt': row['finishedAt']}}
    row['completenessCertificate'] = cert
    row['completenessCertificateSha256'] = SHA(json.dumps(cert, sort_keys=True, separators=(',', ':')).encode())
    return {'cfg': {'sourceId': source_id, 'sourceConfigSha256': config_sha, 'project': PROJECT}, 'row': row, 'kind': 'PUBLISH', 'project': PROJECT, 'sqlSuffix': '', 'removeToken': None, 'archive': True, 'sqlMismatch': False, 'requestIdMismatch': False}

def sql_text(packet):
    literal = json.dumps(packet['row'], ensure_ascii=False, separators=(',', ':')).replace('\\', '\\\\').replace("'", "\\'")
    # Valid PL/pgSQL-shaped fixture with no mutating statement and no production data.
    # These tokens exercise the existing reviewer's atomic-finalization string guards.
    sql = "-- NON_QUALIFYING_SYNTHETIC_REVIEW_ONLY; NEVER DISPATCH\nDO $synthetic_review$\nDECLARE source_result_data jsonb := E'" + literal + "'::jsonb;\nBEGIN\n"
    sql += "IF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_COMMITTED_EXACT_SOURCE_REQUIRED'; END IF;\n"
    sql += "IF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_CURRENT_MEMBERS_DRIFT'; END IF;\n"
    sql += "SET CONSTRAINTS ALL IMMEDIATE;\nPERFORM 'portable-quality-sync-v1:released';\nEND;\n$synthetic_review$;\n"
    sql += packet['sqlSuffix']
    if packet['removeToken']:
        sql = sql.replace(packet['removeToken'], 'SYNTHETIC_REMOVED_TOKEN')
    return sql

def run_review(parent, reviewer, source_id, config_sha, name, mutation=None, accept=False):
    host = parent / name
    batch = 'NONQUAL-' + name
    run = host / batch
    relay = run / 'relay'
    relay.mkdir(parents=True)
    packet = fixture(source_id, config_sha, batch)
    if mutation:
        mutation(packet)
    request_id = str(uuid.uuid4())
    sql = sql_text(packet)
    request = {'schemaVersion': 1, 'requestId': str(uuid.uuid4()) if packet['requestIdMismatch'] else request_id, 'kind': packet['kind'], 'expiresAt': '2099-01-01T00:00:00Z', 'payload': {'projectId': packet['project'], 'sql': sql}}
    request['requestSha256'] = SHA(json.dumps(request, separators=(',', ':')).encode())
    dump(host / 'host-config.json', packet['cfg'])
    dump(relay / (request_id + '.request.json'), request)
    (relay / (request_id + '.request.json.sql')).write_text(sql + ('\n-- MISMATCH' if packet['sqlMismatch'] else ''))
    archive_bytes = b'{"purpose":"NON_QUALIFYING_SYNTHETIC_REVIEW_ONLY","artifacts":[]}\n'
    if packet['archive']:
        (run / 'artifacts').mkdir()
        (run / 'artifacts' / (batch + '.archive.json')).write_bytes(archive_bytes)
    completed = subprocess.run([sys.executable, '-B', str(reviewer), str(host), str(run), request_id], capture_output=True, text=True, env=ENV, timeout=15)
    output = run / 'publication-review.json'
    if accept:
        assert completed.returncode == 0, (source_id, name, completed.stderr)
        review = json.loads(output.read_text())
        assert review == json.loads(completed.stdout)
        assert review['sqlSha256'] == SHA(sql.encode()) and review['sqlBytes'] == len(sql.encode())
        assert review['sourceResult']['sourceId'] == source_id and review['sourceResult']['sourceConfigHash'] == config_sha
        assert review['archiveSha256'] == SHA(archive_bytes) and review['archiveBytes'] == len(archive_bytes)
        assert review['requestId'] == request_id and review['noDdlOrDelete'] and review['atomicFinalizationAndRelease']
    else:
        assert completed.returncode != 0 and not output.exists(), (source_id, name, 'unexpected acceptance', completed.stdout)
    RESULTS.append({'sourceId': source_id, 'case': name, 'expected': 'ACCEPT' if accept else 'REJECT', 'actualExit': completed.returncode, 'reviewFileCreated': output.exists(), 'passed': True})

def row_set(field, value):
    return lambda p: p['row'].__setitem__(field, value)

def nested_set(section, field, value):
    return lambda p: p['row']['completenessCertificate'][section].__setitem__(field, value)

def foreign_scope(other):
    def mutate(packet):
        replacement = fixture(other, packet['cfg']['sourceConfigSha256'], packet['row']['batchId'])
        packet.clear()
        packet.update(replacement)
    return mutate

started = datetime.datetime.now(datetime.timezone.utc).isoformat()
archive = R2 / 'code80-portable66-contracts/operations/external-host66'
recipe_path = HERE / 'payload/verification/restore-portable66-next-host46.py'
restoration_results = []
with tempfile.TemporaryDirectory(prefix='portable3-review-regression-') as temporary:
    root = Path(temporary)
    isolated = root / 'synthetic-r2'
    restored_recipe = synthetic_r2(isolated, recipe_path)
    for key, source_id in SELECTION.items():
        completed = subprocess.run([sys.executable, '-B', str(restored_recipe), key], capture_output=True, text=True, env=ENV, timeout=20)
        assert completed.returncode == 0, completed.stderr
        reviewer = isolated / 'hosts46' / key / 'runtime/review-publication.py'
        config = json.loads((isolated / 'hosts46' / key / 'host-config.json').read_text())
        assert SHA(reviewer.read_bytes()) == EXPECTED_REVIEWERS[key]
        assert reviewer.read_bytes() == (HERE / 'reviewer-bytes' / (key + '-after.py')).read_bytes()
        manifest = json.loads((isolated / 'hosts46' / key / 'RESTORATION_MANIFEST.json').read_text())
        assert manifest['templateFiles']['runtime/review-publication.py']['sha256'] == EXPECTED_REVIEWERS[key]
        assert manifest['templateFiles']['runtime/review-publication.py']['originalSha256'] == SHA((archive / 'host-runtime/review-portable-publication.py').read_bytes())
        restoration_results.append({'sourceId': source_id, 'recipeExecutedInSyntheticR2': True, 'reviewerSha256': SHA(reviewer.read_bytes()), 'matchesParentExactFixedBytes': True, 'generatedManifestMatches': True})
        parent = root / 'packets' / key
        run_review(parent, reviewer, source_id, config['sourceConfigSha256'], 'valid-own-source', accept=True)
        run_review(parent, HERE / 'reviewer-bytes' / (key + '-before.py'), source_id, config['sourceConfigSha256'], 'historical-reviewer-reproduces-own-source-rejection')
        for other in [*OLD_SOURCES, *(v for v in SELECTION.values() if v != source_id), 'source-unknown-china-social']:
            run_review(parent, reviewer, source_id, config['sourceConfigSha256'], 'foreign-scope-' + other, foreign_scope(other))
        cases = {
            'row-source-mismatch': row_set('sourceId', 'source-wrong-china-social'),
            'row-candidate-mismatch': row_set('releaseCandidateId', 'dot-cloud-restored-fb0b8e3-20261004'),
            'row-config-mismatch': row_set('sourceConfigHash', '0' * 64),
            'row-batch-mismatch': row_set('batchId', 'NONQUAL-WRONG'),
            'row-result-id-mismatch': row_set('id', 'NONQUAL-WRONG'),
            'transport-state-failed': row_set('transportState', 'FAILED'),
            'adapter-state-failed': row_set('adapterState', 'FAILED'),
            'completeness-unverified': row_set('completenessState', 'UNKNOWN'),
            'atomic-state-unknown': row_set('atomicCommitState', 'UNKNOWN'),
            'certificate-schema-mismatch': lambda p: p['row']['completenessCertificate'].__setitem__('schemaVersion', 'a-grade-official-total-v2'),
            'certificate-policy-mismatch': lambda p: p['row']['completenessCertificate'].__setitem__('policyId', 'WRONG_POLICY'),
            'count-raw-mismatch': nested_set('counts', 'rawCount', 99),
            'count-dedupe-mismatch': nested_set('counts', 'finalUniqueJobCount', 99),
            'hash-certificate-output-mismatch': nested_set('output', 'canonicalJobKeySetSha256', '0' * 64),
            'hash-current-set-mismatch': row_set('canonicalCurrentJobSetSha256', '0' * 64),
            'hash-output-set-mismatch': row_set('canonicalOutputSetSha256', '0' * 64),
            'project-mismatch': lambda p: p.__setitem__('project', 'SYNTHETIC_WRONG_PROJECT'),
            'kind-mismatch': lambda p: p.__setitem__('kind', 'READ_CONTEXT'),
            'request-id-mismatch': lambda p: p.__setitem__('requestIdMismatch', True),
            'sql-file-payload-mismatch': lambda p: p.__setitem__('sqlMismatch', True),
            'archive-missing': lambda p: p.__setitem__('archive', False),
            'unapproved-table': lambda p: p.__setitem__('sqlSuffix', 'UPDATE public."SyntheticUnapprovedTable" SET id = id;\n'),
        }
        for field in ['sourceId', 'sourceResultId', 'batchId', 'releaseCandidateId', 'sourceConfigSha256']:
            cases['certificate-binding-' + field] = nested_set('binding', field, 'SYNTHETIC_WRONG_BINDING')
        for operation in ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'DELETE']:
            cases['forbidden-statement-' + operation.lower()] = lambda p, op=operation: p.__setitem__('sqlSuffix', op + ' TABLE synthetic_fixture;\n')
        for index, token in enumerate(['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED', 'PILOT_CURRENT_MEMBERS_DRIFT', 'SET CONSTRAINTS ALL IMMEDIATE', 'portable-quality-sync-v1:released']):
            cases['missing-finalization-token-' + str(index)] = lambda p, token=token: p.__setitem__('removeToken', token)
        for name, mutation in cases.items():
            run_review(parent, reviewer, source_id, config['sourceConfigSha256'], name, mutation)

report = {'schemaVersion': 1, 'startedAt': started, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'REAL_RESTORATION_RECIPE_AND_REAL_REVIEWER_CLI_ON_SYNTHETIC_PACKETS', 'passed': True, 'totalCases': len(RESULTS), 'acceptedCases': sum(r['expected'] == 'ACCEPT' for r in RESULTS), 'rejectedCases': sum(r['expected'] == 'REJECT' for r in RESULTS), 'allTemporaryPacketsRemoved': True, 'sourceNetworkAccessed': False, 'databaseAccessed': False, 'sqlExecuted': False, 'producerLaunched': False, 'activeHostsModified': False, 'originalRecipeModified': False, 'recipeSha256': SHA(recipe_path.read_bytes()), 'originalArchiveManifestSha256': SHA((archive / 'FILE_MANIFEST.json').read_bytes()), 'restorationResults': restoration_results, 'cases': RESULTS, 'limits': ['Synthetic reviewer-contract fixtures are not compiler-issued production packets or source-quality evidence; no real source content is included.', 'The original 27 scope-only cases remain a separate prior result and are not counted here.', 'Only the source allowlist adaptation changes. Existing reviewer checks, original launch command, timings, heap, SQL compiler and publication semantics are unchanged.']}
dump(HERE / 'TEST_RESULTS.json', report)
print(json.dumps({key: report[key] for key in ['passed', 'totalCases', 'acceptedCases', 'rejectedCases', 'sqlExecuted', 'activeHostsModified']}))
