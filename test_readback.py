"""Small synthetic regression cases; no captured production rows or job IDs."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
HELPER = HERE / 'public-readback-exact-round.py'
spec = importlib.util.spec_from_file_location('readback', HELPER)
readback = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readback)
OBSERVED = '2026-01-01T01:00:00.123'


def fixture():
    summary = {'sourceId': 'source-test', 'sourceResultId': 'result-test',
               'batchId': 'batch-test', 'currentJobCount': 1,
               'state': 'COMMITTED_EXACT', 'batchFinishedAt': '2026-01-01T01:02:00Z'}
    row = {'id': 'result-test', 'sourceId': 'source-test', 'batchId': 'batch-test',
           'atomicCommitState': 'COMMITTED', 'completenessState': 'VERIFIED',
           'transportState': 'SUCCEEDED', 'adapterState': 'SUCCEEDED',
           'dedupeOutputCount': 1, 'completenessCertificate': {
               'companyId': 'company-test', 'schemaVersion': 'plan-bound-source-quality-v1'}}
    members = []
    for kind, entries in [('CURRENT', [('current-key', 'current-id', 0)]),
                          ('GRACE', [('grace-key', 'grace-id', 1)]),
                          ('VISIBLE', [('current-key', 'current-id', 0), ('grace-key', 'grace-id', 1)])]:
        for key, public_id, missing in entries:
            members.append({'setKind': kind, 'jobKey': key, 'publicJobId': public_id,
                            'missingCount': missing, 'jobKeySha256': hashlib.sha256(key.encode()).hexdigest()})
    proof = {'sourceResultId': 'result-test', 'members': members}
    rehash(row, proof)
    jobs = [{'id': public_id, 'companyId': 'company-test', 'sourceId': 'source-test',
             'sourceResultId': 'result-test', 'inGrace': grace}
            for public_id, grace in [('current-id', False), ('grace-id', True)]]
    coverage = {'id': 'company-test', 'state': 'PUBLISHING', 'health': 'HEALTHY',
                'lastSuccessAt': OBSERVED + 'Z'}
    return summary, row, jobs, coverage, proof


def rehash(row, proof):
    for kind, field in [('CURRENT', 'canonicalCurrentJobSetSha256'),
                        ('GRACE', 'canonicalGraceJobSetSha256'), ('VISIBLE', 'canonicalVisibleJobSetSha256')]:
        keys = sorted({m['jobKey'] for m in proof['members'] if m['setKind'] == kind}, key=lambda v: v.encode())
        row[field] = hashlib.sha256(json.dumps(keys, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


class ReadbackTests(unittest.TestCase):
    def status(self, data, observed=OBSERVED):
        d, row, jobs, coverage, proof = data
        return readback.public_status(d, row, jobs, coverage, observed, proof)

    def test_valid_current_and_grace_and_no_input_mutation(self):
        data = fixture()
        before = copy.deepcopy(data)
        self.assertEqual(self.status(data), (True, True, True, None))
        self.assertEqual(data, before)

    def test_utf8_order_compact_json_and_unique_values(self):
        # UTF-8 ordering puts U+E000 before U+1F600; default JS UTF-16 sort would not.
        values = ['😀', '\ue000', '中', 'a"\n', '😀']
        wire = '["a\\\"\\n","中","\ue000","😀"]'.encode('utf-8')
        self.assertEqual(readback.canonical_string_set_sha256(values), hashlib.sha256(wire).hexdigest())

    def test_public_binding_and_flags_fail_closed(self):
        for field, bad in [('id', 'unrelated-id'), ('sourceId', 'other-source'),
                           ('sourceResultId', 'old-result'), ('companyId', 'other-company'),
                           ('inGrace', 0), ('inGrace', 'false')]:
            with self.subTest(field=field, bad=bad):
                data = fixture()
                data[2][0][field] = bad
                self.assertFalse(self.status(data)[2])

    def test_swapped_grace_flags_and_duplicate_public_id_rejected(self):
        data = fixture()
        for job in data[2]:
            job['inGrace'] = not job['inGrace']
        self.assertFalse(self.status(data)[2])
        data = fixture()
        data[2][1]['id'] = data[2][0]['id']
        self.assertFalse(self.status(data)[2])

    def test_proof_and_finalized_bindings_rejected(self):
        cases = [(0, 'sourceResultId', 'old-result'), (0, 'sourceId', 'other-source'),
                 (0, 'batchId', 'other-batch'), (0, 'currentJobCount', 2),
                 (1, 'id', 'other-result'), (1, 'sourceId', 'other-source'),
                 (1, 'batchId', 'other-batch'), (1, 'atomicCommitState', 'PENDING'),
                 (1, 'completenessState', 'FAILED'), (1, 'dedupeOutputCount', 2),
                 (4, 'sourceResultId', 'old-result')]
        for index, field, bad in cases:
            with self.subTest(index=index, field=field):
                data = fixture()
                data[index][field] = bad
                self.assertFalse(self.status(data)[2])

    def test_missing_duplicate_or_tampered_members_rejected(self):
        for kind in ['CURRENT', 'GRACE', 'VISIBLE']:
            with self.subTest(kind=kind):
                data = fixture()
                data[4]['members'] = [m for m in data[4]['members'] if m['setKind'] != kind]
                self.assertFalse(self.status(data)[2])
        for field, value in [('jobKeySha256', '0' * 64), ('missingCount', 1),
                             ('missingCount', False), ('publicJobId', ''), ('setKind', 'UNKNOWN')]:
            with self.subTest(field=field, value=value):
                data = fixture()
                data[4]['members'][0][field] = value
                self.assertFalse(self.status(data)[2])
        data = fixture()
        data[4]['members'].append(copy.deepcopy(data[4]['members'][0]))
        self.assertFalse(self.status(data)[2])

    def test_each_canonical_hash_required(self):
        for kind in ['Current', 'Grace', 'Visible']:
            data = fixture()
            data[1]['canonical' + kind + 'JobSetSha256'] = '0' * 64
            self.assertFalse(self.status(data)[2])

    def test_optional_member_bindings_cannot_contradict_finalized_row(self):
        for field in ['sourceId', 'sourceResultId', 'batchId']:
            data = fixture()
            data[4]['members'][0][field] = 'other-binding'
            self.assertFalse(self.status(data)[2])

    def test_other_receipt_schemas_cannot_publish_grace(self):
        data = fixture()
        data[1]['completenessCertificate']['schemaVersion'] = 'not-source-quality'
        self.assertFalse(self.status(data)[2])

    def test_overlap_rejected_even_with_recomputed_hashes(self):
        data = fixture()
        for member in data[4]['members']:
            if member['setKind'] == 'GRACE':
                member['jobKey'] = 'current-key'
                member['jobKeySha256'] = hashlib.sha256(b'current-key').hexdigest()
        rehash(data[1], data[4])
        self.assertFalse(self.status(data)[2])

    def test_visible_union_id_mapping_and_missing_count_rejected(self):
        for field, bad in [('publicJobId', 'other-id'), ('missingCount', 1), ('jobKey', 'other-key')]:
            with self.subTest(field=field):
                data = fixture()
                member = next(m for m in data[4]['members'] if m['setKind'] == 'VISIBLE')
                member[field] = bad
                member['jobKeySha256'] = hashlib.sha256(member['jobKey'].encode()).hexdigest()
                rehash(data[1], data[4])
                self.assertFalse(self.status(data)[2])
        data = fixture()
        for member in data[4]['members']:
            if member['jobKey'] == 'grace-key':
                member['publicJobId'] = 'current-id'
        self.assertFalse(self.status(data)[2])

    def test_missing_public_member_rejected_despite_legacy_count(self):
        data = fixture()
        data[2].pop()
        self.assertFalse(self.status(data)[2])

    def test_proof_required_for_grace_and_original_no_grace_path(self):
        d, row, jobs, coverage, _ = fixture()
        self.assertFalse(readback.public_status(d, row, jobs, coverage, OBSERVED)[2])
        self.assertTrue(readback.public_status(d, row, jobs[:1], coverage, OBSERVED)[2])
        self.assertFalse(readback.public_status(d, row, [], coverage, OBSERVED)[2])
        self.assertFalse(readback.public_status(d, row, jobs[:1], coverage, OBSERVED, {})[2])
        self.assertFalse(readback.public_status(d, row, jobs[:1], coverage, OBSERVED, None)[2])

    def test_coverage_time_state_and_health_required(self):
        for field, bad in [('lastSuccessAt', '2026-01-01T01:02:00Z'),
                           ('state', 'HOLD'), ('health', 'DEGRADED')]:
            with self.subTest(field=field):
                data = fixture()
                data[3][field] = bad
                self.assertFalse(self.status(data)[2])
        self.assertFalse(self.status(fixture(), observed=None)[2])
        d, row, jobs, _, proof = fixture()
        self.assertFalse(readback.public_status(d, row, jobs, None, OBSERVED, proof)[2])

    def test_verify_only_cli_does_not_write_inputs_or_existing_summaries(self):
        with tempfile.TemporaryDirectory(prefix='synthetic-', dir=HERE) as temporary:
            base = Path(temporary)
            run = base / 'completed-run'
            public = base / 'readback'
            run.mkdir()
            public.mkdir()
            d, row, jobs, coverage, proof = fixture()
            files = {
                run / 'completion-summary.json': d,
                run / 'FINALIZED_BATCH_AND_RELEASE.json': [{'row': row}],
                run / 'POST_COMMIT_OBSERVATION.json': {'observation': {'crawledAt': OBSERVED}},
                run / 'PUBLIC_VISIBLE_MEMBER_EXPECTATION.json': proof,
                public / 'search.json': {'companies': [{'id': 'company-test', 'jobs': jobs}],
                                         'totalJobs': 2, 'lastUpdatedAt': OBSERVED + 'Z'},
                public / 'coverage.json': {'companies': [coverage]},
                public / 'search-metadata.json': {'status': 200, 'groupCompletedAt': '2026-01-01T02:00:00Z'},
                public / 'coverage-metadata.json': {'status': 200, 'groupCompletedAt': '2026-01-01T02:00:01Z'},
                public / 'summary.json': {'existing': 'must remain byte-identical'},
            }
            for path, payload in files.items():
                path.write_text(json.dumps(payload))
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files}
            result = subprocess.run([sys.executable, '-B', str(HELPER), str(public), '--verify-only',
                                     '--run-dir', str(run)], capture_output=True, text=True, check=True)
            report = json.loads(result.stdout)
            self.assertEqual(report['currentCompletedSources'], 1)
            self.assertEqual(report['exactNewBatchSources'], 1)
            self.assertTrue(report['sourceBatches'][0]['publicVerified'])
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in files})
            self.assertEqual({p for p in base.rglob('*') if p.is_file()}, set(files))


if __name__ == '__main__':
    unittest.main(verbosity=2)
