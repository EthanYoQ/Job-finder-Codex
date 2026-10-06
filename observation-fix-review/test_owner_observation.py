"""Offline tests: synthetic release, synthetic ledger, real bounded fake CLI processes.

No test reads production payloads, profiles or ledger contents. Production source
is copied then identifiers and CLI/HOME are replaced only in the isolated copy.
"""
import ast
import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE=Path(__file__).resolve().parent
CANDIDATE=(HERE/'owner-ali-call.candidate.py').read_text()
BASELINE=(HERE/'owner-ali-call.baseline.py').read_text()
ORIGINAL=(HERE.parent/'owner-guard-review/owner-ali-call.original.py').read_text()
SCRIPT='transfer-bootstrap/upload-000.sh'
RELEASE='offline-release'
INSTANCE='offline-instance'
OLD_LABELS=['legacy-one','legacy-two','legacy-three']
INVOKE='t-offline123'
REQUEST='01234567-89ab-cdef-0123-456789abcdef'
SECRET='SYNTHETIC_AK_DO_NOT_LEAK_7F84'
SIGNATURE='SYNTHETIC_SIGNATURE_DO_NOT_LEAK_EE27'
sha=lambda b:hashlib.sha256(b).hexdigest()
PAYLOADS={SCRIPT:b'#!/bin/sh\n'+b'#'+b'x'*9403+b'\n',
 'reconcile-bootstrap-readonly.sh':b'#!/bin/sh\nprintf "readonly-reconcile\\n"\n',
 'phases/needs.sh':b'#!/bin/sh\nprintf "readonly-needs\\n"\n'}

FAKE_CLI=r'''#!/usr/bin/env python3
import base64,json,os,pathlib,signal,socket,sys,time
def forbid(*args,**kwargs):raise RuntimeError('NETWORK_FORBIDDEN')
socket.socket=forbid;socket.create_connection=forbid
signal.signal(signal.SIGALRM,lambda *_:os._exit(91));signal.alarm(3)
root=pathlib.Path(__file__).resolve().parent
mode=os.environ.get('OFFLINE_CASE','ok')
with (root/'fixture-calls.jsonl').open('a') as f:
 f.write(json.dumps({'pid':os.getpid(),'argv':sys.argv[1:],'home':os.environ['HOME']})+'\n');f.flush();os.fsync(f.fileno())
secret='SYNTHETIC_AK_DO_NOT_LEAK_7F84';signature='SYNTHETIC_SIGNATURE_DO_NOT_LEAK_EE27'
response={'InvokeId':'t-offline123','RequestId':'01234567-89ab-cdef-0123-456789abcdef'}
if sys.argv[2]=='DescribeInvocationResult':response={'InvocationResult':{'InvocationStatus':'Success','ExitCode':0,'Output':base64.b64encode(b'{"readOnly":true}').decode()}}
if mode=='json':sys.stdout.write(secret);sys.stderr.write(signature)
elif mode=='missing-invoke':sys.stdout.write('{}')
elif mode=='invalid-invoke':sys.stdout.write(json.dumps({'InvokeId':secret,'RequestId':signature}))
elif mode=='rejected':sys.stderr.write('AccessDenied '+secret+' Signature='+signature);sys.exit(1)
elif mode in ('timeout','no-response'):time.sleep(2)
elif mode=='split-json':
 raw=json.dumps(response);sys.stdout.write(raw[:25]);sys.stdout.flush();time.sleep(.15);sys.stdout.write(raw[25:]);sys.stdout.flush();time.sleep(.15)
elif mode=='partial-json':sys.stdout.write('{"InvokeId":"t-offline123"');sys.stdout.flush();time.sleep(2)
elif mode=='unsafe-request':response['RequestId']=secret;sys.stdout.write(json.dumps(response))
elif mode=='sentinels':
 response['AccessKeyId']=secret;response['Signature']=signature
 sys.stdout.write(json.dumps(response));sys.stdout.flush()
 sys.stderr.write('Access');sys.stderr.flush();time.sleep(.04)
 sys.stderr.write('Denied '+secret+' Signature='+signature);sys.stderr.flush()
elif mode in ('receipt-hang','receipt-fail','receipt-trailing'):
 sys.stdout.write(json.dumps(response));sys.stdout.flush();time.sleep(.35)
 if mode=='receipt-fail':sys.stderr.write(secret+' '+signature);sys.exit(1)
 if mode=='receipt-trailing':sys.stdout.write(secret);sys.stdout.flush()
 else:time.sleep(2)
else:sys.stdout.write(json.dumps(response))
'''

