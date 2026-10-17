"""Next batch only: actual run-output allocation, free space, original wrapper handle."""
import os,sys,time,json,subprocess,pathlib,signal,datetime
R=pathlib.Path(__file__).resolve().parent;B=R.parent
FREE_FLOOR=1024*1024*1024;EXPECTED=64*1024*1024
assert len(sys.argv)>2 and sys.argv[1]=='--'
def sample():
 frees=[os.statvfs(p).f_bavail*os.statvfs(p).f_frsize for p in (B,pathlib.Path('/tmp'))]
 return {'workspaceFreeBytes':frees[0],'tmpFreeBytes':frees[1]}
first=sample();assert min(first['workspaceFreeBytes'],first['tmpFreeBytes'])-EXPECTED>FREE_FLOOR,'DISK_RESERVE'
log=R/('SIMPLE_CAPTURE_CAPACITY_'+str(time.time_ns())+'.jsonl');child=None
with log.open('x') as f:
 def emit(event,**kw):f.write(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'event':event,**kw})+'\n');f.flush()
 def interrupted(signum,frame):raise RuntimeError('INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 emit('PRELAUNCH',expectedAdditionalBytes=EXPECTED,**first)
 try:
  child=subprocess.Popen(sys.argv[2:],cwd=B/'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source',env=os.environ.copy());emit('WRAPPER_STARTED',pid=child.pid)
  while child.poll() is None:
   time.sleep(1);s=sample()
   if min(s['workspaceFreeBytes'],s['tmpFreeBytes'])<=FREE_FLOOR:
    emit('CAPACITY_STOP',**s);child.terminate();child.wait(timeout=20);raise RuntimeError('CAPACITY_STOP')
  emit('WRAPPER_EXIT',exitCode=child.returncode,**sample());rc=child.returncode
 except BaseException as e:
  if child is not None and child.poll() is None:child.terminate();child.wait(timeout=20)
  emit('HELD',reason=type(e).__name__+':'+str(e),wrapperTerminal=child is None or child.poll() is not None);rc=99
sys.exit(rc)
