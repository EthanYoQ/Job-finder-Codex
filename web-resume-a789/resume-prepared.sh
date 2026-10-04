#!/bin/sh
set -eu
umask 077
exec python3 - resume-prepared <<'PY'
"""Resume only the reconciled, prepared a789 candidate; no copy or patch."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
import types

HERE = Path('/opt/jobfinder-transfer/a789-reviewed-20261004T1010Z')
PINNED = {
    'a789-web-deployment.tar.gz': '0060423da894ff831515dafd6c1b2513519ef449de43eef31733f4282677927e',
    'deploy-control.py': '094f89f24b63de58015fe3b165f0ade43d14afb815be14777aee1c9b00cdcfa5',
    'SHA256SUMS': 'bbf7df179887c6d2599f6c5597e0c52ea0e9928f6f987cb36d500833b9258d82',
}
EXPECTED_INTENT = {
    'at': '2026-10-04T10:16:55.685196+00:00',
    'target': '/opt/jobfinder-candidates/a789e0d',
    'guardSha256': '30f078451302bac43fdc95468eed189692e939fcda8ae1d369292cd7890a9833',
    'manifestSha256': '9027e65df6c1afeac9f39a8502feaddc8f90166720f3019a954dde4252ea69e9',
    'memAvailableKiB': 634560,
}
EXPECTED_IDENTITY = {
    'schemaVersion': 2,
    'commitSha': 'a789e0db617fcd204eca2101f4a6c5669a6c25da',
    'sourceTreeSha256': 'd295e308d78fe2459044ac90faeeade3c6cf871a8e78a42b797d40e1fabd1232',
    'runtimeTreeSha256': '54a00d28bfa43cc29657442a693aaedc395bb2b61c42ec8d9e42d2c1a87fc9df',
    'contentSha256': 'd9454e69c352faf5d49819a927a4513c638303742c51fed17bbcb4b09fe10586',
}
IDENTITY_MODULE_SHA = 'e88d82a6ff343b8c0023afa62b3e0a987149f57a1c868e945a2aeb99e7714351'
ATTEMPT = 'resume-prepared-intent.json'


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def verified_bytes(name, expected):
    path = HERE / name
    require(path.is_file() and not path.is_symlink(), 'DELIVERY_FILE_TYPE_' + name)
    body = path.read_bytes()
    require(hashlib.sha256(body).hexdigest() == expected, 'DELIVERY_HASH_' + name)
    return body


def load_controller():
    require(HERE.is_dir() and not HERE.is_symlink() and HERE.resolve() == HERE,
            'REVIEWED_TRANSFER_DIRECTORY_REQUIRED')
    bodies = {name: verified_bytes(name, digest) for name, digest in PINNED.items()}
    entries = [line.split() for line in bodies['SHA256SUMS'].decode('ascii').splitlines()]
    require(len(entries) == 8 and all(len(row) == 2 for row in entries), 'CHECKSUM_LIST_INVALID')
    expected_names = {'baseline-guard.json', 'deploy-control.py', 'manifest.json',
                      'rollback.sh', 'stage.sh', 'switch.sh', 'verify-stage.sh', 'web.patch'}
    require({name for digest, name in entries} == expected_names, 'DELIVERY_FILE_SCOPE')
    for digest, name in entries:
        verified_bytes(name, digest)
    # Import the exact hash-verified source, bypassing stale bytecode and writes.
    controller = types.ModuleType('reviewed_a789_deploy_control')
    controller.__file__ = str(HERE / 'deploy-control.py')
    exec(compile(bodies['deploy-control.py'], controller.__file__, 'exec'), controller.__dict__)
    require(controller.HERE == HERE and controller.MIN_BEFORE_KIB == 600 * 1024
            and controller.MIN_AFTER_KIB == 192 * 1024, 'CONTROLLER_CONTEXT_OR_GATES')
    return controller


def no_attempts(d):
    # Any existing receipt, including a dangling symlink, requires reconciliation.
    for name in [ATTEMPT, 'stage-result.json', 'switch-intent.json', 'switch-result.json',
                 'automatic-rollback-result.json', 'rollback-result.json', 'nginx-before.conf']:
        require(not os.path.lexists(str(HERE / name)), 'EXISTING_' + name + '_RECONCILE_FIRST')
    intent_path = HERE / 'stage-intent.json'
    require(intent_path.is_file() and not intent_path.is_symlink(), 'ORIGINAL_STAGE_INTENT_REQUIRED')
    require(json.loads(intent_path.read_text()) == EXPECTED_INTENT, 'ORIGINAL_STAGE_INTENT_CHANGED')
    require(d.file_sha(HERE / 'baseline-guard.json') == EXPECTED_INTENT['guardSha256']
            and d.file_sha(HERE / 'manifest.json') == EXPECTED_INTENT['manifestSha256'],
            'ORIGINAL_STAGE_INPUT_HASH_CHANGED')


def no_candidate_process(d):
    rows = json.loads(d.run(['pm2', 'jlist']))
    require(not any(row.get('name') == d.CANDIDATE_NAME
                    or row.get('pm2_env', {}).get('pm_cwd') == str(d.CANDIDATE)
                    for row in rows), 'CANDIDATE_PROCESS_EXISTS_RECONCILE_FIRST')
    for name in ['/proc/net/tcp', '/proc/net/tcp6']:
        for line in Path(name).read_text().splitlines()[1:]:
            row = line.split()
            require(not (row[3] == '0A' and row[1].endswith(':0BD9')),
                    'PORT_3033_LISTENER_EXISTS_RECONCILE_FIRST')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 3033))


def prepared_check(d, guard):
    no_attempts(d)
    manifest = d.manifest_check()
    d.protected(guard)
    no_candidate_process(d)
    d.memory(d.MIN_BEFORE_KIB)
    require(d.CANDIDATE.is_dir() and not d.CANDIDATE.is_symlink()
            and d.CANDIDATE.resolve() == d.CANDIDATE, 'PREPARED_CANDIDATE_DIRECTORY_REQUIRED')
    require(d.identity(d.CANDIDATE, d.TARGET_COMMIT) == EXPECTED_IDENTITY,
            'PREPARED_BAKED_IDENTITY_CHANGED')
    require(d.file_sha(d.CANDIDATE / 'src/readiness/buildIdentity.ts') == IDENTITY_MODULE_SHA,
            'IDENTITY_VALIDATOR_CHANGED')
    for item in manifest['sourceFiles']:
        path = d.CANDIDATE / item['path']
        require(path.is_file() and not path.is_symlink() and d.file_sha(path) == item['sha256'],
                'PREPARED_PATCH_FILE_CHANGED')
    # Read-only re-attestation of both trees, using the existing identity module.
    script = ("import{readAndValidateBakedBuildIdentity,canonicalSourceTreeSha256}"
              "from'./src/readiness/buildIdentity.ts';"
              "const b=readAndValidateBakedBuildIdentity();"
              "if(canonicalSourceTreeSha256(process.cwd())!==b.sourceTreeSha256)"
              "throw Error('SOURCE_TREE_DRIFT');console.log(JSON.stringify(b));")
    observed = json.loads(d.run([d.NODE, '--import', './node_modules/tsx/dist/loader.mjs',
                                '--input-type=module', '-e', script], cwd=d.CANDIDATE, timeout=180))
    require(observed == EXPECTED_IDENTITY, 'PREPARED_FULL_TREE_IDENTITY_CHANGED')
    for root in [d.CANDIDATE, d.MAIN]:
        require(d.static_tree_sha(d.tree_files(root / 'dist')) == guard['distTreeSha256'],
                'PREPARED_OR_MAIN_STATIC_CHANGED')
        require(d.file_sha(root / 'dist/index.html') == guard['indexSha256'], 'STATIC_INDEX_CHANGED')
    d.health('http://127.0.0.1:3032')
    d.health('http://127.0.0.1:3031')
    d.protected(guard)
    no_attempts(d)
    no_candidate_process(d)


def resume_prepared(d, guard):
    prepared_check(d, guard)
    # This remains the original 600 MiB immediately-before-start gate.
    before_mem = d.memory(d.MIN_BEFORE_KIB)
    d.save_new(ATTEMPT, {
        'at': d.now(), 'action': 'resume-prepared', 'target': str(d.CANDIDATE),
        'originalStageIntentSha256': d.file_sha(HERE / 'stage-intent.json'),
        'controllerSha256': PINNED['deploy-control.py'],
        'sourcePackageSha256': PINNED['a789-web-deployment.tar.gz'],
        'candidateIdentity': EXPECTED_IDENTITY, 'memAvailableKiB': before_mem,
    })
    started = False
    try:
        started = True  # A failed CLI return may still have admitted the process.
        env = dict(d.SAFE_ENV, HOST='127.0.0.1', PORT='3033', NODE_ENV='production',
                   POSTGRES_READINESS_TIMEOUT_MS='10000',
                   JOBFINDER_PUBLICATION_POLICY='PLAN_BOUND_SOURCE_QUALITY_V1')
        d.run(['pm2', 'start', d.NODE, '--name', d.CANDIDATE_NAME, '--cwd', str(d.CANDIDATE),
               '--interpreter', 'none', '--kill-timeout', '10000', '--max-restarts', '3',
               '--time', '--', '--env-file=/opt/jobfinder/.env', '--import',
               './node_modules/tsx/dist/loader.mjs', 'src/server/httpServer.ts'], env=env)
        deadline = time.monotonic() + 120
        while True:
            d.memory(d.MIN_AFTER_KIB)
            try:
                d.health('http://127.0.0.1:3033', timeout=2)
                break
            except (OSError, ValueError, RuntimeError):
                d.require(time.monotonic() < deadline, 'CANDIDATE_STARTUP_TIMEOUT')
                time.sleep(1)
        report = d.verify_stage(guard)
        d.save_new('stage-result.json', report)
        return report
    except BaseException:
        if started:
            # The original helper checks exact ownership, cwd and identity.
            d.stop_owned_candidate()
        raise


def main():
    require(sys.argv[1:] == ['resume-prepared'], 'EXPLICIT_RESUME_PREPARED_ACTION_REQUIRED')
    os.umask(0o077)
    d = load_controller()
    guard = json.loads((HERE / 'baseline-guard.json').read_text())
    require(guard.get('status') == 'PINNED_FROM_READ_ONLY_SERVER_EVIDENCE', 'BASELINE_NOT_PINNED')
    lock_path = HERE / 'deploy.lock'
    require(not lock_path.is_symlink(), 'DEPLOY_LOCK_SYMLINK')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = resume_prepared(d, guard)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'state': 'FAILED_CLOSED', 'error': str(error)[:240]}), file=sys.stderr)
        sys.exit(1)
PY
