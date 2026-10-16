#!/usr/bin/env python3
"""One locked, offline synthetic default-heap Node measurement; never production."""
import fcntl, json, os, pathlib, resource, subprocess, sys, time
root=pathlib.Path(__file__).resolve().parent.parent
node=pathlib.Path(sys.argv[1]).resolve()
lock=pathlib.Path('/workspace/scratch/5e9614251709/job-finder-offline-validation.lock').open('r+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
env=dict(os.environ)
for name in ['NODE_OPTIONS','NODE_PATH']:
    env.pop(name,None)
env.update(TSX_DISABLE_CACHE='1',NODE_DISABLE_COMPILE_CACHE='1',JOBFINDER_CLOUD_SOURCE_ID='source-takeda-china-social',LANG='C.UTF-8',TZ='UTC')
command=[str(node),'--require','./test/no-network.cjs','--import','./node_modules/tsx/dist/loader.mjs','connector-gate/scale-probe.mts']
started=time.monotonic()
print(json.dumps({'status':'SYNTHETIC_SCALE_LAUNCH','command':command,'maxOldSpaceSizeOverride':False,'timeoutSeconds':1800,'localTestLockHeldBeforeLaunch':True}),flush=True)
child=subprocess.Popen(command,cwd=root,env=env)
code=None
try:
    while code is None:
        try:
            code=child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        if code is None:
            proc=pathlib.Path('/proc')/str(child.pid)
            try:
                status={k:v.strip() for k,v in (line.split(':',1) for line in (proc/'status').read_text().splitlines() if ':' in line)}
                stat=(proc/'stat').read_text().split()
                print(json.dumps({'status':'SYNTHETIC_SCALE_OWNED_CHILD_SAMPLE','wallSeconds':round(time.monotonic()-started,3),'VmRSS':status.get('VmRSS'),'VmHWM':status.get('VmHWM'),'userCpuTicks':stat[13],'systemCpuTicks':stat[14]}),flush=True)
            except (FileNotFoundError,ProcessLookupError):
                pass
        if code is None and time.monotonic()-started>=1800:
            child.terminate()
            try: code=child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill();code=child.wait()
            print(json.dumps({'status':'SYNTHETIC_SCALE_TIMEOUT','originalTimeoutSeconds':1800}),flush=True)
except KeyboardInterrupt:
    child.terminate()
    try: code=child.wait(timeout=10)
    except subprocess.TimeoutExpired: child.kill();code=child.wait()
    print(json.dumps({'status':'SYNTHETIC_SCALE_OWNER_ABORT','reaped':True}),flush=True)
finally:
    usage=resource.getrusage(resource.RUSAGE_CHILDREN)
    print(json.dumps({'status':'SYNTHETIC_SCALE_CHILD_TERMINAL','exitCode':code,'wallSeconds':round(time.monotonic()-started,3),'maxRssKiB':usage.ru_maxrss,'userSeconds':usage.ru_utime,'systemSeconds':usage.ru_stime,'liveQualification':False}),flush=True)
    fcntl.flock(lock,fcntl.LOCK_UN)
sys.exit(code if code is not None and code>=0 else 128-(code or 1))