def assignment(source,name):
 for node in ast.parse(source).body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in node.targets):return ast.literal_eval(node.value)
 raise AssertionError(name)

def isolated_source(source,root,timeout=None,hook=None):
 # Derive pinned values from source, rather than embedding real account values.
 for old,new in [(assignment(BASELINE,'RELEASE'),RELEASE),(assignment(BASELINE,'INSTANCE'),INSTANCE),
                 (assignment(BASELINE,'CLI'),str(root/'fake-cli.py'))]:source=source.replace(old,new)
 for path,oldhash in assignment(BASELINE,'READ_ONLY').items():source=source.replace(oldhash,sha(PAYLOADS[path]))
 source=source.replace('/workspace/shared/aliyun-cli/home',str(root/'empty-home'))
 source=source.replace('dot-web-deploy','offline-profile').replace('ap-northeast-2','offline-region')
 if timeout is not None:source=source.replace('PROCESS_TIMEOUT=75','PROCESS_TIMEOUT='+repr(timeout))
 prelude="import sys,os,signal\ndef offline_audit(event,args):\n if event.startswith('socket.'):raise RuntimeError('NETWORK_FORBIDDEN')\n"
 if hook=='spawn-error':prelude+=" if event=='subprocess.Popen':raise OSError('SYNTHETIC_AK_DO_NOT_LEAK_7F84')\n"
 if hook=='interrupt':prelude+=" if event=='subprocess.Popen':raise KeyboardInterrupt('SYNTHETIC_AK_DO_NOT_LEAK_7F84')\n"
 prelude+="sys.addaudithook(offline_audit)\n"
 if hook=='stop-before-spawn':source=source.replace("snapshot();observe('before-spawn')","snapshot();observe('before-spawn');os.kill(os.getpid(),signal.SIGSTOP)")
 return prelude+source

class Fixture(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='owner-observation-offline-');self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.out=self.root/'owner-invocations';self.out.mkdir()
  self.processes=[];self.children={};self.addCleanup(self.cleanup_processes)
  self.cli=self.root/'fake-cli.py';self.cli.write_text(FAKE_CLI);self.cli.chmod(0o700)
  (self.root/'empty-home').mkdir()
  for rel,data in PAYLOADS.items():
   p=self.root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  self.write_json(self.root/'manifest.json',{'releaseId':RELEASE});self.reseal()
 def write_json(self,p,j):p.write_text(json.dumps(j))
 def reseal(self):self.write_json(self.root/'SEALED_BOOTSTRAP.json',{'commandFiles':[{'path':n,'sha256':sha((self.root/n).read_bytes())} for n in PAYLOADS]})
 def old_intent(self,label):
  p=self.out/(label+'-intent.json');self.write_json(p,{'script':SCRIPT,'targetInstance':INSTANCE,'payloadSha256':sha(PAYLOADS[SCRIPT])});return p
 def unknown(self):
  p=self.out/'UNKNOWN_SUBMISSION.json';self.write_json(p,{'state':'UNKNOWN','synthetic':True});return p
 def calls(self):
  p=self.root/'fixture-calls.jsonl'
  rows=[json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []
  for row in rows:
   pid=row['pid'];stat=Path('/proc')/str(pid)/'stat'
   if pid not in self.children and stat.exists():self.children[pid]=stat.read_text().split()[21]
  return rows
 def reset(self):
  for p in self.out.iterdir():p.unlink()
  p=self.root/'fixture-calls.jsonl'
  if p.exists():p.unlink()
 def launch(self,mode='submit',label='fourth-label',script=SCRIPT,source=CANDIDATE,entry='owner-isolated.py',case='ok',timeout=None,hook=None):
  target=self.root/entry;target.write_text(isolated_source(source,self.root,timeout,hook))
  args=[sys.executable,str(target),mode,label]+(['--script',script] if mode=='submit' else [])
  p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'OFFLINE_CASE':case,'PYTHONDONTWRITEBYTECODE':'1'})
  self.processes.append(p);return p
 def finish(self,p):
  stdout,stderr=p.communicate(timeout=6);self.calls()
  return p.returncode,stdout.decode()+stderr.decode()
 def invoke(self,**kw):return self.finish(self.launch(**kw))
 def errors(self,mode='submit'):return sorted([json.loads(p.read_text()) for p in self.out.glob('*-'+mode+'-error-*.json')],key=lambda j:j['at'])
 def observations(self):return [json.loads(p.read_text()) for p in sorted(self.out.glob('*-observation-*.json'))]
 def until(self,predicate,timeout=3):
  deadline=time.monotonic()+timeout
  while time.monotonic()<deadline:
   if predicate():return
   time.sleep(.01)
  self.fail('Timed out waiting for fixture evidence')
 def tracked_alive(self,pid):
  stat=Path('/proc')/str(pid)/'stat'
  if not stat.exists():return False
  value=stat.read_text().split()
  return value[2]!='Z' and value[21]==self.children.get(pid)
 def cleanup_processes(self):
  for p in self.processes:
   if p.poll() is None:p.kill()
   p.communicate(timeout=4)
  self.calls()
  for pid in self.children:
   if self.tracked_alive(pid):os.kill(pid,signal.SIGKILL)
 def protected_intents(self):return {p.name:p.read_bytes() for p in self.out.iterdir() if '-intent.json' in p.name or p.name.startswith('operation-') or p.name=='UNKNOWN_SUBMISSION.json'}
 def assert_intents_same(self,before):self.assertEqual(self.protected_intents(),before)
 def assert_no_secret(self,result):
  logs='\n'.join(p.read_text() for p in self.out.iterdir())+result[1]
  self.assertNotIn(SECRET,logs);self.assertNotIn(SIGNATURE,logs)
 def assert_blocked(self,result):
  self.assertEqual(result[0],2);self.assertEqual(self.calls(),[])
  self.assertEqual(self.errors()[-1]['state'],'SUBMISSION_BLOCKED_BEFORE_CALL')
 def clear_calls(self):
  p=self.root/'fixture-calls.jsonl'
  if p.exists():p.unlink()

