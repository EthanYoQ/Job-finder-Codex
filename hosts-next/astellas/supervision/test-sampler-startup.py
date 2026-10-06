#!/usr/bin/env python3
"""Local, no-network identity tests. Only the fixed fake root is selected."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

BASE = Path(__file__).resolve().parent
FROZEN = BASE.parent / 'sample_process_tree.py'
CANDIDATE = BASE / 'sample_process_tree.py'
(BASE / 'verification').mkdir(exist_ok=True, mode=0o700)
ROOT = Path(tempfile.mkdtemp(prefix='sampler-startup-', dir=BASE / 'verification'))
results = []
spec = importlib.util.spec_from_file_location('candidate_sampler', CANDIDATE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
original_stat, original_path, original_time = m.stat, m.Path, m.time

def check_mock(name, stats, cmdlines, success, oversleep=0, read_delay=0):
    calls, clock, reads, requested_sleep = [], [0.0], [0], [0.0]
    stable = {'pid': 123, 'startTicks': 456, 'state': 'S', 'comm': 'fixture', 'ppid': 1}
    def fake_stat(pid):
        assert pid == 123
        calls.append(pid)
        value = stats[min(len(calls)-1, len(stats)-1)]
        return {**stable, **value} if value is not None else None
    class FakePath:
        def __init__(self, path):
            assert path == '/proc/123/cmdline'
        def read_bytes(self):
            value = cmdlines[min(reads[0], len(cmdlines)-1)]
            reads[0] += 1
            clock[0] += read_delay
            if isinstance(value, Exception):
                raise value
            return value
    class Clock:
        @staticmethod
        def monotonic(): return clock[0]
        @staticmethod
        def sleep(seconds):
            requested_sleep[0] += seconds
            clock[0] += seconds + oversleep
    m.stat, m.Path, m.time = fake_stat, FakePath, Clock
    try:
        found = m.verify_startup_identity(123, '/expected.js')
        assert success and found['startTicks'] == 456, name
    except RuntimeError:
        assert not success, name
    finally:
        m.stat, m.Path, m.time = original_stat, original_path, original_time
    assert requested_sleep[0] <= 1.00001
    results.append({'name': name, 'passed': True, 'success': success, 'elapsedSeconds': clock[0], 'cmdlineReads': reads[0], 'onlyRequestedPidRead': True})

check_mock('exec-transition', [{}], [b'python\0', b'', b'node\0/expected.js\0'], True)
check_mock('same-pid-new-start-ticks-before-read', [{}, {'startTicks': 999}], [b'node\0/expected.js\0'], False)
check_mock('same-pid-new-start-ticks-after-read', [{}, {}, {'startTicks': 999}], [b'node\0/expected.js\0'], False)
check_mock('zombie-after-read', [{}, {}, {'state': 'Z'}], [b'node\0/expected.js\0'], False)
check_mock('disappeared-after-read', [{}, {}, None], [b'node\0/expected.js\0'], False)
check_mock('permission-error-no-retry', [{}], [PermissionError('synthetic')], False)
check_mock('substring-never-accepted', [{}], [b'node\0prefix/expected.js-suffix\0'], False)
check_mock('wrong-exact-token-deadline', [{}], [b'node\0/other.js\0'], False)
check_mock('late-wake-exact-token-refused', [{}], [b'python\0', b'node\0/expected.js\0'], False, oversleep=2)
check_mock('late-read-exact-token-refused', [{}], [b'node\0/expected.js\0'], False, read_delay=2)

ready = ROOT / 'ready.json'
node = shutil.which('node')
fixture = BASE / 'fixture-fault-inner.mjs'
program = 'import os,time;time.sleep(.35);os.execl(' + ','.join(repr(x) for x in [node,node,str(fixture),str(ready),'1100','17','']) + ')'
target = subprocess.Popen([sys.executable, '-c', program], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
def sampler(path, folder):
    return subprocess.Popen([sys.executable, str(path), '--root-pid', str(target.pid), '--expected-arg', str(fixture), '--output-dir', str(ROOT/folder), '--label', 'SYNTHETIC_STARTUP_ONLY', '--interval', '.2', '--pss-interval', '.2'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
old, new = sampler(FROZEN, 'frozen'), sampler(CANDIDATE, 'candidate')
oldout, olderr = old.communicate(timeout=5)
newout, newerr = new.communicate(timeout=5)
target.communicate(timeout=5)
assert old.returncode == 2 and b'Root argv identity check failed' in olderr
assert new.returncode == 0, newerr.decode()
assert target.returncode == 17
summary = json.loads((ROOT/'candidate'/'summary.json').read_text())
assert summary['root']['pid'] == target.pid and summary['status'] == 'TARGET_TREE_EXITED'
assert summary['rootIdentityVerifiedByExactArg'] is True
assert summary['sampleCount'] >= 2
assert not (ROOT/'frozen'/'samples.jsonl').exists()
results.append({'name':'real-delayed-exec-same-pid', 'passed':True, 'frozenExit':old.returncode, 'candidateExit':new.returncode, 'targetExit':target.returncode, 'candidateSampleCount':summary['sampleCount'], 'rootPidUnchanged':True})
old_source, new_source = FROZEN.read_text(), CANDIDATE.read_text()
old_tail=old_source[old_source.index('    root_key = ',old_source.index('def main():')):]
new_tail=new_source[new_source.index('    root_key = ',new_source.index('def main():')):]
assert old_tail == new_tail
assert old_source.split('def main():')[0] == new_source.split('def verify_startup_identity')[0]
report={'status':'PASS_STARTUP_IDENTITY_ONLY','artifactRoot':str(ROOT),'tests':results,'samplingLoopByteIdentical':True,'networkUsed':False,'realProducerExecuted':False,'allSyntheticChildrenWaited':True}
(ROOT/'SAMPLER_STARTUP_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'frozen.stderr').write_bytes(olderr)
print(json.dumps(report))
