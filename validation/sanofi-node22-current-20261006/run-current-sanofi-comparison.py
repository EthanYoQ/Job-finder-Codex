from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import sys

from replay_tool_support import exit_status, new_run, preserve_report, run_child, write_json

CANDIDATES = ['a775', 'main', 'fallback']
INPUT_NAME = 'SANOFI_CURRENT_READONLY_EXPORT_20261006T1553Z.json'
SOURCE = 'source-sanofi-china-social'
COMPANY = 'company-sanofi-china'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def utc_milliseconds(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def validate_comparisons(payloads, packet, input_sha):
    """Accept actual objects, never equality of child-reported hashes alone."""
    require(set(payloads) == set(CANDIDATES), 'MISSING_CANDIDATE_COMPARISON')
    require(packet['exportStatus'] == 'COMPLETE_SINGLE_SOURCE_EXPORT' and packet['sourceId'] == SOURCE
            and packet['isHistoricalFixture'] is False, 'INVALID_CURRENT_EXPORT_SCOPE')
    raw = packet['snapshot']
    expected_ids = {job['id'] for job in raw['jobs']}
    require(len(raw['jobs']) == len(expected_ids) == 88, 'CURRENT_INPUT_NOT_88_UNIQUE_JOBS')
    reference = payloads['a775']['projection']
    selected_id = reference['source']['selectedSourceResultId']
    selected_rows = [row for row in raw['results'] if row['id'] == selected_id and row['sourceId'] == SOURCE]
    require(len(selected_rows) == 1, 'SELECTED_RECEIPT_NOT_IN_CURRENT_INPUT')
    selected = selected_rows[0]
    # This replay contract is the fixed current historical-A snapshot, not a future B cutover.
    observed = selected['completenessCertificate'].get('observedAt')
    require(isinstance(observed, str), 'CURRENT_A_OBSERVATION_TIME_REQUIRED')
    accepted_at = utc_milliseconds(selected['finishedAt'])
    observed_at = utc_milliseconds(observed)
    comparison_time = utc_milliseconds(packet['capturedAt'])
    for candidate in CANDIDATES:
        result = payloads[candidate]
        projection = result['projection']
        source, company = projection['source'], projection['company']
        require(result['inputSha256'] == input_sha and result['inputUnchanged'] is True, f'{candidate}:INPUT_IDENTITY_MISMATCH')
        require(result['capturedAt'] == packet['capturedAt'] and result['comparisonTime'] == comparison_time,
                f'{candidate}:CAPTURE_TIME_MISMATCH')
        require(source['sourceId'] == SOURCE and source['companyId'] == COMPANY and company['id'] == COMPANY,
                f'{candidate}:SOURCE_SCOPE_MISMATCH')
        require(source['state'] == 'PUBLISHING' and result['state'] == 'PUBLISHING', f'{candidate}:NOT_PUBLISHING')
        jobs = source['jobs']
        ids = [job['id'] for job in jobs]
        require(len(ids) == len(set(ids)) == 88 and set(ids) == expected_ids, f'{candidate}:JOB_ID_SET_MISMATCH')
        require(source['visibleJobCount'] == result['visibleJobCount'] == projection['totalJobs'] == 88,
                f'{candidate}:VISIBLE_COUNT_MISMATCH')
        require(canonical(company['jobs']) == canonical(jobs), f'{candidate}:COMPANY_JOB_FIELDS_MISMATCH')
        require(source['selectedSourceResultId'] == selected_id, f'{candidate}:SELECTED_RECEIPT_CHANGED')
        expected_times = {'lastAcceptedAt': accepted_at, 'visibilityFloor': accepted_at, 'lastSuccessAt': observed_at}
        for key, expected in expected_times.items():
            require(source[key] == expected and result[key] == expected, f'{candidate}:ORIGINAL_SOURCE_TIME_CHANGED:{key}')
        require(projection['lastUpdatedAt'] == result['lastUpdatedAt'] == observed_at,
                f'{candidate}:ORIGINAL_UPDATE_TIME_CHANGED')
        require(projection['generatedAt'] == comparison_time, f'{candidate}:COMPARISON_TIME_CHANGED')
        require(all(job['sourceResultId'] == selected_id and job['lastSeenAt'] == accepted_at for job in jobs),
                f'{candidate}:JOB_SOURCE_TIME_CHANGED')
        require(result['jobsSha256'] == digest(jobs) and result['projectionSha256'] == digest(projection),
                f'{candidate}:DECLARED_HASH_MISMATCH')
        require(canonical(projection) == canonical(reference), f'{candidate}:FULL_PROJECTION_FIELDS_DIFFER')
    return {'status': 'PASS', 'sourceId': SOURCE, 'uniqueJobs': 88, 'completeProjectionEqual': True,
            'originalSourceTimesPreserved': True, 'projectionSha256': digest(reference), 'inputSha256': input_sha}


def main(root=None, runner=subprocess.run):
    root = Path(root or Path(__file__).resolve().parent)
    run_dir = new_run(root, 'current-sanofi')
    execution_path = root / 'CURRENT_SANOFI_EXECUTION_RESULTS.json'
    acceptance_path = root / 'CURRENT_SANOFI_AUTOMATED_ACCEPTANCE.json'
    for path in [execution_path, acceptance_path]:
        preserve_report(path, run_dir)
    results = []
    write_json(execution_path, results)
    write_json(acceptance_path, {'status': 'IN_PROGRESS', 'runDirectory': str(run_dir)})
    try:
        input_bytes = (root / INPUT_NAME).read_bytes()
        input_sha = hashlib.sha256(input_bytes).hexdigest()
        expected_sha = json.loads((root / 'RUNTIME_REQUIREMENTS.json').read_text())['privateInputSha256']
        require(input_sha == expected_sha, 'PINNED_CURRENT_INPUT_HASH_MISMATCH')
        packet = json.loads(input_bytes)['packet']
        node = root / 'runtime/node-v22.19.0-linux-x64/bin/node'
        env = {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(root / 'task-home'),
               'TMPDIR': str(root / 'tmp'), 'LANG': 'C.UTF-8', 'TZ': 'UTC',
               'NODE_OPTIONS': '--require ' + str(root / 'no-network.cjs') + ' --require ' + str(root / 'trace-loader-sockets.cjs')}
        outputs = {}
        for candidate in CANDIDATES:
            # Fresh per-run paths prevent an old successful projection from masking a failed child.
            outputs[candidate] = run_dir / f'CURRENT_SANOFI_{candidate}_PRIVATE_COMPARISON.json'
            args = [str(node), '--import', str(root / candidate / 'node_modules/tsx/dist/loader.mjs'),
                    str(root / 'compare-current-sanofi.mts'), str(root / candidate), str(root / INPUT_NAME), str(outputs[candidate])]
            result = run_child(args, cwd=root / candidate, env=env, log=run_dir / f'{candidate}.log', timeout=30, runner=runner)
            result.update(candidate=candidate, output=str(outputs[candidate]))
            results.append(result)
            write_json(execution_path, results)
        if exit_status(results):
            write_json(acceptance_path, {'status': 'FAILED_CHILD', 'runDirectory': str(run_dir), 'results': results})
            return 1
        require(hashlib.sha256((root / INPUT_NAME).read_bytes()).hexdigest() == input_sha, 'CURRENT_INPUT_CHANGED_DURING_RUN')
        payloads = {candidate: json.loads(path.read_text()) for candidate, path in outputs.items()}
        acceptance = validate_comparisons(payloads, packet, input_sha)
        acceptance['runDirectory'] = str(run_dir)
        write_json(acceptance_path, acceptance)
        return 0
    except Exception as error:
        write_json(acceptance_path, {'status': 'FAILED_VALIDATION', 'error': type(error).__name__,
                                    'message': str(error), 'runDirectory': str(run_dir)})
        return 1


if __name__ == '__main__':
    sys.exit(main())
