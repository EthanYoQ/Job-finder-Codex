"""Offline, read-only replay of saved real legacy rows through frozen readers."""
from pathlib import Path
from datetime import datetime, timezone
import ctypes
import ctypes.util
import errno
import hashlib
import json
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent
PRIOR = BASE / 'jb-node22-verification-20261006T1507Z'
INC = BASE / 'jb-workspace-recovery-20261006T1136Z/implementation/incremental-sync-20261006T1717Z'
NODE = PRIOR / 'runtime/node-v22.19.0-linux-x64/bin/node'
INPUT = BASE / 'jb-workspace-recovery-20261006T1136Z/implementation/legacy-snapshot-refresh-20261006T2058Z/SANOFI_CURRENT_EXPORT_WITH_EXISTING_TWO_COLUMNS.json'
EXPECTED_INPUT = '2582afaa1900a3223812d40e08cc2ffe6d5f73e82d33e8b1ede6c6e18759d0bf'
ROLES = {'a775': PRIOR / 'a775', 'web-main': INC / 'web-main', 'compatible-fallback': INC / 'compatible-fallback'}
ENV = {'PATH': str(NODE.parent) + ':/usr/bin:/bin', 'HOME': str(ROOT / 'task-home'),
       'TMPDIR': str(ROOT / 'tmp'), 'LANG': 'C.UTF-8', 'TZ': 'UTC',
       'NODE_OPTIONS': '--require ' + str(ROOT / 'no-network.cjs') + ' --require ' + str(ROOT / 'trace-loader-sockets.cjs'),
       'TSX_DISABLE_CACHE': '1'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest(value):
    return digest_bytes(canonical(value).encode())


def write(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def utc_ms(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def block_native_network():
    """Inherited kernel filter; no child may send through any socket or connect."""
    seccomp = ctypes.CDLL(ctypes.util.find_library('seccomp'), use_errno=True)
    libc = ctypes.CDLL(None, use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_SET_NO_NEW_PRIVS failed')
    context = seccomp.seccomp_init(0x7fff0000)
    if not context:
        raise RuntimeError('SECCOMP_INIT_FAILED')
    try:
        for name in ['socket', 'connect', 'sendto', 'sendmsg', 'sendmmsg', 'io_uring_setup']:
            number = seccomp.seccomp_syscall_resolve_name(name.encode())
            if number < 0 or seccomp.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError('SECCOMP_RULE_FAILED:' + name)
        if seccomp.seccomp_load(context) != 0:
            raise RuntimeError('SECCOMP_LOAD_FAILED')
    finally:
        seccomp.seccomp_release(context)


def differences(expected, actual, path='$'):
    if type(expected) is not type(actual):
        return [{'path': path, 'kind': 'TYPE', 'expected': expected, 'actual': actual}]
    if isinstance(expected, dict):
        result = []
        for key in sorted(set(expected) | set(actual)):
            next_path = path + '.' + key
            if key not in expected or key not in actual:
                result.append({'path': next_path, 'kind': 'KEY', 'expected': expected.get(key), 'actual': actual.get(key)})
            else:
                result += differences(expected[key], actual[key], next_path)
        return result
    if isinstance(expected, list):
        result = []
        if len(expected) != len(actual):
            result.append({'path': path, 'kind': 'LENGTH', 'expected': len(expected), 'actual': len(actual)})
        for index, (left, right) in enumerate(zip(expected, actual)):
            result += differences(left, right, f'{path}[{index}]')
        return result
    return [] if expected == actual else [{'path': path, 'kind': 'VALUE', 'expected': expected, 'actual': actual}]


def verify_after():
    before = json.loads((ROOT / 'BEFORE_INTEGRITY.json').read_text())
    result = {'inputUnchanged': digest_bytes(INPUT.read_bytes()) == EXPECTED_INPUT, 'candidates': {}}
    for role, recorded in before['candidates'].items():
        candidate = ROLES[role]
        changed = [f['path'] for f in recorded['frozenFiles'] + recorded['allSourceFiles']
                   if digest_bytes((candidate / f['path']).read_bytes()) != f['sha256']]
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=candidate, text=True).strip()
        status = subprocess.check_output(['git', 'status', '--short', '--untracked-files=no'], cwd=candidate, text=True)
        result['candidates'][role] = {'frozenFilesChecked': len(recorded['frozenFiles']),
            'allSourceFilesChecked': len(recorded['allSourceFiles']), 'changedFiles': changed,
            'headUnchanged': head == recorded['head'], 'trackedStatusUnchanged': status == recorded['trackedStatus']}
        require(not changed and head == recorded['head'] and status == recorded['trackedStatus'], role + ':SOURCE_CHANGED')
    require(result['inputUnchanged'], 'INPUT_CHANGED')
    write('AFTER_INTEGRITY.json', result)
    return result


def main():
    require(digest_bytes(INPUT.read_bytes()) == EXPECTED_INPUT, 'INPUT_HASH_MISMATCH')
    packet = json.loads(INPUT.read_text())
    probe_code = "import socket,errno;\ntry: socket.socket(socket.AF_INET,socket.SOCK_STREAM)\nexcept PermissionError as e: assert e.errno==errno.EPERM; print('KERNEL_SOCKET_DENIED')\nelse: raise AssertionError('NETWORK_GUARD_INACTIVE')"
    probe = subprocess.run(['/usr/bin/python3', '-c', probe_code], env=ENV, cwd=ROOT,
                           capture_output=True, text=True, timeout=10, preexec_fn=block_native_network)
    require(probe.returncode == 0 and probe.stdout.strip() == 'KERNEL_SOCKET_DENIED', 'KERNEL_GUARD_PROBE_FAILED')
    write('NETWORK_GUARD_PROBE.json', {'exitCode': probe.returncode, 'stdout': probe.stdout.strip(),
          'deniedSyscalls': ['socket', 'connect', 'sendto', 'sendmsg', 'sendmmsg', 'io_uring_setup'],
          'inheritedByAllReaderChildren': True, 'credentialsPassed': False})
    executions, payloads = [], {}
    for role, candidate in ROLES.items():
        output = ROOT / f'{role}-PRIVATE_COMPARISON.json'
        require(not output.exists(), 'REFUSE_REUSE_OUTPUT')
        args = [str(NODE), '--import', str(candidate / 'node_modules/tsx/dist/loader.mjs'),
                str(ROOT / 'compare-current-sanofi.mts'), str(candidate), str(INPUT), str(output)]
        started = time.monotonic()
        with (ROOT / 'logs' / f'{role}.log').open('x') as log:
            proc = subprocess.run(args, cwd=candidate, env=ENV, stdout=log, stderr=subprocess.STDOUT,
                                  timeout=30, preexec_fn=block_native_network)
        record = {'candidate': role, 'exitCode': proc.returncode, 'durationSeconds': round(time.monotonic() - started, 3),
                  'log': str(ROOT / 'logs' / f'{role}.log'), 'output': str(output), 'kernelNetworkGuard': True}
        executions.append(record)
        write('EXECUTIONS.json', executions)
        print(json.dumps(record), flush=True)
        if proc.returncode == 0 and output.is_file():
            payloads[role] = json.loads(output.read_text())
    require(set(payloads) == set(ROLES), 'REPLAY_FAILED_SEE_EXECUTIONS')
    old_input = PRIOR / 'SANOFI_CURRENT_READONLY_EXPORT_20261006T1553Z.json'
    require(digest_bytes(old_input.read_bytes()) == '5e0803fdeace10cbd454d9782842fb0e5887132ce51fe1dfc05951dd54259dbe', 'OLD_INPUT_CHANGED')
    old_packet = json.loads(old_input.read_text())['packet']
    old_snapshot, raw = old_packet['snapshot'], packet['snapshot']
    for key in ['results', 'members', 'artifacts']:
        require(old_snapshot[key] == raw[key], 'REFRESHED_EXISTING_' + key + '_CHANGED')
    require(old_snapshot['jobs'] == [{k: v for k, v in row.items() if k not in ['sourceJobId', 'listUrl']} for row in raw['jobs']], 'REFRESHED_EXISTING_JOB_FIELDS_CHANGED')
    require(all('sourceJobId' in job and 'listUrl' in job for job in raw['jobs']), 'NEW_FIELDS_MISSING')
    reference = payloads['a775']['projection']
    selected_id = reference['source']['selectedSourceResultId']
    selected = [row for row in raw['results'] if row['id'] == selected_id]
    require(len(selected) == 1, 'SELECTED_ROW_NOT_UNIQUE')
    accepted_at = utc_ms(selected[0]['finishedAt'])
    observed_at = utc_ms(selected[0]['completenessCertificate']['observedAt'])
    captured_at = utc_ms(packet['capturedAt'])
    input_ids = {job['id'] for job in raw['jobs']}
    require(len(raw['jobs']) == len(input_ids) == 88, 'INPUT_NOT_88_UNIQUE')
    old_file = PRIOR / 'CURRENT_SANOFI_a775_PRIVATE_COMPARISON.json'
    require(digest_bytes(old_file.read_bytes()) == 'd8854582d0f1b722a98c05456993af7830d35058999bd42caa4d57787208c371', 'STORED_BASELINE_CHANGED')
    old_a775 = json.loads(old_file.read_text())
    old_diff = differences(old_a775['projection'], reference)
    require(old_diff == [{'path': '$.generatedAt', 'kind': 'VALUE', 'expected': old_a775['projection']['generatedAt'], 'actual': captured_at}], 'NEW_A775_CHANGE_EXCEEDS_CAPTURE_TIME')
    require(all(digest_bytes((ROLES['a775'] / file).read_bytes()) == value for file, value in old_a775['originalSourceHashes'].items()), 'A775_SOURCE_CHANGED')
    comparisons, all_diffs = {}, {}
    for role, payload in payloads.items():
        projection = payload['projection']
        source, company = projection['source'], projection['company']
        jobs = source['jobs']
        diff = differences(reference, projection)
        all_diffs[role] = diff
        require(payload['inputSha256'] == EXPECTED_INPUT and payload['inputUnchanged'], role + ':INPUT_CHANGED')
        require(source['state'] == 'PUBLISHING' and source['visibleJobCount'] == projection['totalJobs'] == 88, role + ':VISIBILITY_CHANGED')
        require(len(jobs) == len({job['id'] for job in jobs}) == 88 and {job['id'] for job in jobs} == input_ids, role + ':JOB_SET_CHANGED')
        require(canonical(company['jobs']) == canonical(jobs), role + ':COMPANY_JOBS_DIFFER')
        require(source['selectedSourceResultId'] == selected_id, role + ':SELECTED_RECEIPT_CHANGED')
        require(source['lastAcceptedAt'] == source['visibilityFloor'] == accepted_at, role + ':ACCEPTED_TIME_CHANGED')
        require(source['lastSuccessAt'] == projection['lastUpdatedAt'] == observed_at, role + ':OBSERVATION_TIME_CHANGED')
        require(projection['generatedAt'] == payload['comparisonTime'] == captured_at, role + ':COMPARISON_TIME_CHANGED')
        require(all(job['sourceResultId'] == selected_id and job['lastSeenAt'] == accepted_at for job in jobs), role + ':JOB_TIME_CHANGED')
        require(payload['projectionSha256'] == digest(projection) and payload['jobsSha256'] == digest(jobs), role + ':DECLARED_HASH_INVALID')
        comparisons[role] = {'fullProjectionEqualToSameInputA775': not diff, 'differenceCount': len(diff),
            'uniqueJobCount': len(jobs), 'jobIdSetEqualToInput': True, 'projectionSha256': digest(projection),
            'jobsSha256': digest(jobs), 'state': source['state'], 'health': source['health'], 'freshness': source['freshness'],
            'originalTimesPreserved': True, 'transactions': payload['transactions'], 'trace': payload['trace'],
            'enumDeserialization': payload['enumDeserialization']}
    write('PRIVATE_FIELD_DIFFERENCES.json', {'sameInputComparison': all_diffs, 'oldToRefreshedA775Projection': old_diff})
    integrity = verify_after()
    summary = {'status': 'PASS' if not any(all_diffs.values()) else 'FAIL_PROJECTION_DIFF',
        'scope': 'Newly saved current Sanofi legacy snapshot only; neither missing historical fixture nor all-source production/migration/concurrency qualification',
        'inputSha256': EXPECTED_INPUT, 'inputBytes': INPUT.stat().st_size,
        'inputCounts': {'results': len(raw['results']), 'members': len(raw['members']), 'jobs': len(raw['jobs']), 'artifacts': len(raw['artifacts']), 'observations': sum(len(row['observations']) for row in raw['results'])},
        'capturedAt': packet['capturedAt'], 'comparisonTime': captured_at,
        'lastAcceptedAt': accepted_at, 'lastSuccessAt': observed_at, 'sameInputA775ProjectionSha256': digest(reference),
        'comparisons': comparisons, 'integrity': integrity, 'network': {'kernelGuardVerified': True,
        'noNetworkOrDatabaseRequestsPermitted': True, 'credentialsPassed': False},
        'harness': {'originalOrmDateAndEnumAdapterPreserved': True, 'onlyChanges': ['new input hash', 'top-level packet instead of envelope', 'owner read-only budget metadata stored separately']},
        'oldEvidence': {'oldInputUnchanged': True, 'oldFailureUnmodified': True, 'oldSnapshotExistingFieldsEqual': True,
            'newA775DiffersFromOldOnlyInGeneratedAt': True, 'difference': old_diff, 'oldProjectionSha256': old_a775['projectionSha256']},
        'noJobRowsInThisSummary': True}
    write('SAFE_SUMMARY.json', summary)
    print(json.dumps({'status': summary['status'], 'projectionSha256': digest(reference),
                      'differences': {role: len(diff) for role, diff in all_diffs.items()}, 'oldToNewA775Differences': old_diff}), flush=True)
    return 0 if summary['status'] == 'PASS' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        write('FAILURE.json', {'type': type(error).__name__, 'message': str(error)})
        verify_after()
        raise

