"""Offline boundary checks using existing local JNJ proof copies; never SQL/upload."""
import pathlib,json,shutil,tempfile,subprocess
B=pathlib.Path(__file__).resolve().parent.parent;W=pathlib.Path(__file__).resolve().parent
source=B/'takeda-original-recovery-20261017T0417Z/jnj/dot-auto-jnj-20261019T203143387Z';ids=json.loads((W/'REAL_JNJ_EQUIVALENCE.json').read_text())['requestIds']
with tempfile.TemporaryDirectory(prefix='tail-proof-',dir=W) as temp:
 root=pathlib.Path(temp);run=root/'jnj'/source.name;relay=root/'relay'
 for folder in ['artifacts','review','backup']:(run/folder).mkdir(parents=True)
 relay.mkdir()
 for p in (source/'artifacts').glob('*.outcome.json'):shutil.copy2(p,run/'artifacts'/p.name)
 for rel in ['producer-session.json','WEB_READBACK_VERIFIED.json','review/PACKET_REVIEW.json','review/EXPECTED_TARGET_API.json','backup/UPLOADED.json','backup/REMOTE_BACKUP_READBACK.json','backup/LOCAL_PACKAGE.json']:
  shutil.copy2(source/rel,run/rel)
 checkpoint={'sourceId':'source-johnson-innovative-medicine-social','batchId':run.name,'requestIds':ids};(run/'relay-checkpoint.json').write_text(json.dumps(checkpoint))
 for id in ids:
  for suffix in ['.request.json','.response.json']:shutil.copy2(B/'connector-host-task/relay'/(id+suffix),relay/(id+suffix))
 cmd=['python3',str(W/'package-success-evidence.py'),'--verify-committed','--run',str(run),'--relay',str(relay)]+[v for id in ids for v in ['--request-id',id]]
 def check(ok,reason=None):
  p=subprocess.run(cmd,capture_output=True,text=True)
  assert (p.returncode==0)==ok,p.stderr
  if reason:assert reason in p.stderr,p.stderr
  return json.loads(p.stdout) if ok else None
 proof=check(True);assert proof['backupVerified'] and proof['webVerified']
 p=run/'relay-checkpoint.json';p.write_text(json.dumps({**checkpoint,'batchId':'wrong'}));check(False,'CHECKPOINT_TUPLE_MISMATCH');p.write_text(json.dumps(checkpoint))
 p=run/'backup/REMOTE_BACKUP_READBACK.json';old=p.read_bytes();p.write_text('{}');check(False);p.write_bytes(old)
 for rel in ['backup/LOCAL_PACKAGE.json','backup/REMOTE_BACKUP_READBACK.json']:
  p=run/rel;value=json.loads(p.read_text());value['sources'][0]['batch']='dot-auto-other';p.write_text(json.dumps(value))
 check(False,'BACKUP_BATCH_BINDING')
 print('PASS real proof CLI: complete prior tail verified, wrong checkpoint/empty receipt/coherent wrong-batch backup rejected.')
