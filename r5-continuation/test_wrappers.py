"""Run generated stdin shell commands only after explicit local path/UID injection."""
import ast,base64,hashlib,importlib.util,json,os,stat,subprocess,tempfile,unittest,zlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('harness',HERE/'test_continuation.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
B=H.B

class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='fixture-shell-',dir=HERE);self.root=Path(self.tmp.name)
        self.parent=self.root/"paired ' $ ` ;";self.parent.mkdir(mode=0o700)
        self.c,self.f=H.load(self.parent);self.target=self.parent/self.f['RELEASE']
        self.fence=self.f['create_fence'](self.f['parent_snapshot'](),H.NONCE)
    def tearDown(self):self.tmp.cleanup()
    def localize(self,payload):
        call="exec(compile(s,'<pinned-container>','exec'),m)" if "exec(compile(s,'<pinned-container>','exec'),m)" in payload else "exec(compile(raw,'<pinned-container>','exec'),m)"
        self.assertEqual(payload.count(call),1)
        injection="\nm['FENCE_MODULE']['PARENT']=m['FENCE_MODULE']['Path']("+repr(str(self.parent))+")\nm['FENCE_MODULE']['TRUSTED_UID']="+str(os.geteuid())
        payload=payload.replace(call,call+injection)
        payload=payload.replace("for n in ('opt','jobfinder-paired',r['release']):", "for n in "+repr(tuple(self.parent.parts[1:])+(self.f['RELEASE'],))+":")
        payload=payload.replace('s.st_uid==0','s.st_uid=='+str(os.geteuid()))
        return payload
    def run_shell(self,payload,success=True,optimize=None):
        env=dict(os.environ)
        if optimize is not None:env['PYTHONOPTIMIZE']=str(optimize)
        proc=subprocess.run(['/bin/sh'],input=payload.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env=env)
        if success:
            self.assertEqual(proc.returncode,0,(proc.stdout,proc.stderr));return json.loads(proc.stdout)
        self.assertNotEqual(proc.returncode,0,proc.stdout);return proc.stderr.decode()
    def install(self):return self.run_shell(self.localize(B.render_install(self.fence)))
    def test_generated_shell_complete_flow_and_exact_real_payload_sizes(self):
        binding=self.install();receipts=[];sizes={'install':len(B.render_install(self.fence).encode())}
        for i,data in enumerate(H.PART_DATA):
            payload=B.render_call(binding,receipts,'append_next_part',data,f'{i+1:032x}')
            sizes[f'append-{i}']=len(payload.encode());self.assertLessEqual(len(payload.encode()),12288)
            receipts.append(self.run_shell(self.localize(payload)))
        self.assertEqual(self.run_shell(self.localize(B.render_call(binding,receipts,'verify_stage')))['archiveSha256'],B.sha(H.ARCHIVE))
        unpack=self.run_shell(self.localize(B.render_call(binding,receipts,'unpack_bootstrap',nonce='1'*32)))
        read=B.render_call(binding,receipts,'verify_unpacked',unpack_receipt=unpack)
        sizes['read-unpacked']=len(read.encode());self.assertLessEqual(len(read.encode()),12288)
        self.assertEqual(self.run_shell(self.localize(read))['state'],'BOOTSTRAP_UNPACK_VERIFIED')
        (HERE/'actual-fixture-payload-sizes.json').write_text(json.dumps({'fixtureOnly':True,'sourceBytesUnchanged':True,'measurementsExcludeTestInjection':True,'bytes':sizes},indent=2)+'\n')
    def test_module_wrong_hash_is_rejected_before_exec(self):
        binding=self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';raw=p.read_bytes();p.write_bytes(raw[:-1]+bytes([raw[-1]^1]))
        self.run_shell(self.localize(B.render_call(binding,[],'append_next_part',H.PART_DATA[0],'0'*31+'1')),False)
        self.assertFalse((self.target/'bootstrap.part000').exists())
    def test_module_fifo_is_rejected_without_blocking(self):
        binding=self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';p.unlink();os.mkfifo(p,0o600)
        self.run_shell(self.localize(B.render_call(binding,[],'verify_stage')),False)
    def test_module_wrong_permissions_are_rejected_unchanged(self):
        binding=self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';p.chmod(0o644)
        self.run_shell(self.localize(B.render_call(binding,[],'verify_stage')),False)
        self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)
    def test_synthetic_wrong_parent_identity_rejected_before_module_exec(self):
        binding=self.install();binding['fenceReceipt']['marker']['parentChain'][-1][1]+=1
        self.run_shell(self.localize(B.render_call(binding,[],'verify_stage')),False)
    def test_unknown_receipt_never_becomes_success(self):
        binding=self.install();self.run_shell(self.localize(B.render_call(binding,[{'state':'UNKNOWN'}],'verify_stage')),False)
    def test_base85_full_alphabet_shell_literal_roundtrip(self):
        raw=bytes(range(256))*26;encoded=base64.b85encode(raw).decode()
        self.assertIn('$',encoded);self.assertIn('`',encoded);self.assertIn(';',encoded)
        payload="#!/bin/sh\nset -eu\npython3 - <<'PY'\nimport base64,hashlib,json\ns="+repr(encoded)+"\nb=base64.b85decode(s)\nprint(json.dumps({'sha256':hashlib.sha256(b).hexdigest()}))\nPY\n"
        result=self.run_shell(payload);self.assertEqual(result['sha256'],hashlib.sha256(raw).hexdigest())
        for data in H.PART_DATA:self.assertEqual(base64.b85decode(base64.b85encode(data)),data)
    def test_complete_payload_gate_is_hard(self):
        with self.assertRaisesRegex(RuntimeError,'PAYLOAD_SIZE_EXCEEDS_12288'):
            B.shell('x='+repr('a'*12300))


    def test_generated_execution_gates_have_no_assert_nodes(self):
        for payload in (B.render_install(self.fence),B.render_call({'fenceReceipt':self.fence},[],'verify_stage')):
            body=payload.split("exec python3 - <<'PY'\n",1)[1].rsplit('\nPY\n',1)[0]
            self.assertFalse(any(isinstance(n,ast.Assert) for n in ast.walk(ast.parse(body))))
    def test_optimized_install_rejects_wrong_compressed_and_source_hash_before_write(self):
        packed_sha=hashlib.sha256(zlib.compress(B.container,9)).hexdigest()
        for level in (1,2):
            for bad_hash in (packed_sha,B.C_SHA):
                with self.subTest(level=level,gate=bad_hash):
                    payload=self.localize(B.render_install(self.fence)).replace(repr(bad_hash),repr('0'*64),1)
                    self.assertIn('GATE',self.run_shell(payload,False,optimize=level))
                    self.assertFalse((self.target/'BOOTSTRAP_CONTINUATION_R5.py').exists())
    def test_optimized_module_hash_rejects_malicious_same_length_before_exec(self):
        binding=self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py';sentinel=self.root/'MUST_NOT_EXIST'
        malicious=("open("+repr(str(sentinel))+",'w').write('executed')\n").encode()
        p.write_bytes(malicious+b' '*(B.C_BYTES-len(malicious)))
        for level in (1,2):
            self.assertIn('GATE',self.run_shell(self.localize(B.render_call(binding,[],'verify_stage')),False,optimize=level))
            self.assertFalse(sentinel.exists())
    def test_optimized_type_mode_and_identity_gates_reject_before_exec(self):
        binding=self.install();p=self.target/'BOOTSTRAP_CONTINUATION_R5.py'
        for level in (1,2):
            payload=self.localize(B.render_call(binding,[],'verify_stage'))
            p.chmod(0o644)
            self.assertIn('GATE',self.run_shell(payload,False,optimize=level));p.chmod(0o600)
            bad=json.loads(json.dumps(binding));bad['moduleFile']['identity'][2]+=1
            self.assertIn('GATE',self.run_shell(self.localize(B.render_call(bad,[],'verify_stage')),False,optimize=level))
        p.unlink();os.mkfifo(p,0o600)
        for level in (1,2):self.assertIn('GATE',self.run_shell(self.localize(B.render_call(binding,[],'verify_stage')),False,optimize=level))
    def test_optimized_builder_rejects_wrong_frozen_r4_source(self):
        folder=self.root/'builder-fixture';folder.mkdir();(folder/'r4').mkdir();(folder/'r5').mkdir()
        (folder/'r4/fence_module.py').write_bytes(b'changed frozen input')
        path=folder/'r5/build_single_file.py';path.write_bytes((HERE/'build_single_file.py').read_bytes())
        for level in (1,2):
            env=dict(os.environ,PYTHONOPTIMIZE=str(level))
            proc=subprocess.run(['python3',str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=5)
            self.assertNotEqual(proc.returncode,0);self.assertIn(b'FROZEN_R4_SOURCE_CHANGED',proc.stderr)
            self.assertFalse((folder/'r5/BOOTSTRAP_CONTINUATION_R5.py').exists())

if __name__=='__main__':unittest.main(verbosity=2)
