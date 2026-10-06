"""Real child processes and local fixtures; production paths are never accessed."""
import base64,copy,hashlib,importlib.util,json,os,selectors,signal,stat,subprocess,sys,tempfile,unittest
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('builder',HERE/'build_single_file.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
CONTAINER=B.container
R5=(HERE/'bootstrap_continuation.py').read_text()
R4=(HERE.parent/'r4/fence_module.py').read_text()
ARCHIVE=(HERE.parents[1]/'bootstrap.tar.gz').read_bytes()
PART_DATA=[ARCHIVE[i:i+6500] for i in range(0,len(ARCHIVE),6500)]
NONCE='749339f6066e43fe8ed0110650f17c35'

def forbid_network(event,args):
    if event.startswith('socket.'):
        raise RuntimeError('OFFLINE_NETWORK_FORBIDDEN')
sys.addaudithook(forbid_network)

def load(parent):
    parent=Path(parent)
    assert parent.is_absolute() and parent.is_relative_to(HERE)
    assert B.sha(CONTAINER)==B.C_SHA
    c={'__name__':'_candidate','VERIFIED_CONTAINER_SHA256':B.C_SHA,'VERIFIED_CONTAINER_BYTES':B.C_BYTES}
    exec(compile(CONTAINER,'<pinned-container>','exec'),c)
    f=c['FENCE_MODULE'];f['PARENT']=parent;f['TRUSTED_UID']=os.geteuid()
    return c,f

def pause_at(phase):
    source,filename=(R4,'<pinned-r4>') if phase=='PHASE_AFTER_EXCLUSIVE_OPEN' else (R5,'<pinned-r5>')
    lines=[i for i,line in enumerate(source.splitlines(),1) if '# '+phase in line]
    assert len(lines)==1,(phase,lines)
    fired=False
    def trace(frame,event,arg):
        nonlocal fired
        if not fired and event=='line' and frame.f_code.co_filename==filename and frame.f_lineno==lines[0]:
            fired=True;os.write(2,b'BARRIER_READY\n');os.kill(os.getpid(),signal.SIGSTOP)
        return trace
    sys.settrace(trace)

def child(op,request):
    c,f=load(request['parent'])
    if request.get('pause'):pause_at(request['pause'])
    if request.get('missing_source'):c.pop('VERIFIED_MODULE_SHA256')
    try:
        if op=='fence':
            if request.get('absent'):
                fds,chain=f['open_chain'](f['PARENT'].parent)
                for fd in reversed(fds):os.close(fd)
                result=f['create_fence'](None,NONCE,chain)
            else:result=f['create_fence'](f['parent_snapshot'](),NONCE)
        elif op=='install':result=c['install_module'](request['fence'],CONTAINER)
        elif op=='append':
            receipts=request.get('receipts',[]);data=PART_DATA[len(receipts)]
            if request.get('bad_data'):data=bytes([data[0]^1])+data[1:]
            result=c['append_next_part'](request['binding'],receipts,data,request.get('nonce',f'{len(receipts)+1:032x}'))
        elif op=='verify':result=c['verify_stage'](request['binding'],request.get('receipts',[]))
        elif op=='unpack':result=c['unpack_bootstrap'](request['binding'],request['receipts'],'1'*32)
        elif op=='verify-unpacked':result=c['verify_unpacked'](request['binding'],request['receipts'],request['unpack'])
        elif op=='original-verify':result=f['verify_fence'](request['fence'])
        else:raise RuntimeError('BAD_OP')
        print(json.dumps(result),flush=True)
    except Exception as exc:
        print(json.dumps({'error':str(exc),'type':type(exc).__name__}),flush=True);sys.exit(3)

class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='fixture-',dir=HERE)
        self.root=Path(self.tmp.name);self.parent=self.root/'paired';self.parent.mkdir(mode=0o700)
        self.target=self.parent/'sanofi-pair-20261006T0057Z';self.processes=[]
        self.fence=None;self.binding=None;self.receipts=[];self.fence=self.run_op('fence')
    def tearDown(self):
        for p in self.processes:
            if p.poll() is None:p.kill()
            p.communicate(timeout=5)
        self.tmp.cleanup()
    def start(self,op,pause=None,**extra):
        request={'parent':str(self.parent),'fence':self.fence,'binding':self.binding,'receipts':self.receipts,**extra}
        if pause:request['pause']=pause
        p=subprocess.Popen([sys.executable,str(Path(__file__)),'--child',op,json.dumps(request)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        self.processes.append(p)
        if pause:
            with selectors.DefaultSelector() as sel:
                sel.register(p.stderr,selectors.EVENT_READ);self.assertTrue(sel.select(5),'barrier timeout');self.assertEqual(p.stderr.readline(),b'BARRIER_READY\n')
            _,status=os.waitpid(p.pid,os.WUNTRACED);self.assertTrue(os.WIFSTOPPED(status))
        return p
    def result(self,p,expected=0):
        out,err=p.communicate(timeout=10);self.assertEqual(p.returncode,expected,(out,err))
        return json.loads(out) if out else None
    def run_op(self,op,expected=0,**extra):return self.result(self.start(op,**extra),expected)
    def resume(self,p,expected=0):p.send_signal(signal.SIGCONT);return self.result(p,expected)
    def install(self):self.binding=self.run_op('install');return self.binding
    def append(self):
        result=self.run_op('append');self.receipts.append(result);return result
    def complete(self):
        self.install()
        for _ in PART_DATA:self.append()
    def test_end_to_end_exact_eleven_parts_archive_and_five_members(self):
        self.complete();result=self.run_op('verify');self.assertEqual(result['archiveSha256'],B.sha(ARCHIVE))
        self.assertEqual(b''.join((self.target/f'bootstrap.part{i:03d}').read_bytes() for i in range(11)),ARCHIVE)
        unpack=self.run_op('unpack');verified=self.run_op('verify-unpacked',unpack=unpack)
        self.assertEqual(verified['state'],'BOOTSTRAP_UNPACK_VERIFIED');self.assertEqual(len(verified['members']),5)
        self.assertEqual(self.target.stat().st_ino,self.fence['marker']['targetIdentity'][1])
        for name in ('BOOTSTRAP_FENCE.json','BOOTSTRAP_FENCE.sha256'):
            self.assertEqual((self.target/name).stat().st_ino,self.binding['markerIdentities'][name][1])
        self.run_op('original-verify',3);self.run_op('verify',3)
    def test_module_exclusive_duplicate_never_overwrites(self):
        self.install();before=(self.target/'BOOTSTRAP_CONTINUATION_R5.py').read_bytes();self.run_op('install',3)
        self.assertEqual((self.target/'BOOTSTRAP_CONTINUATION_R5.py').read_bytes(),before)
    def test_module_install_missing_source_fails_before_new_file(self):
        self.run_op('install',3,missing_source=True);self.assertEqual(len(os.listdir(self.target)),2)
    def test_module_partial_write_is_unknown_not_adopted(self):
        p=self.start('install','PHASE_AFTER_EXCLUSIVE_OPEN');p.kill();self.result(p,-signal.SIGKILL)
        self.assertEqual((self.target/'BOOTSTRAP_CONTINUATION_R5.py').read_bytes(),b'');self.run_op('install',3)
        self.run_op('verify',3,binding={'state':'UNKNOWN'})
    def test_module_lost_receipt_is_unknown_not_adopted(self):
        p=self.start('install','PHASE_BEFORE_MODULE_RECEIPT');p.kill();self.result(p,-signal.SIGKILL)
        self.assertEqual((self.target/'BOOTSTRAP_CONTINUATION_R5.py').read_bytes(),CONTAINER);self.run_op('install',3)
    def test_module_symlink_preexists_untouched(self):
        other=self.root/'other';other.write_bytes(b'preserve');(self.target/'BOOTSTRAP_CONTINUATION_R5.py').symlink_to(other)
        self.run_op('install',3);self.assertEqual(other.read_bytes(),b'preserve')
    def test_module_wrong_hash_blocks_append(self):
        self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';b=p.read_bytes();p.write_bytes(b[:-1]+bytes([b[-1]^1]))
        self.run_op('append',3);self.assertFalse((self.target/'bootstrap.part000').exists())
    def test_module_same_bytes_replacement_inode_blocks_append(self):
        self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';p.rename(self.root/'saved');p.write_bytes(CONTAINER);p.chmod(0o600)
        failure=self.run_op('append',3);self.assertIn('FILE_IDENTITY_CHANGED',failure['error'])
    def test_marker_same_bytes_replacement_inode_blocks_append(self):
        self.install();p=self.target/'BOOTSTRAP_FENCE.json';raw=p.read_bytes();p.rename(self.root/'saved');p.write_bytes(raw);p.chmod(0o600)
        self.run_op('append',3);self.assertFalse((self.target/'bootstrap.part000').exists())
    def test_unknown_extra_file_is_preserved_and_blocks(self):
        self.install();p=self.target/'unknown';p.write_bytes(b'do not adopt');self.run_op('append',3);self.assertEqual(p.read_bytes(),b'do not adopt')
    def test_wrong_data_rejected_before_write(self):
        self.install();self.run_op('append',3,bad_data=True);self.assertFalse((self.target/'bootstrap.part000').exists())
    def test_part_partial_and_lost_receipt_are_never_repaired(self):
        self.install();p=self.start('append','PHASE_AFTER_EXCLUSIVE_OPEN');p.kill();self.result(p,-signal.SIGKILL)
        self.assertEqual((self.target/'bootstrap.part000').read_bytes(),b'');self.run_op('append',3);self.assertEqual((self.target/'bootstrap.part000').read_bytes(),b'')
    def test_part_lost_receipt_is_not_recovered_from_matching_hash(self):
        self.install();p=self.start('append','PHASE_BEFORE_RECEIPT');p.kill();self.result(p,-signal.SIGKILL)
        self.assertEqual((self.target/'bootstrap.part000').read_bytes(),PART_DATA[0]);self.run_op('append',3);self.run_op('verify',3)
    def test_unknown_receipt_and_reused_nonce_rejected(self):
        self.install();self.run_op('append',3,receipts=[{'state':'UNKNOWN'}]);self.append()
        self.run_op('append',3,nonce=self.receipts[0]['operationNonce']);self.assertFalse((self.target/'bootstrap.part001').exists())
    def test_success_history_tampering_rejected(self):
        self.install();self.append();bad=copy.deepcopy(self.receipts);bad[0]['previousReceiptSha256']='0'*64
        self.run_op('append',3,receipts=bad)
    def test_concurrent_same_part_only_one_wins(self):
        self.install();procs=[self.start('append','PHASE_BEFORE_PART') for _ in range(3)]
        for p in procs:p.send_signal(signal.SIGCONT)
        values=[p.communicate(timeout=10) for p in procs]
        self.assertEqual(sum(p.returncode==0 for p in procs),1,values);self.assertEqual(sum(p.returncode==3 for p in procs),2,values)
    def test_parent_replacement_before_write_fails_and_leaves_displaced_part(self):
        self.install();p=self.start('append','PHASE_BEFORE_PART');displaced=self.root/'displaced';self.parent.rename(displaced);self.parent.mkdir(mode=0o700)
        self.resume(p,3);self.assertEqual(os.listdir(self.parent),[])
        self.assertEqual((displaced/self.target.name/'bootstrap.part000').read_bytes(),PART_DATA[0])
    def test_release_replacement_before_write_fails(self):
        self.install();p=self.start('append','PHASE_BEFORE_PART');displaced=self.parent/'displaced';self.target.rename(displaced);self.target.mkdir(mode=0o700)
        self.resume(p,3);self.assertEqual(os.listdir(self.target),[]);self.assertEqual((displaced/'bootstrap.part000').read_bytes(),PART_DATA[0])
    def test_part_wrong_hash_and_same_bytes_replacement_are_rejected(self):
        self.install();self.append();p=self.target/'bootstrap.part000';p.write_bytes(bytes([PART_DATA[0][0]^1])+PART_DATA[0][1:]);self.run_op('verify',3)
        p.rename(self.root/'saved');p.write_bytes(PART_DATA[0]);p.chmod(0o600);self.run_op('verify',3)
    def test_fifo_is_nonblocking_rejected(self):
        self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';p.unlink();os.mkfifo(p,0o600)
        proc=self.start('verify');out,err=proc.communicate(timeout=2);self.assertEqual(proc.returncode,3,(out,err))
    def test_wrong_module_mode_not_repaired(self):
        self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';p.chmod(0o644);self.run_op('append',3);self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)
    def test_unpack_incomplete_rejected(self):
        self.install();self.append();self.run_op('unpack',3);self.assertFalse((self.target/'bootstrap-unpack-intent.json').exists())
    def test_unpack_intent_without_members_is_unknown_no_repair(self):
        self.complete();p=self.start('unpack','PHASE_BEFORE_UNPACK_MEMBER');p.kill();self.result(p,-signal.SIGKILL)
        before={n:(self.target/n).read_bytes() for n in os.listdir(self.target)};self.run_op('unpack',3)
        self.assertEqual(before,{n:(self.target/n).read_bytes() for n in os.listdir(self.target)})
    def test_unpack_lost_receipt_and_duplicate_do_not_adopt(self):
        self.complete();p=self.start('unpack','PHASE_BEFORE_UNPACK_RECEIPT');p.kill();self.result(p,-signal.SIGKILL)
        self.run_op('unpack',3);self.run_op('verify-unpacked',3,unpack={'state':'UNKNOWN'})
    def test_source_and_container_hash_bindings_precede_write(self):
        self.install();self.run_op('append',3,missing_source=True);self.assertFalse((self.target/'bootstrap.part000').exists())


    def test_absent_parent_end_to_end_retains_same_directory_and_markers(self):
        self.parent=self.root/'initially-absent';self.target=self.parent/'sanofi-pair-20261006T0057Z'
        self.fence=self.run_op('fence',absent=True);self.assertTrue(self.fence['marker']['parentCreated'])
        self.complete();unpack=self.run_op('unpack');self.run_op('verify-unpacked',unpack=unpack)
        self.assertEqual(self.parent.stat().st_ino,self.fence['marker']['parentChain'][-1][1])
        self.assertEqual(self.target.stat().st_ino,self.fence['marker']['targetIdentity'][1])
    def test_unpack_partial_existing_member_is_never_overwritten(self):
        self.complete();proc=self.start('unpack','PHASE_BEFORE_UNPACK_MEMBER')
        member=self.target/'baseline.json';member.write_bytes(b'partial');member.chmod(0o600)
        self.resume(proc,3);self.assertEqual(member.read_bytes(),b'partial')
        self.run_op('unpack',3);self.assertEqual(member.read_bytes(),b'partial')
        self.assertFalse((self.target/'bootstrap-unpack-result.json').exists())
    def test_completed_unpack_member_corruption_invalidates_readback(self):
        self.complete();unpack=self.run_op('unpack');p=self.target/'baseline.json';data=p.read_bytes()
        p.write_bytes(bytes([data[0]^1])+data[1:]);self.run_op('verify-unpacked',3,unpack=unpack)
        self.run_op('unpack',3);self.assertEqual(p.read_bytes(),bytes([data[0]^1])+data[1:])

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--child':child(sys.argv[2],json.loads(sys.argv[3]))
    else:unittest.main(verbosity=2)
