#!/usr/bin/env python3
"""Reviewed-data importer. No source checkout or source-code execution.
DRAFT: publication requires a sealed spec, real bundle review, and independent review.
This module's unit tests never create bundles, import Git objects, or contact GitHub.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

REPOSITORY = 'EthanYoQ/Job-finder-Codex'
REPOSITORY_ID = 1392742590
OWNER_ID = 257484394
BASE_BRANCH = 'human-verified-code'
BASE = '24ff0e1dc8d2755c99116fe53b41a36978705cd6'
BASE_TREE = 'e473b150bf7e42a354bbf9916dd094e412025a40'
SOURCE = '9abc94393f96948a51119ef96f3a2143765f1350'
SOURCE_TREE = 'c2de6ac000fab0dd45c16f4f1fc40d7dbfb818d6'
SOURCE_PARENT = '9721cb0f77313924692877952ad8d635a38f60ab'
INVENTORY = '317017300bcac505422716efad467e606b4da5adc6f7cfa7b5e646c43d4803b2'
BOOTSTRAP = 'tmp/genuine-import-9abc943-20261016'
DESTINATION = 'recovery/genuine-source-9abc943-20261016'
WORKFLOW_PATH = '.github/workflows/temporary-genuine-import-9abc943.yml'
MAX_BUNDLE_BYTES = 8 * 1024 * 1024
# These are hard limits, not a claim that the real bundle is already measured.
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
CHUNK = re.compile(r'chunks/[0-9]{6}\.bin\Z')


def require(test, message):
    if not test:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_spec(spec, now=None):
    expected = {'repository': REPOSITORY, 'repository_id': REPOSITORY_ID,
                'base_branch': BASE_BRANCH, 'base_commit': BASE, 'base_tree': BASE_TREE,
                'source_commit': SOURCE, 'source_tree': SOURCE_TREE,
                'source_parent': SOURCE_PARENT, 'object_inventory_sha256': INVENTORY,
                'object_count': 2326, 'bootstrap_branch': BOOTSTRAP,
                'destination_branch': DESTINATION, 'workflow_path': WORKFLOW_PATH}
    for key, value in expected.items():
        require(spec.get(key) == value, 'SPEC_BINDING_MISMATCH:' + key)
    require(spec.get('status') == 'INDEPENDENTLY_REVIEWED_READY', 'SPEC_NOT_REVIEWED_READY')
    require(HEX64.fullmatch(spec.get('bundle_sha256') or ''), 'BUNDLE_SHA256_UNSET')
    require(type(spec.get('bundle_bytes')) is int and 0 < spec['bundle_bytes'] <= MAX_BUNDLE_BYTES,
            'BUNDLE_SIZE_UNSET_OR_OUT_OF_BOUNDS')
    require(spec.get('bundle_reference') == 'HEAD', 'BUNDLE_REFERENCE_NOT_HEAD')
    require(spec.get('full_history_content_review') == 'APPROVED_FOR_THIS_PRIVATE_REPOSITORY',
            'HISTORY_CONTENT_REVIEW_MISSING')
    require(spec.get('creation_lease_review') == 'EMPTY_EXPECTATION_CREATE_ONLY_APPROVED',
            'CREATE_ONLY_LEASE_NOT_REVIEWED')
    deadline = dt.datetime.fromisoformat(spec['expires_at'].replace('Z', '+00:00'))
    require(deadline.utcoffset() == dt.timedelta(0), 'DEADLINE_MUST_BE_UTC')
    now = now or dt.datetime.now(dt.timezone.utc)
    require(now < deadline, 'IMPORT_WINDOW_EXPIRED')
    require(deadline <= dt.datetime(2026, 10, 17, 15, 19, tzinfo=dt.timezone.utc),
            'IMPORT_WINDOW_EXCEEDS_REVIEWED_MAXIMUM')
    chunks = spec.get('chunks')
    require(isinstance(chunks, list) and 0 < len(chunks) <= 1024, 'INVALID_CHUNK_COUNT')
    total = 0
    for index, item in enumerate(chunks):
        require(item.get('path') == f'chunks/{index:06d}.bin', 'CHUNKS_NOT_CONTIGUOUS')
        require(HEX64.fullmatch(item.get('sha256') or ''), 'INVALID_CHUNK_HASH')
        require(type(item.get('bytes')) is int and 0 < item['bytes'] <= 32768,
                'CHUNK_SIZE_OUT_OF_BOUNDS')
        total += item['bytes']
    require(total == spec['bundle_bytes'], 'CHUNK_TOTAL_MISMATCH')


def safe_file(root, relative):
    require(CHUNK.fullmatch(relative), 'UNSAFE_CHUNK_PATH')
    root = Path(root).resolve(strict=True)
    current = root
    for component in Path(relative).parts:
        current = current / component
        require(not current.is_symlink(), 'SYMLINK_IN_CHUNK_PATH')
    require(current.is_file(), 'CHUNK_MISSING')
    require(current.stat().st_nlink == 1, 'CHUNK_HARDLINK_REJECTED')
    return current


def assemble(root, spec, target):
    validate_spec(spec)
    actual = sorted(p.name for p in (Path(root) / 'chunks').iterdir())
    expected = [Path(x['path']).name for x in spec['chunks']]
    require(actual == expected, 'UNLISTED_OR_MISSING_CHUNK')
    with Path(target).open('xb') as output:
        for item in spec['chunks']:
            path = safe_file(root, item['path'])
            require(path.stat().st_size == item['bytes'], 'CHUNK_SIZE_MISMATCH')
            data = path.read_bytes()
            require(digest(data) == item['sha256'], 'CHUNK_HASH_MISMATCH')
            output.write(data)
    check_bundle_bytes(target, spec)


def check_bundle_bytes(path, spec):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), 'BUNDLE_NOT_REGULAR')
    require(path.stat().st_size == spec['bundle_bytes'], 'BUNDLE_SIZE_MISMATCH')
    require(digest(path.read_bytes()) == spec['bundle_sha256'], 'BUNDLE_SHA256_MISMATCH')
    with path.open('rb') as stream:
        # Self-contained v2 bundle only. No prerequisites, alternative refs, or extensions.
        expected_header = f'# v2 git bundle\n{SOURCE} HEAD\n\n'.encode()
        require(stream.read(len(expected_header)) == expected_header, 'BUNDLE_HEADER_MISMATCH')
        require(stream.read(4) == b'PACK', 'BUNDLE_PACK_HEADER_MISSING')


def git_env(home):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith('GIT_') and k not in ('GH_READ_TOKEN', 'GH_WRITE_TOKEN')}
    env.update({'HOME': str(home), 'LC_ALL': 'C', 'LANG': 'C', 'GIT_CONFIG_NOSYSTEM': '1',
                'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
                'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_ATTR_NOSYSTEM': '1'})
    return env


def git(repository, *args, input_bytes=None, env=None):
    command = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never']
    if repository:
        command.extend(['--git-dir', str(repository)])
    result = subprocess.run(command + list(args), input=input_bytes,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env, check=False, timeout=180)
    # Do not print command arguments, token-bearing environment, or arbitrary stderr.
    require(result.returncode == 0, 'GIT_COMMAND_FAILED:' + args[0])
    return result.stdout.decode('utf-8', errors='strict')


def verify_objects(bundle, spec, scratch):
    validate_spec(spec)
    check_bundle_bytes(bundle, spec)
    repository = Path(scratch) / 'verified.git'
    require(not repository.exists(), 'BARE_TARGET_ALREADY_EXISTS')
    env = git_env(scratch)
    git(None, 'init', '--bare', '--quiet', str(repository), env=env)
    git(repository, 'bundle', 'verify', str(Path(bundle).resolve()), env=env)
    git(repository, 'fetch', '--no-tags', str(Path(bundle).resolve()),
        'HEAD:refs/heads/verified-source', env=env)
    git(repository, 'fsck', '--full', '--strict', '--no-reflogs', env=env)
    require(git(repository, 'rev-parse', '--is-shallow-repository', env=env).strip() == 'false',
            'SHALLOW_REPOSITORY_REJECTED')
    require(not (repository / 'objects/info/alternates').exists(), 'ALTERNATES_REJECTED')
    require(not (repository / 'info/grafts').exists(), 'GRAFTS_REJECTED')
    require(not git(repository, 'for-each-ref', '--format=%(refname)', 'refs/replace', env=env).strip(),
            'REPLACEMENTS_REJECTED')
    actual_head = git(repository, 'rev-parse', 'refs/heads/verified-source', env=env).strip()
    require(actual_head == SOURCE, 'SOURCE_HEAD_MISMATCH')
    actual = git(repository, 'show', '-s', '--format=%T %P', SOURCE, env=env).strip()
    require(actual == SOURCE_TREE + ' ' + SOURCE_PARENT, 'SOURCE_TREE_OR_PARENT_MISMATCH')
    parents = git(repository, 'show', '-s', '--format=%P', 'e478966', env=env).strip()
    require(parents == '36a03b847f66e8d68d68e2cff1f00fd6b4b83b51 bf192cdce3d3b13347ab51ca3b26120786d55544',
            'E478_ORDERED_PARENTS_MISMATCH')
    ids = sorted(set(line.split()[0] for line in
                     git(repository, 'rev-list', '--objects', SOURCE, env=env).splitlines()))
    rows = sorted(git(repository, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)',
                      input_bytes=('\n'.join(ids) + '\n').encode(), env=env).splitlines())
    require(len(rows) == spec['object_count'], 'REACHABLE_OBJECT_COUNT_MISMATCH')
    require(digest(('\n'.join(rows) + '\n').encode()) == spec['object_inventory_sha256'],
            'REACHABLE_OBJECT_INVENTORY_MISMATCH')
    all_rows = sorted(git(repository, 'cat-file', '--batch-all-objects',
                         '--batch-check=%(objectname) %(objecttype) %(objectsize)', env=env).splitlines())
    require(all_rows == rows, 'UNREVIEWED_UNREACHABLE_OBJECTS_PRESENT')
    return repository


def api_get(suffix, token, missing_ok=False):
    # Only fixed, script-constructed repository GET endpoints are accepted.
    require((suffix == '' or suffix.startswith('/')) and '..' not in suffix and '?' not in suffix,
            'UNSAFE_API_SUFFIX')
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + suffix,
        headers={'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
                 'X-GitHub-Api-Version': '2026-03-10'})
    # Fail closed on redirects; do not transmit the token to another destination.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and missing_ok:
            return None
        raise RuntimeError('GITHUB_READ_FAILED:' + str(error.code)) from None


def remote_checks(spec, run_sha, token, destination_absent=True):
    require(HEX40.fullmatch(run_sha or ''), 'RUN_SHA_INVALID')
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'WRONG_REPOSITORY_ENVIRONMENT')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/' + BOOTSTRAP, 'WRONG_BOOTSTRAP_REF')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'create', 'WRONG_EVENT')
    require(os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'RERUN_REJECTED')
    require(os.environ.get('GITHUB_ACTOR_ID') == str(OWNER_ID), 'UNREVIEWED_TRIGGER_ACTOR')
    payload_commit = os.environ.get('EXPECTED_PAYLOAD_COMMIT', '')
    require(HEX40.fullmatch(payload_commit), 'PAYLOAD_COMMIT_UNSET')
    repo = api_get('', token)
    require(repo['id'] == REPOSITORY_ID and repo['owner']['id'] == OWNER_ID
            and repo['private'] is True and repo['default_branch'] == BASE_BRANCH,
            'REPOSITORY_IDENTITY_MISMATCH')
    base = api_get('/git/ref/heads/' + BASE_BRANCH, token)
    require(base['object']['sha'] == BASE, 'REMOTE_BASE_MOVED')
    base_commit = api_get('/git/commits/' + BASE, token)
    require(base_commit['tree']['sha'] == BASE_TREE, 'REMOTE_BASE_TREE_MISMATCH')
    bootstrap = api_get('/git/ref/heads/' + BOOTSTRAP, token)
    require(bootstrap['object']['sha'] == run_sha, 'BOOTSTRAP_HEAD_MOVED')
    run_commit = api_get('/git/commits/' + run_sha, token)
    require([p['sha'] for p in run_commit['parents']] == [payload_commit],
            'BOOTSTRAP_PAYLOAD_PARENT_MISMATCH')
    destination = api_get('/git/ref/heads/' + DESTINATION, token, missing_ok=True)
    if destination_absent:
        require(destination is None, 'DESTINATION_ALREADY_EXISTS')
    else:
        require(destination and destination['object']['sha'] == SOURCE, 'REMOTE_SOURCE_READBACK_MISMATCH')
    return {'base': BASE, 'bootstrap': run_sha, 'destination': None if destination is None else SOURCE}


def push_arguments():
    reference = 'refs/heads/' + DESTINATION
    # Empty expectation is create-only compare-and-swap. It cannot update any existing ref.
    # This still uses a --force-with-lease option and requires explicit independent review.
    return ['push', '--porcelain', '--atomic', '--no-follow-tags',
            '--force-with-lease=' + reference + ':',
            'https://github.com/' + REPOSITORY + '.git', SOURCE + ':' + reference]


def classify_push_porcelain(output):
    """Accept one exact create record; a same-SHA no-op is not our creation.
    Unknown/error/multiple-ref output never establishes ownership of a new ref.
    Raw output is deliberately not copied into exceptions or user-visible receipts.
    """
    require(isinstance(output, str) and output.endswith('\n'), 'PUSH_PORCELAIN_INCOMPLETE')
    require('\r' not in output and '\x00' not in output, 'PUSH_PORCELAIN_CONTROL_CHARACTER')
    lines = output.splitlines()
    require(len(lines) == 3, 'PUSH_PORCELAIN_EXPECTED_ONE_STATUS_RECORD')
    require(lines[0] == 'To https://github.com/' + REPOSITORY + '.git',
            'PUSH_PORCELAIN_REMOTE_MISMATCH')
    require(lines[2] == 'Done', 'PUSH_PORCELAIN_MISSING_DONE')
    columns = lines[1].split('\t')
    require(len(columns) == 3, 'PUSH_PORCELAIN_MALFORMED_STATUS')
    flag, refspec, summary = columns
    require(refspec == SOURCE + ':refs/heads/' + DESTINATION,
            'PUSH_PORCELAIN_REFSPEC_MISMATCH')
    if flag == '*' and summary == '[new branch]':
        return 'NEW_BRANCH_REPORTED'
    if flag == '=' and summary == '[up to date]':
        return 'TARGET_ALREADY_SAME_SHA_NOOP'
    raise RuntimeError('PUSH_PORCELAIN_NOT_AN_EXACT_NEW_BRANCH')


def push_once_and_reconcile(repository, spec, run_sha, token, env):
    """One push only. All uncertain/no-op paths perform GET-only reconciliation.
    Even a successful readback cannot turn an unknown/no-op push into a creation.
    """
    outcome = 'PUSH_RESULT_UNKNOWN_READ_ONLY_RECONCILIATION'
    try:
        output = git(repository, *push_arguments(), env=env)
        outcome = classify_push_porcelain(output)
    except Exception:
        # Includes nonzero exit, timeout, malformed UTF-8, partial/unexpected output.
        # Do not retry the push or expose arbitrary stderr/exception text.
        pass
    verified = False
    try:
        remote_checks(spec, run_sha, token, destination_absent=False)
        verified = True
    except Exception:
        # The read can fail, or refs can be missing/moved. Neither proves no mutation.
        pass
    if outcome == 'NEW_BRANCH_REPORTED' and verified:
        return {'status': 'IMPORTED_NEW_SOURCE_BRANCH_ONLY', 'source': SOURCE,
                'branch': DESTINATION, 'bundle_sha256': spec['bundle_sha256'],
                'created_by_this_run': True, 'readback': 'VERIFIED_EXPECTED_REMOTE_REFS'}
    if outcome == 'NEW_BRANCH_REPORTED':
        outcome = 'PUSH_NEW_BRANCH_REPORTED_READBACK_UNVERIFIED'
    return {'status': outcome, 'source': SOURCE, 'branch': DESTINATION,
            'created_by_this_run': False if outcome == 'TARGET_ALREADY_SAME_SHA_NOOP' else None,
            'readback': 'VERIFIED_EXPECTED_REMOTE_REFS' if verified else 'UNVERIFIED_OR_CHANGED',
            'next_action': 'STOP_AND_READ_ONLY_RECONCILE_NO_PUSH_RETRY'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'import'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    root = Path(args.input).resolve(strict=True)
    spec = json.loads((root / 'spec.json').read_text())
    validate_spec(spec)
    run_sha = os.environ.get('GITHUB_SHA', '')
    token_name = 'GH_READ_TOKEN' if args.phase == 'prepare' else 'GH_WRITE_TOKEN'
    token = os.environ.get(token_name, '')
    require(bool(token), 'TOKEN_NOT_PROVIDED')
    with tempfile.TemporaryDirectory(prefix='verified-genuine-import-') as temporary:
        temporary = Path(temporary)
        if args.phase == 'prepare':
            require(args.output, 'OUTPUT_REQUIRED')
            bundle = temporary / 'source.bundle'
            assemble(root, spec, bundle)
        else:
            bundle = root / 'source.bundle'
        repository = verify_objects(bundle, spec, temporary)
        remote_checks(spec, run_sha, token)
        if args.phase == 'prepare':
            output = Path(args.output)
            output.mkdir(mode=0o700, parents=False, exist_ok=False)
            shutil.copyfile(bundle, output / 'source.bundle')
            shutil.copyfile(root / 'spec.json', output / 'spec.json')
            shutil.copyfile(Path(__file__), output / 'import_genuine.py')
            print(json.dumps({'status': 'VERIFIED_DATA_ONLY', 'source': SOURCE,
                              'bundle_sha256': spec['bundle_sha256'], 'objects': 2326}))
            return
        # Recheck after all object work, immediately before the only remote Git mutation.
        validate_spec(spec)
        remote_checks(spec, run_sha, token)
        env = git_env(temporary)
        basic = base64.b64encode(('x-access-token:' + token).encode()).decode()
        env.update({'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'http.https://github.com/.extraheader',
                    'GIT_CONFIG_VALUE_0': 'AUTHORIZATION: basic ' + basic})
        result = push_once_and_reconcile(repository, spec, run_sha, token, env)
        print(json.dumps(result))
        if result['status'] != 'IMPORTED_NEW_SOURCE_BRANCH_ONLY':
            raise SystemExit(2)


if __name__ == '__main__':
    main()