class OwnerGuardTests(Fixture):
 def test_original_counterexample_each_legacy_label_allows_fourth(self):
  for old in OLD_LABELS:
   with self.subTest(old=old):
    self.old_intent(old);self.assertEqual(self.invoke(source=ORIGINAL)[0],0);self.assertEqual(len(self.calls()),1);self.reset()
 def test_each_legacy_label_blocks_fourth(self):
  for old in OLD_LABELS:
   with self.subTest(old=old):
    p=self.old_intent(old);before=p.read_bytes();self.assert_blocked(self.invoke());self.assertEqual(p.read_bytes(),before)
    self.assertFalse((self.out/'fourth-label-intent.json').exists());self.reset()
 def test_all_actual_old_labels_and_unknown_marker_block(self):
  for label in OLD_LABELS:self.old_intent(label)
  self.unknown();before=self.protected_intents();self.assert_blocked(self.invoke());self.assert_intents_same(before)
 def test_changed_payload_same_script_remains_blocked(self):
  self.old_intent(OLD_LABELS[0]);p=self.root/SCRIPT;p.write_bytes(p.read_bytes()+b'\n# synthetic changed payload\n');self.reseal();self.assert_blocked(self.invoke())
 def test_alternative_entry_filename_remains_blocked(self):
  self.old_intent(OLD_LABELS[0]);self.assert_blocked(self.invoke(entry='different-owner-entry.py'))
 def test_unknown_marker_alone_blocks_new_write(self):self.unknown();self.assert_blocked(self.invoke())
 def test_malformed_unknown_marker_fails_closed(self):
  (self.out/'UNKNOWN_SUBMISSION.json').write_text('{bad '+SECRET);result=self.invoke();self.assert_blocked(result);self.assertNotIn(SECRET,result[1])
 def test_malformed_prior_intent_fails_closed(self):
  (self.out/'broken-intent.json').write_text('{bad '+SECRET);result=self.invoke();self.assert_blocked(result);self.assertNotIn(SECRET,result[1])
 def test_readonly_reconcile_allowed_with_unknown_and_old_writes(self):
  self.unknown();self.old_intent(OLD_LABELS[0]);self.assertEqual(self.invoke(script='reconcile-bootstrap-readonly.sh')[0],0)
  self.assertEqual(len(self.calls()),1);self.assertFalse(list(self.out.glob('operation-*.json')))
 def test_readonly_needs_allowed_with_unknown(self):
  self.unknown();self.assertEqual(self.invoke(script='phases/needs.sh')[0],0);self.assertEqual(len(self.calls()),1)
 def test_changed_readonly_name_cannot_bypass_unknown(self):
  self.unknown();(self.root/'reconcile-bootstrap-readonly.sh').write_text('# synthetic write\n');self.reseal();self.assert_blocked(self.invoke(script='reconcile-bootstrap-readonly.sh'))
 def test_query_allowed_with_unknown(self):
  self.unknown();self.old_intent(OLD_LABELS[0]);self.write_json(self.out/'known-submit.json',{'InvokeId':INVOKE})
  self.assertEqual(self.invoke(mode='query',label='known')[0],0);self.assertEqual(self.calls()[0]['argv'][1],'DescribeInvocationResult')
  self.assertTrue((self.out/'known-success.json').is_file())
 def test_fresh_write_records_metadata_and_refuses_another_label(self):
  self.assertEqual(self.invoke()[0],0);self.assertEqual(len(self.calls()),1)
  j=json.loads((self.out/'fourth-label-intent.json').read_text())
  for k,v in [('releaseId',RELEASE),('targetInstance',INSTANCE),('script',SCRIPT),('commandName','jf-pair-fourth-label'),('payloadRawBytes',9415),('payloadBase64Bytes',12556)]:self.assertEqual(j[k],v)
  self.assertEqual(j['transport'],{'cliPath':str(self.cli),'connectTimeoutSeconds':20,'readTimeoutSeconds':45,'processTimeoutSeconds':75,'retryCount':0})
  self.assertEqual(len(list(self.out.glob('operation-*.json'))),1);self.clear_calls();self.assert_blocked(self.invoke(label='fifth-label'))
 def test_stable_slot_blocks_even_if_label_intent_is_missing(self):
  self.assertEqual(self.invoke()[0],0);(self.out/'fourth-label-intent.json').unlink();self.clear_calls();self.assert_blocked(self.invoke(label='fifth-label'))
 def test_submission_failures_are_unknown_sanitized_and_keep_intents(self):
  for case in ['json','timeout','rejected','interrupt','missing-invoke','spawn-error']:
   with self.subTest(case=case):
    result=self.invoke(case=case,hook=case if case in ('interrupt','spawn-error') else None,timeout=.2 if case=='timeout' else None)
    self.assertEqual(result[0],2);self.assertEqual(len(self.calls()),0 if case in ('interrupt','spawn-error') else 1)
    self.assertEqual(self.errors()[-1]['state'],'SUBMISSION_UNKNOWN_DO_NOT_RESUBMIT');self.assertEqual(len(self.protected_intents()),2);self.assert_no_secret(result)
    before=self.protected_intents();self.clear_calls();self.assert_blocked(self.invoke(label='fifth-label'));self.assert_intents_same(before);self.reset()

