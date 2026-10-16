"""Formal-phase accounting adaptation. No installer launch or tool substitution.

Derived from the independently reviewed TEST_ONLY budget-stage.py accounting.
Production execution remains blocked pending a reviewed original-session stop
binding; this module is a read-only sampler and admission checker, not authority.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import subprocess
import time

ROOT = Path('/workspace/scratch/5e9614251709/formal-budget-monitor-adaptation-9abc-20261016T2248Z')
WORKSPACE = Path('/workspace/scratch/5e9614251709')
MIB = 1048576
LIMITS = {
    'overallHard': 912 * MIB, 'overallEarlyStop': 896 * MIB,
    'phaseHard': 640 * MIB, 'phaseEarlyStop': 624 * MIB,
    'freeFloor': 1024 * MIB, 'earlyMargin': 16 * MIB,
    'startupReserve': 36 * MIB, 'originalStrictStagingStart': 1500 * MIB,
    'ownHard': 2 * MIB,
}
BASELINE_SOURCE = 39510016
BASELINE_DEPENDENCIES = 429719552
PRESSURE_FREE_BASELINE = 1463304192
PRESSURE_NEW_BASELINE = 131072
HEAD = '9abc94393f96948a51119ef96f3a2143765f1350'
TREE = 'c2de6ac000fab0dd45c16f4f1fc40d7dbfb818d6'
SCAN_DEADLINE_AT = None

def scan_timeout():
    remaining = 30 if SCAN_DEADLINE_AT is None else SCAN_DEADLINE_AT - time.monotonic()
    require(remaining > 0, 'BUDGET_SCAN_DEADLINE')
    return min(30, remaining)

CONFIG_CANONICAL_SHA256 = 'aa2b604a15beaaefade70961dd02234d53cd237bd6186db02c11d0f2ddc5f216'


class Hold(RuntimeError):
    pass


def require(ok, code):
    if not ok:
        raise Hold(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def free(path):
    value = os.statvfs(path)
    return value.f_bavail * value.f_frsize


def identity(path):
    try:
        value = Path(path).lstat()
    except FileNotFoundError:
        return None
    require(stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode),
            'ROOT_NOT_REAL_DIRECTORY')
    return value.st_dev, value.st_ino


def allocated(path, *, required=False):
    path = Path(path)
    if not os.path.lexists(path):
        require(not required, 'REGISTERED_ROOT_MISSING:' + str(path))
        return 0
    require(not path.is_symlink(), 'REGISTERED_ROOT_SYMLINK')
    result = subprocess.run(
        ['/usr/bin/du', '-sx', '--block-size=1', str(path)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=scan_timeout(),
    )
    require(result.returncode == 0, 'REGISTERED_SCAN_FAILED:' + str(path))
    return int(result.stdout.split()[0])


def allocated_fd(fd):
    # -H follows only this explicit fd link. The pinned directory survives the
    # original stage -> target rename; internal links retain normal du behavior.
    result = subprocess.run(
        ['/usr/bin/du', '-sxH', '--block-size=1', '/proc/self/fd/' + str(fd)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=(fd,),
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=scan_timeout(),
    )
    require(result.returncode == 0, 'STAGE_TARGET_SCAN_FAILED')
    return int(result.stdout.split()[0])


def measure_stage_target(stage, target, *, scan=allocated_fd):
    """Measure one stable inode across the original no-replace rename.

    Both names with distinct identities, replacement, or disappearance HOLD.
    A creation/open race also HOLDs; no partial zero measurement is accepted.
    scan is a measurement port for bounded fixture tests, never a tool port.
    """
    paths = (Path(stage), Path(target))
    before = {str(path): identity(path) for path in paths}
    ids = {value for value in before.values() if value is not None}
    require(len(ids) <= 1, 'STAGE_TARGET_DISTINCT_INODES')
    if not ids:
        require(all(identity(path) is None for path in paths), 'STAGE_TARGET_CREATED_DURING_SCAN')
        return {'bytes': 0, 'identity': None, 'names': before}
    wanted = next(iter(ids))
    selected = next(path for path in paths if before[str(path)] == wanted)
    fd = os.open(selected, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino) == wanted, 'STAGE_TARGET_CHANGED_AT_OPEN')
        size = scan(fd)
        after = {str(path): identity(path) for path in paths}
        present = {value for value in after.values() if value is not None}
        require(present == {wanted}, 'STAGE_TARGET_REPLACED_OR_LOST')
        # A target may appear only by moving the originally observed stage.
        if before[str(target)] is not None:
            require(after[str(target)] == wanted and after[str(stage)] is None,
                    'TARGET_REVERSED_OR_ALIASED')
        final = os.fstat(fd)
        require((final.st_dev, final.st_ino) == wanted, 'STAGE_TARGET_FD_CHANGED')
        return {'bytes': size, 'identity': list(wanted), 'names': after}
    finally:
        os.close(fd)


def validate_roots(roots):
    roots = [Path(p) for p in roots]
    require(len(roots) == len(set(roots)), 'REGISTERED_ROOT_DUPLICATE')
    require(all(p.is_absolute() and p == p.resolve() for p in roots), 'REGISTERED_ROOT_NOT_CANONICAL')
    require(all(not a.is_relative_to(b) for a in roots for b in roots if a != b),
            'REGISTERED_ROOT_OVERLAP')


def validate_config(config):
    require(config['schemaVersion'] == 1 and config['kind'] == 'FORMAL_ACCOUNTING_ADAPTATION',
            'CONFIG_KIND')
    require(config['limits'] == LIMITS, 'APPROVED_LIMITS_CHANGED')
    require(config['workspace'] == str(WORKSPACE), 'FIXED_WORKSPACE_CHANGED')
    require(config['ownRoot'] == str(ROOT), 'OWN_ROOT_CHANGED')
    require(config['commitSha'] == HEAD and config['treeSha'] == TREE, 'SOURCE_IDENTITY_CHANGED')
    expected = {
        'target': str(WORKSPACE / 'job-finder-fixed-live-controller-v1'),
        'stage': str(WORKSPACE / '.job-finder-fixed-live-controller-v1.install-stage'),
        'owner': str(WORKSPACE / '.job-finder-fixed-live-controller-v1.lifecycle-owner'),
        'lock': str(WORKSPACE / '.job-finder-fixed-live-controller-v1.lifecycle.lock'),
        'mutation': str(WORKSPACE / '.job-finder-fixed-live-controller-v1.lifecycle-mutation-active.json'),
        'active': str(WORKSPACE / '.job-finder-fixed-live-controller-v1.lifecycle-active.json'),
        'verifierLog': str(WORKSPACE / 'native-verifier.stderr.log'),
        'evidence': str(WORKSPACE / 'five-source-formal-install-9abc-20261016T1726Z'),
    }
    require(config['formalRoots'] == expected, 'FORMAL_ROOTS_CHANGED')
    require(config['tmpCaches'] == ['/tmp/tsx-1000', '/tmp/tsx'], 'TMP_CACHE_ROOTS_CHANGED')
    require(config['sourceBaseline'] == BASELINE_SOURCE and
            config['dependencyBaseline'] == BASELINE_DEPENDENCIES and
            config['pressureFreeBaseline'] == PRESSURE_FREE_BASELINE and
            config['pressureNewBaseline'] == PRESSURE_NEW_BASELINE, 'ACCOUNTING_BASELINE_CHANGED')
    validate_roots(config['registeredRoots'] + [str(ROOT)] + list(expected.values()))
    require(config['productionExecutionEnabled'] is False, 'PRODUCTION_NOT_REVIEWED')
    require(config['originalEntryPoint'] == 'installFixedController()', 'ENTRYPOINT_CHANGED')
    require(hashlib.sha256(canonical(config).encode()).hexdigest() == CONFIG_CANONICAL_SHA256,
            'EXACT_CONFIG_BINDING_CHANGED')
    return config


def verify_provenance(config):
    validate_config(config)
    for path, expected in config['provenanceSha256'].items():
        require(sha(path) == expected, 'ORIGINAL_PROVENANCE_CHANGED:' + path)
    return True


def check_fresh_absence(config):
    for name, path in config['formalRoots'].items():
        require(not os.path.lexists(path), 'FORMAL_EXISTING_OR_UNKNOWN:' + name)
    require(completion_markers(WORKSPACE, config['completionMarkerPrefix'])['count'] == 0,
            'FORMAL_COMPLETION_ALREADY_EXISTS')


def completion_markers(parent, prefix):
    found = [p for p in Path(parent).iterdir() if p.name.startswith(prefix)]
    require(len(found) <= 1, 'FORMAL_COMPLETION_NAMESPACE_MULTIPLE')
    size = 0
    for path in found:
        require(re.fullmatch(re.escape(prefix) + '[a-f0-9]{32}', path.name),
                'FORMAL_COMPLETION_NAME')
        value = path.lstat()
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and
                value.st_uid == os.getuid() and stat.S_IMODE(value.st_mode) == 0o600,
                'FORMAL_COMPLETION_METADATA')
        size += value.st_blocks * 512
    return {'count': len(found), 'bytes': size}


def load_state_parent_baselines(config):
    verify_provenance(config)
    values = json.loads(Path(config['stateParentBaselinePath']).read_bytes())
    validate_state_parent_baselines(values)
    return values


def validate_state_parent_baselines(values):
    expected = {str(WORKSPACE / 'rounds'), str(WORKSPACE / 'connector-host-bindings')}
    require(type(values) is dict and set(values) == expected, 'STATE_PARENT_BASELINE_KEYS')
    require(all(type(value) is int and value >= 0 for value in values.values()),
            'STATE_PARENT_BASELINE_VALUES')
    require(values == {path: 4096 for path in expected}, 'ORIGINAL_STATE_PARENT_BASELINE_CHANGED')


def declared_states(config):
    result = set()
    for path in config['declaredStateIndexes']:
        for line in Path(path).read_text().splitlines():
            row = json.loads(line)
            for key in ('roundRoot', 'bindingPath'):
                if key in row:
                    child = Path(row[key])
                    require(child.parent in (WORKSPACE / 'rounds', WORKSPACE / 'connector-host-bindings')
                            and child == child.resolve(), 'DECLARED_STATE_SCOPE')
                    result.add(str(child))
    require(len(result) == 16, 'DECLARED_STATE_COUNT_CHANGED')
    return sorted(result)


def parent_allocation(path):
    value = Path(path).lstat()
    require(stat.S_ISDIR(value.st_mode), 'PARENT_NOT_DIRECTORY')
    return value.st_blocks * 512


def read_full(config):
    """Read-only current allocation. Baselines and high water live in Ledger."""
    started = time.monotonic()
    formal = config['formalRoots']
    pair = measure_stage_target(formal['stage'], formal['target'])
    roots = {p: allocated(p, required=True) for p in config['registeredRoots']}
    states = {p: allocated(p, required=True) for p in declared_states(config)}
    new = {p: allocated(p) for k, p in formal.items() if k not in ('stage', 'target')}
    new['stageTargetSameInode'] = pair['bytes']
    new['completionNamespace'] = completion_markers(WORKSPACE, config['completionMarkerPrefix'])['bytes']
    new[str(ROOT)] = allocated(ROOT, required=True)
    parent_paths = [str(WORKSPACE), str(WORKSPACE / 'rounds'),
                    str(WORKSPACE / 'connector-host-bindings'), '/tmp']
    return {
        'registered': roots, 'states': states, 'formal': new,
        'parents': {p: parent_allocation(p) for p in parent_paths},
        'tmpCaches': {p: allocated(p) for p in config['tmpCaches']},
        'stageTargetIdentity': pair['identity'],
        'workspaceFree': free(WORKSPACE), 'tmpFree': free('/tmp'),
        'ownAllocated': new[str(ROOT)], 'scanStarted': started,
        'monotonic': time.monotonic(), 'scanElapsedSeconds': time.monotonic() - started,
    }


class Ledger:
    """Monotone registered charges; reclaimed bytes never buy new authority."""
    def __init__(self, baseline, state_parent_baselines):
        validate_state_parent_baselines(state_parent_baselines)
        self.baseline = baseline
        self.state_parent_baselines = state_parent_baselines
        self.high = {}
        self.keys = {k: set(baseline[k]) for k in ('registered', 'states', 'formal', 'parents', 'tmpCaches')}
        self.original_pair_identity = None
        self.latest = None
        self.last_fast = None
        self.last_full = None
        self.maximum_fast_gap = 0.0
        self.maximum_full_gap = 0.0
        self.peak = {'charged': 0, 'phase': 0, 'tmp': 0, 'own': 0}
        self.minimum_free = {'workspace': None, 'tmp': None}

    def highwater(self, key, value):
        require(type(value) is int and value >= 0, 'ALLOCATION_INVALID')
        self.high[key] = max(value, self.high.get(key, 0))
        return self.high[key]

    def register(self, observed):
        for key, expected in self.keys.items():
            require(set(observed[key]) == expected, 'REGISTERED_SET_CHANGED:' + key)
        pair = observed['stageTargetIdentity']
        if self.original_pair_identity is not None:
            require(pair == self.original_pair_identity, 'STAGE_TARGET_IDENTITY_LOST')
        elif pair is not None:
            self.original_pair_identity = pair
        base = sum(self.highwater('root:' + p, n) for p, n in observed['registered'].items())
        base += sum(self.highwater('state:' + p, n) for p, n in observed['states'].items())
        base -= BASELINE_SOURCE + BASELINE_DEPENDENCIES
        require(base >= 0, 'NEGATIVE_REGISTERED_CHARGE')
        state_parent_growth = 0
        for p, old in self.state_parent_baselines.items():
            require(p in observed['parents'], 'STATE_PARENT_MISSING')
            state_parent_growth += self.highwater('stateParent:' + p, max(0, observed['parents'][p] - old))
        formal = sum(self.highwater('formal:' + p, n) for p, n in observed['formal'].items())
        formal += self.highwater('workspaceParent', max(0, observed['parents'][str(WORKSPACE)] - self.baseline['parents'][str(WORKSPACE)]))
        tmp = sum(self.highwater('cache:' + p, max(0, n - self.baseline['tmpCaches'][p]))
                  for p, n in observed['tmpCaches'].items())
        tmp += self.highwater('tmpParent', max(0, observed['parents']['/tmp'] - self.baseline['parents']['/tmp']))
        self.latest = {'registered': base + state_parent_growth + formal,
                       'formal': formal, 'tmpRegistered': tmp,
                       'own': self.highwater('own', observed['ownAllocated'])}
        at = observed['monotonic']
        if self.last_full is not None:
            self.maximum_full_gap = max(self.maximum_full_gap, at - self.last_full)
        self.last_full = at
        return self.sample(observed['workspaceFree'], observed['tmpFree'], at)

    def sample(self, workspace_free, tmp_free, monotonic):
        require(self.latest is not None, 'FULL_SAMPLE_REQUIRED')
        pressure = PRESSURE_FREE_BASELINE - workspace_free + PRESSURE_NEW_BASELINE
        tmp_pressure = max(0, self.baseline['tmpFree'] - tmp_free)
        tmp = self.highwater('tmpCharged', max(self.latest['tmpRegistered'], tmp_pressure))
        workspace_phase_pressure = sum(self.baseline['formal'].values()) + max(0, self.baseline['workspaceFree'] - workspace_free)
        phase_workspace = self.highwater('phaseWorkspace', max(self.latest['formal'], workspace_phase_pressure))
        out = {'charged': self.highwater('overallCharged', max(self.latest['registered'], pressure)),
               'phase': phase_workspace + tmp, 'tmp': tmp, 'own': self.latest['own'],
               'workspaceFree': workspace_free, 'tmpFree': tmp_free,
               'registered': self.latest['registered'], 'filesystemPressure': pressure,
               'fullSampleAgeSeconds': monotonic - self.last_full,
               'monotonic': monotonic}
        require(out['fullSampleAgeSeconds'] >= 0, 'MONOTONIC_CLOCK_REVERSED')
        if self.last_fast is not None:
            self.maximum_fast_gap = max(self.maximum_fast_gap, monotonic - self.last_fast)
        self.last_fast = monotonic
        for key in self.peak:
            self.peak[key] = max(self.peak[key], out[key])
        for key, current in [('workspace', workspace_free), ('tmp', tmp_free)]:
            previous = self.minimum_free[key]
            self.minimum_free[key] = current if previous is None else min(previous, current)
        return out


def check_limits(sample, *, startup=False):
    require(sample['charged'] < LIMITS['overallEarlyStop'], 'OVERALL_912_16MIB_EARLY_STOP')
    require(sample['phase'] < LIMITS['phaseEarlyStop'], 'FORMAL_640_16MIB_EARLY_STOP')
    require(sample['own'] <= LIMITS['ownHard'], 'OWN_2MIB_LIMIT')
    floor = LIMITS['freeFloor'] + LIMITS['earlyMargin']
    require(sample['workspaceFree'] > floor and sample['tmpFree'] > floor,
            'FREE_1GIB_16MIB_EARLY_STOP')
    if startup:
        require(sample['workspaceFree'] > LIMITS['originalStrictStagingStart'],
                'ORIGINAL_WORKSPACE_1500MIB_START')
        require(sample['charged'] + LIMITS['phaseHard'] < LIMITS['overallEarlyStop'],
                'FULL_640MIB_PLUS_GLOBAL_MARGIN_REQUIRED')
        require(sample['workspaceFree'] - LIMITS['phaseHard'] > floor,
                'FULL_640MIB_FREE_RESERVE_REQUIRED')
        require(sample['charged'] + LIMITS['startupReserve'] < LIMITS['overallHard']
                and sample['workspaceFree'] > LIMITS['freeFloor'] + LIMITS['startupReserve'],
                'ORIGINAL_36MIB_STARTUP_RESERVE')
    return True


def require_production_binding(config, binding, admission):
    """No caller booleans, saved PASS or synthetic receipt can enable launch."""
    validate_config(config)
    raise Hold('ORIGINAL_SESSION_STOP_BINDING_NOT_IMPLEMENTED_OR_REVIEWED')


if __name__ == '__main__':
    raise SystemExit('Accounting library only. No production launch/arm command is provided.')
