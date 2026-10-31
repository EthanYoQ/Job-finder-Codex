"""Offline copied real evidence; no network, live queue edits, or fabricated original responses."""
import ast, hashlib, importlib.util, json, pathlib, re, shutil, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('isolation',HERE/'isolate-pre-capture-read.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ENTRY=(HERE/'run-original-functions.js').read_text(); BEFORE=(HERE/'before-entry.js').read_text()
FOLDERS=ast.literal_eval(re.search(r'const sourceFolders=(\{.*?\});',ENTRY).group(1))
ROUND='round-c52bdb5ae1f54b97908292a2684ffdb4';RID='48a6599c-69f9-4ac1-b93d-d30f5c3cfc23';SOURCE='source-boehringer-ingelheim-china-social'
BATCH='dot-auto-boehringer-ingelheim-20261031T030207002Z';RECOVERY='takeda-original-recovery-20261017T0417Z'
CHECKED='2026-10-31T03:10:00Z' # Offline fixture time, not an official live-state read.
def write(path,value):path.write_text(json.dumps(value,separators=(',',':'))+'\n')
def mutate_request(path,update):
    value=m.read(path);update(value);body={k:v for k,v in value.items() if k!='requestSha256'};value['requestSha256']=m.digest(json.dumps(body,separators=(',',':'),ensure_ascii=False).encode());write(path,value)
    return value

def fixture(root):
    queue=root/'rounds'/ROUND/'connector-host-task/relay';queue.mkdir(parents=True)
    original=ROOT/'rounds'/ROUND/'connector-host-task/relay'
    for p in original.iterdir():
        if p.is_file():shutil.copy2(p,queue/p.name)
    recovery=root/RECOVERY;recovery.mkdir()
    for p in (ROOT/RECOVERY).glob('*/dot-auto-*/relay-checkpoint.json'):
        checkpoint=m.read(p)
        if checkpoint.get('relayDirectory')!=str(original):continue
        run=recovery/p.parent.parent.name/p.parent.name;run.mkdir(parents=True)
        checkpoint['relayDirectory']=str(queue);write(run/'relay-checkpoint.json',checkpoint)
        if checkpoint['sourceId']==SOURCE:
            for name in ('artifacts','diagnostics'):shutil.copytree(p.parent/name,run/name)
    return queue,recovery,recovery/'boehringer-ingelheim'/BATCH

def scan(entry,root,isolated,round_id='',held_queues=None):
    match=re.search(r'q\(("import pathlib,sys,hashlib,uuid(?:\\.|[^"\\])*")\)',entry)
    code=json.loads(match.group(1))
    return subprocess.run(['python3','-c',code,str(root),round_id,json.dumps(isolated),json.dumps(held_queues if held_queues is not None else sorted({str(pathlib.Path(p).parent) for p in isolated}))],capture_output=True,text=True)

class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.queue,self.recovery,self.run=fixture(self.root);self.request=self.queue/(RID+'.request.json')
        self.before={str(p.relative_to(self.root)):m.digest(p.read_bytes()) for p in self.root.rglob('*') if p.is_file()}
    def tearDown(self):self.tmp.cleanup()
    def inspect(self,**kw):return m.inspect(self.root,self.recovery,kw.get('folders',FOLDERS),kw.get('checked',CHECKED))
    def denied(self):
        result=self.inspect();self.assertNotIn(SOURCE,result['holds']);self.assertEqual({},result['isolated']);self.assertNotEqual(0,scan(ENTRY,self.root,result['isolated']).returncode)
    def test_real_bi_read_retains_unknown_and_original_bytes(self):
        result=self.inspect();self.assertEqual('UNKNOWN',result['readOutcome']);self.assertEqual([SOURCE],list(result['holds']));self.assertEqual({str(self.request.relative_to(self.root)):m.digest(self.request.read_bytes())},result['isolated'])
        self.assertNotEqual(0,scan(BEFORE,self.root,{}).returncode);result_scan=scan(ENTRY,self.root,result['isolated']);self.assertEqual(0,result_scan.returncode,result_scan.stderr);self.assertRegex(result_scan.stdout.strip(),r'^round-[0-9a-f]{32}$')
        self.assertFalse((self.queue/(RID+'.response.json')).exists());self.assertEqual(self.before,{str(p.relative_to(self.root)):m.digest(p.read_bytes()) for p in self.root.rglob('*') if p.is_file()})
        self.assertEqual(result,self.inspect()) # Fresh process/session can reconstruct the HOLD without store.
    def test_generic_not_bi_allowlist(self):
        new_source='source-offline-fixture-social';folder='offline-fixture';new_batch='dot-auto-offline-fixture-20261031T030207002Z'
        new_run=self.recovery/folder/new_batch;new_run.parent.mkdir();self.run.rename(new_run)
        cp=m.read(new_run/'relay-checkpoint.json');cp.update(sourceId=new_source,batchId=new_batch);write(new_run/'relay-checkpoint.json',cp)
        failure=next((new_run/'artifacts').iterdir());f=m.read(failure);f.update(sourceId=new_source,batchId=new_batch);write(failure,f)
        req=mutate_request(self.request,lambda r:r['payload'].update(sourceId=new_source));marker=self.queue/(RID+'.dispatch.json');v=m.read(marker);v['requestSha256']=req['requestSha256'];write(marker,v)
        result=self.inspect(folders={**FOLDERS,new_source:folder});self.assertEqual([new_source],list(result['holds']));self.assertEqual(1,len(result['isolated']))
    def test_missing_or_mismatched_terminal(self):
        path=self.run/'diagnostics/process.jsonl';original=path.read_text();events=[json.loads(x) for x in original.splitlines()]
        for mode in ('missing','mismatch','successful'):
            current=json.loads(json.dumps(events))
            if mode=='missing':current=current[:-1]
            elif mode=='mismatch':current[-1]['childPid']+=1
            else:current[-1]['exitCode']=0
            path.write_text('\n'.join(json.dumps(e) for e in current)+'\n');self.denied()
        path.write_text(original)
    def test_not_expired_or_not_precapture_timeout(self):
        self.assertEqual({},self.inspect(checked='2026-10-31T03:04:30Z')['isolated'])
        path=next((self.run/'artifacts').iterdir());value=m.read(path);value['phase']='READ_OUTCOME';write(path,value);self.denied()
    def test_marker_mismatch(self):
        path=self.queue/(RID+'.dispatch.json');value=m.read(path);value['requestSha256']='0'*64;write(path,value);self.denied()
    def test_payload_cannot_carry_sql_or_other_purpose(self):
        original=self.request.read_bytes()
        for update in (lambda r:r['payload'].update(sql='SELECT 1'),lambda r:r['payload'].update(purpose='OTHER'),lambda r:r.update(kind='READ_PUBLICATION_CONTEXT')):
            self.request.write_bytes(original);mutate_request(self.request,update);self.denied()
    def test_responded_publish_in_same_batch_rejects(self):
        rid='eab0eabe-df29-45ad-bd3c-ffabf7f3db41';self.assertTrue((self.queue/(rid+'.response.json')).exists())
        checkpoint=self.run/'relay-checkpoint.json';value=m.read(checkpoint);value['requestIds'].append(rid);write(checkpoint,value);self.denied()
    def test_uncheckpointed_followup_rejects_even_if_responded(self):
        rid='eab0eabe-df29-45ad-bd3c-ffabf7f3db41'
        for path in self.recovery.glob('*/dot-auto-*/relay-checkpoint.json'):
            value=m.read(path)
            if rid in value['requestIds']:value['requestIds'].remove(rid);write(path,value)
        self.assertTrue((self.queue/(rid+'.response.json')).exists());self.denied()
    def test_same_source_second_batch_rejects(self):
        checkpoint=next(self.recovery.glob('bms/dot-auto-*/relay-checkpoint.json'));value=m.read(checkpoint)
        next_run=self.recovery/'boehringer-ingelheim'/'dot-auto-boehringer-ingelheim-20261031T030500000Z';next_run.mkdir()
        value.update(sourceId=SOURCE,batchId=next_run.name);write(next_run/'relay-checkpoint.json',value);checkpoint.unlink()
        result=self.inspect();self.assertEqual('SOURCE_HAS_FOLLOWUP',result['ineligible'][str(self.request.relative_to(self.root))]);self.denied()
    def test_hold_persists_before_exemption_and_survives_response_file(self):
        result=self.inspect();self.assertFalse((self.run/m.HOLD_FILE).exists());m.persist_holds(result['holdReceipts'])
        self.assertEqual(m.read(self.run/m.HOLD_FILE),next(iter(result['holdReceipts'].values())))
        # Deliberately malformed TEMPORARY fixture, not a fabricated real response/outcome.
        (self.queue/(RID+'.response.json')).write_text('INVALID_OFFLINE_RESPONSE_FIXTURE')
        after=self.inspect();self.assertIn(SOURCE,after['holds']);self.assertEqual({},after['isolated']);self.assertEqual(1,len(after['holdReceipts']));blocked=scan(ENTRY,self.root,after['isolated'],ROUND,after['heldQueues']);self.assertNotEqual(0,blocked.returncode);self.assertIn('ISOLATED_READ_REQUIRES_NEW_ROUND',blocked.stderr)
    def test_fsync_failure_is_retried_for_existing_hold(self):
        from unittest.mock import patch
        result=self.inspect();original_fsync=m.os.fsync
        with patch.object(m.os,'fsync',side_effect=OSError('OFFLINE_FSYNC_FAILURE')):
            with self.assertRaises(OSError):m.persist_holds(result['holdReceipts'])
        self.assertTrue((self.run/m.HOLD_FILE).exists())
        retry=self.inspect()
        with patch.object(m.os,'fsync',wraps=original_fsync) as sync:
            m.persist_holds(retry['holdReceipts']);self.assertEqual(2,sync.call_count)
    def test_failed_or_corrupt_hold_persistence_cannot_exempt(self):
        result=self.inspect();(self.run/m.HOLD_FILE).write_text('INVALID_OFFLINE_HOLD_FIXTURE')
        with self.assertRaises(ValueError):m.persist_holds(result['holdReceipts'])
        with self.assertRaises(ValueError):self.inspect()
    def test_actual_archive_resolved_old_reads_not_newly_held(self):
        result=m.inspect(ROOT,ROOT/RECOVERY,FOLDERS,'2026-10-31T03:10:00Z')
        self.assertEqual([SOURCE],list(result['holds']));self.assertEqual(1,len(result['isolated']))
        for round_id,rid in [('round-cc7b391d504d40479ff2aaf224d950e4','f5d728da-1375-42a5-97de-4983698ff3e7'),('round-84b6932ea79643f28a081dc3ae996903','230db20e-e806-4a39-8110-a0cee8477a03')]:
            self.assertTrue((ROOT/'rounds'/round_id/'connector-host-task/relay'/(rid+'.response.json')).exists())
    def test_unknown_write_still_globally_blocks(self):
        result=self.inspect();other=self.root/'rounds/round-' # Separate old queue, not this read's source.
        other=self.root/'rounds/round-00000000000000000000000000000001/connector-host-task/relay';other.mkdir(parents=True)
        original=self.queue/'eab0eabe-df29-45ad-bd3c-ffabf7f3db41.request.json';shutil.copy2(original,other/original.name);(other/original.name.replace('.request.json','.request.ready')).touch()
        result=self.inspect();self.assertIn(SOURCE,result['holds']);blocked=scan(ENTRY,self.root,result['isolated']);self.assertNotEqual(0,blocked.returncode);self.assertIn('PRIOR_ROUND_RECONCILE_ONLY',blocked.stderr)
    def test_orphan_ready_or_modified_read_never_exempted(self):
        (self.queue/'00000000-0000-0000-0000-000000000001.request.ready').touch();self.denied()
        (self.queue/'00000000-0000-0000-0000-000000000001.request.ready').unlink();self.request.write_bytes(self.request.read_bytes()+b' ')
        old_digest=self.before[str(self.request.relative_to(self.root))];self.assertNotEqual(0,scan(ENTRY,self.root,{str(self.request.relative_to(self.root)):old_digest}).returncode)
    def test_selected_isolated_round_requires_fresh_queue(self):
        result=self.inspect();blocked=scan(ENTRY,self.root,result['isolated'],ROUND);self.assertNotEqual(0,blocked.returncode);self.assertIn('ISOLATED_READ_REQUIRES_NEW_ROUND',blocked.stderr)
    def test_actual_entry_integration_and_original_reader(self):
        result=subprocess.run([str(ROOT/'connector-host-runtime/node'),str(HERE/'entry.test.mjs'),str(self.root),str(self.recovery),json.dumps(FOLDERS)],capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr);print(result.stdout.strip())
    def test_unknown_write_rules_and_official_query_unchanged(self):
        def legacy(entry):
            match=re.search(r'q\(("import pathlib,sys,hashlib,uuid(?:\\.|[^"\\])*")\)',entry);tree=ast.parse(json.loads(match.group(1)))
            return next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='retired' for t in node.targets))
        self.assertEqual(legacy(BEFORE),legacy(ENTRY));self.assertEqual(8,len(legacy(ENTRY)))
        self.assertEqual(next(l for l in BEFORE.splitlines() if l.startswith('const states=')),next(l for l in ENTRY.splitlines() if l.startswith('const states=')))

if __name__=='__main__':unittest.main(verbosity=2)