class ObservationTests(Fixture):
 def test_stage_events_and_exact_transport_args(self):
  self.assertEqual(self.invoke()[0],0);events=self.observations();phases=[j['cliPhase'] for j in events]
  for phase in ['before-spawn','cli-started','invoke-receipt-saved','bytes-received','cli-exited']:self.assertIn(phase,phases)
  self.assertLess(phases.index('invoke-receipt-saved'),phases.index('cli-exited'))
  self.assertNotIn('cliPid',events[0]);self.assertEqual(events[1]['cliPid'],self.calls()[0]['pid'])
  argv=self.calls()[0]['argv']
  self.assertEqual(argv,['swas-open','RunCommand','--profile','offline-profile','--RegionId','offline-region','--InstanceId',INSTANCE,'--connect-timeout','20','--read-timeout','45','--Name','jf-pair-fourth-label','--Type','RunShellScript','--CommandContent',PAYLOADS[SCRIPT].decode(),'--Timeout','600','--retry-count','0'])
  self.assertEqual(self.calls()[0]['home'],str(self.root/'empty-home'))
 def test_catchable_interrupt_before_cli_spawn(self):
  result=self.invoke(hook='interrupt');self.assertEqual(result[0],2);self.assertFalse(self.calls())
  self.assertEqual([e['cliPhase'] for e in self.observations()],['before-spawn','cli-interrupted']);self.assertEqual(len(self.protected_intents()),2);self.assert_no_secret(result)
 def test_sigkill_before_cli_spawn_keeps_intents_without_terminal(self):
  p=self.launch(hook='stop-before-spawn');self.until(lambda:bool(self.observations()));before=self.protected_intents()
  p.kill();self.assertEqual(self.finish(p)[0],-signal.SIGKILL);self.assertFalse(self.calls());self.assertFalse(self.errors());self.assert_intents_same(before)
  self.assertEqual([e['cliPhase'] for e in self.observations()],['before-spawn'])
 def test_sigkill_after_cli_start_before_response_finite_orphan(self):
  p=self.launch(case='no-response');self.until(lambda:bool(self.calls()) and any(e['cliPhase']=='cli-started' for e in self.observations()))
  pid=self.calls()[0]['pid'];before=self.protected_intents();p.kill();self.assertEqual(self.finish(p)[0],-signal.SIGKILL)
  self.assertFalse(self.errors());self.assertFalse((self.out/'fourth-label-submit.json').exists());self.assert_intents_same(before)
  self.until(lambda:not self.tracked_alive(pid),timeout=4)
 def test_sigterm_after_cli_start_records_exit_and_keeps_intents(self):
  p=self.launch(case='no-response');self.until(lambda:bool(self.calls()));before=self.protected_intents();p.terminate();result=self.finish(p)
  self.assertEqual(result[0],2);self.assertEqual(self.errors()[-1]['cliPhase'],'cli-interrupted');self.assertEqual(self.errors()[-1]['exitCode'],-signal.SIGKILL)
  self.assert_intents_same(before);self.assertFalse(self.tracked_alive(self.calls()[0]['pid']));self.assert_no_secret(result)
 def test_receipt_is_persisted_before_cli_exit_and_survives_sigkill(self):
  p=self.launch(case='receipt-hang');receipt=self.out/'fourth-label-submit.json';self.until(receipt.exists)
  before=receipt.read_bytes();self.assertIsNone(p.poll());self.assertEqual(json.loads(before)['InvokeId'],INVOKE);self.calls()
  p.kill();self.assertEqual(self.finish(p)[0],-signal.SIGKILL);self.assertEqual(receipt.read_bytes(),before);self.assertFalse(self.errors())
  self.until(lambda:all(not self.tracked_alive(pid) for pid in self.children),timeout=4)
 def test_receipt_survives_nonzero_timeout_and_invalid_trailing_json(self):
  for case in ('receipt-fail','receipt-hang','receipt-trailing'):
   with self.subTest(case=case):
    p=self.launch(case=case,timeout=.6 if case=='receipt-hang' else None);receipt=self.out/'fourth-label-submit.json';self.until(receipt.exists);before=receipt.read_bytes();intents=self.protected_intents()
    result=self.finish(p);self.assertEqual(result[0],2);self.assertEqual(receipt.read_bytes(),before);self.assert_intents_same(intents)
    self.assertEqual(self.errors()[-1]['state'],'SUBMITTED_RECEIPT_SAVED_CLI_ERROR');self.assertEqual(self.errors()[-1]['InvokeId'],INVOKE);self.assert_no_secret(result);self.reset()
 def test_split_json_only_yields_complete_receipt(self):
  p=self.launch(case='split-json');self.until(lambda:any(e.get('stdoutBytes',0)>0 for e in self.observations()))
  self.assertFalse((self.out/'fourth-label-submit.json').exists());self.assertEqual(self.finish(p)[0],0)
  self.assertEqual(json.loads((self.out/'fourth-label-submit.json').read_text())['InvokeId'],INVOKE)
 def test_partial_json_times_out_without_receipt(self):
  result=self.invoke(case='partial-json',timeout=.25);self.assertEqual(result[0],2);self.assertFalse((self.out/'fourth-label-submit.json').exists())
  self.assertEqual(self.errors()[-1]['cliPhase'],'cli-timeout');self.assertGreater(self.errors()[-1]['stdoutBytes'],0);self.assert_no_secret(result)
 def test_sentinel_output_reduces_to_hashes_and_fixed_categories(self):
  result=self.invoke(case='sentinels');self.assertEqual(result[0],0);self.assert_no_secret(result)
  last=self.observations()[-1];stdout=json.dumps({'InvokeId':INVOKE,'RequestId':REQUEST,'AccessKeyId':SECRET,'Signature':SIGNATURE}).encode();stderr=('AccessDenied '+SECRET+' Signature='+SIGNATURE).encode()
  self.assertEqual(last['stdoutBytes'],len(stdout));self.assertEqual(last['stderrBytes'],len(stderr));self.assertEqual(last['stdoutSha256'],sha(stdout));self.assertEqual(last['stderrSha256'],sha(stderr));self.assertEqual(last['knownErrorCategories'],['AccessDenied'])
  allowed={'at','cliPhase','cliPid','cliStartedAt','stdoutBytes','stderrBytes','stdoutSha256','stderrSha256','knownErrorCategories','InvokeId','RequestId','exitCode'}
  for record in self.observations():self.assertLessEqual(set(record),allowed)
 def test_unsafe_ids_are_not_persisted(self):
  result=self.invoke(case='unsafe-request');self.assertEqual(result[0],0);self.assertNotIn('RequestId',json.loads((self.out/'fourth-label-submit.json').read_text()));self.assert_no_secret(result)
  self.reset();result=self.invoke(case='invalid-invoke');self.assertEqual(result[0],2);self.assertFalse((self.out/'fourth-label-submit.json').exists());self.assert_no_secret(result)
 def test_preexisting_receipt_and_success_are_never_overwritten(self):
  self.write_json(self.out/'fourth-label-submit.json',{'InvokeId':INVOKE});success=self.out/'fourth-label-success.json';self.write_json(success,{'verified':'synthetic-existing-success'})
  before={p.name:p.read_bytes() for p in self.out.iterdir()};result=self.invoke();self.assertEqual(result[0],2);self.assertFalse(self.calls())
  self.assertTrue(all((self.out/name).read_bytes()==raw for name,raw in before.items()))
  result=self.invoke(mode='query',case='rejected');self.assertEqual(result[0],2);self.assertTrue(all((self.out/name).read_bytes()==raw for name,raw in before.items()));self.assert_no_secret(result)
 def test_receipt_collision_is_exclusive_and_existing_receipt_survives(self):
  p=self.launch(case='split-json');self.until(lambda:any(e.get('stdoutBytes',0)>0 for e in self.observations()))
  receipt=self.out/'fourth-label-submit.json';self.write_json(receipt,{'InvokeId':'t-existing456','synthetic':'existing-result'})
  before=receipt.read_bytes();result=self.finish(p);self.assertEqual(result[0],2);self.assertEqual(receipt.read_bytes(),before);self.assert_no_secret(result)
 def test_concurrent_labels_only_start_one_cli(self):
  first=self.launch(label='label-one',entry='owner-one.py',case='receipt-hang',timeout=.6)
  second=self.launch(label='label-two',entry='owner-two.py',case='receipt-hang',timeout=.6)
  results=[self.finish(first),self.finish(second)];self.assertEqual(len(self.calls()),1)
  self.assertEqual(len(list(self.out.glob('operation-*.json'))),1);self.assertEqual(len(list(self.out.glob('*-intent.json'))),1)
  self.assertEqual(len(list(self.out.glob('*-submit.json'))),1)
  self.assertEqual({r['state'] for r in self.errors()},{'SUBMISSION_BLOCKED_BEFORE_CALL','SUBMITTED_RECEIPT_SAVED_CLI_ERROR'})
  for result in results:self.assert_no_secret(result)
 def test_query_requires_known_valid_invoke_and_keeps_base64_decode(self):
  result=self.invoke(mode='query',label='missing');self.assertEqual(result[0],2);self.assertFalse(self.calls())
  self.write_json(self.out/'invalid-submit.json',{'InvokeId':SECRET});result=self.invoke(mode='query',label='invalid');self.assertEqual(result[0],2);self.assertFalse(self.calls());self.assertNotIn(SECRET,result[1])
  self.write_json(self.out/'known-submit.json',{'InvokeId':INVOKE});self.assertEqual(self.invoke(mode='query',label='known')[0],0)
  result=json.loads((self.out/'known-success.json').read_text());self.assertEqual(result['decodedOutput'],'{"readOnly":true}');self.assertEqual(base64.b64decode(result['result']['Output']).decode(),result['decodedOutput'])

if __name__=='__main__':unittest.main(verbosity=2)
