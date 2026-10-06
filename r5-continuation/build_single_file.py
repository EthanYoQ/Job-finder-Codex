"""Local rendering/size validation only. No server call or generated command execution."""
from pathlib import Path
import ast,base64,hashlib,json,zlib

HERE=Path(__file__).resolve().parent
R4=HERE.parent/'r4'
sha=lambda b:hashlib.sha256(b).hexdigest()
canon=lambda v:json.dumps(v,sort_keys=True,separators=(',',':')).encode()
four=(R4/'fence_module.py').read_bytes()
if sha(four)!='d420bd7bb06bc1f4303f24433054ae203f2228532b5acb20ffe86e38bed37d5a':
    raise RuntimeError('FROZEN_R4_SOURCE_CHANGED')
five=(HERE/'bootstrap_continuation.py').read_bytes()
container=(f"FENCE_MODULE={{'__name__':'_fence','VERIFIED_MODULE_SHA256':{sha(four)!r}}}\n"
           f"exec(compile({four.decode()!r},'<pinned-r4>','exec'),FENCE_MODULE)\n"
           f"VERIFIED_MODULE_SHA256={sha(five)!r}\n"
           f"exec(compile({five.decode()!r},'<pinned-r5>','exec'),globals())\n").encode()
compile(container,'<candidate-container>','exec')
(HERE/'BOOTSTRAP_CONTINUATION_R5.py').write_bytes(container)
C_SHA=sha(container);C_BYTES=len(container)

def encode(value):
    return base64.b64encode(zlib.compress(canon(value),9)).decode()


def shell(body):
    # Generated gates must survive PYTHONOPTIMIZE and -O/-OO.
    lines=[]
    for line in body.splitlines():
        if line.startswith('assert '):line='ck('+line[7:]+')'
        elif ';assert ' in line:line=line.replace(';assert ',';ck(',1)+')'
        lines.append(line)
    body="def ck(v):\n if not v:raise RuntimeError('GATE')\n"+'\n'.join(lines)
    if any(isinstance(n,ast.Assert) for n in ast.walk(ast.parse(body))):
        raise RuntimeError('UNCONVERTED_ASSERT')
    compile(body,'<size-render-only>','exec')
    payload = "#!/bin/sh\nset -eu\numask 077\nexec python3 - <<'PY'\n"+body+"\nPY\n"
    if len(payload.encode()) > 12288:
        raise RuntimeError("PAYLOAD_SIZE_EXCEEDS_12288: " + str(len(payload.encode())))
    return payload


def render_install(fence_receipt):
    packed=zlib.compress(container,9)
    body='import base64,hashlib,json,zlib\n'
    body+=f"p=base64.b64decode({base64.b64encode(packed).decode()!r},validate=True)\nassert len(p)=={len(packed)} and hashlib.sha256(p).hexdigest()=={sha(packed)!r}\ns=zlib.decompress(p)\nassert len(s)=={C_BYTES} and hashlib.sha256(s).hexdigest()=={C_SHA!r}\n"
    body+=f"m={{'__name__':'_c','VERIFIED_CONTAINER_SHA256':{C_SHA!r},'VERIFIED_CONTAINER_BYTES':{C_BYTES}}}\nexec(compile(s,'<pinned-container>','exec'),m)\nr=json.loads(zlib.decompress(base64.b64decode({encode(fence_receipt)!r},validate=True)))\n"
    body+="print(json.dumps(m['install_module'](r,s),sort_keys=True,separators=(',',':')),flush=True)"
    return shell(body)


def render_call(binding,receipts,action,data=None,nonce=None,unpack_receipt=None):
    if action not in ('append_next_part','verify_stage','unpack_bootstrap','verify_unpacked'):
        raise RuntimeError('UNKNOWN_ACTION')
    state={'binding':binding,'receipts':receipts,'nonce':nonce,'unpackReceipt':unpack_receipt}
    body='import base64,hashlib,json,os,stat,zlib\n'
    body+=f"q=json.loads(zlib.decompress(base64.b64decode({encode(state)!r},validate=True)))\nb=q['binding'];r=b['fenceReceipt']['marker'];f=b['moduleFile']\n"
    body+="D=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC\nfds=[os.open('/',D)]\nfor n in ('opt','jobfinder-paired',r['release']):fds.append(os.open(n,D,dir_fd=fds[-1]))\ndef ident(s):return [s.st_dev,s.st_ino,s.st_uid,stat.S_IMODE(s.st_mode)]\nassert [ident(os.fstat(d)) for d in fds]==r['parentChain']+[r['targetIdentity']]\n"
    body+=f"assert f['name']=='BOOTSTRAP_CONTINUATION_R5.py' and f['bytes']=={C_BYTES} and f['sha256']=={C_SHA!r}\nx=os.open(f['name'],os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fds[-1])\nwith os.fdopen(x,'rb') as t:\n s=os.fstat(t.fileno());assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==f['bytes'] and ident(s)==f['identity']\n raw=t.read(f['bytes']+1)\nassert len(raw)==f['bytes'] and hashlib.sha256(raw).hexdigest()==f['sha256']\nfor d in reversed(fds):os.close(d)\n"
    body+=f"m={{'__name__':'_c','VERIFIED_CONTAINER_SHA256':{C_SHA!r},'VERIFIED_CONTAINER_BYTES':{C_BYTES}}}\nexec(compile(raw,'<pinned-container>','exec'),m)\n"
    if action=='append_next_part':
        body+=f"data=base64.b85decode({base64.b85encode(data).decode()!r})\nout=m[{action!r}](b,q['receipts'],data,q['nonce'])\n"
    elif action=='verify_stage':body+="out=m['verify_stage'](b,q['receipts'])\n"
    elif action=='unpack_bootstrap':body+="out=m['unpack_bootstrap'](b,q['receipts'],q['nonce'])\n"
    else:body+="out=m['verify_unpacked'](b,q['receipts'],q['unpackReceipt'])\n"
    body+="print(json.dumps(out,sort_keys=True,separators=(',',':')),flush=True)"
    return shell(body)


def measurements(high_entropy=False,seed=0x202610060731,quiet=False):
    parts=json.loads((R4/'continuation-parts.json').read_text())['parts']
    archive=(HERE.parents[1]/'bootstrap.tar.gz').read_bytes()
    maximum=2**64-1
    import random
    rng=random.Random(seed)
    integer=lambda: rng.randrange(10**19,2**64)
    device=integer() if high_entropy else maximum
    inode=lambda offset: integer() if high_entropy else maximum-offset
    chain=[[inode(0),inode(0),0,0o755],[device,inode(0),0,0o755],[device,inode(0),0,0o700]]
    marker={'version':1,'release':'sanofi-pair-20261006T0057Z','nonce':'749339f6066e43fe8ed0110650f17c35',
            'oldScriptSha256':'83790ab0a9fcb5f91adab951be4a11649698d5db1f056923d048fcc686617fb7',
            'fenceSourceSha256':sha(four),'parentChain':chain,'targetIdentity':[device,inode(0),0,0o700],'parentCreated':True}
    fr={'state':'FENCE_CREATED','marker':marker,'markerSha256':sha(canon(marker)+b'\n')}
    binding={'state':'CONTINUATION_BOUND','version':1,'continuationSourceSha256':sha(five),
             'fenceModuleSha256':sha(four),'fenceReceipt':fr,
             'markerIdentities':{'BOOTSTRAP_FENCE.json':[device,inode(1),0,0o600],'BOOTSTRAP_FENCE.sha256':[device,inode(2),0,0o600]},
             'moduleFile':{'name':'BOOTSTRAP_CONTINUATION_R5.py','bytes':C_BYTES,'sha256':C_SHA,'identity':[device,inode(3),0,0o600]}}
    out={}
    def record(name,payload):out[name]={'bytes':len(payload.encode()),'sha256':sha(payload.encode()),'fits12288':len(payload.encode())<=12288}
    record('install',render_install(fr));receipts=[]
    for index,spec in enumerate(parts):
        data=archive[index*6500:(index+1)*6500];
        if sha(data)!=spec['sha256']:raise RuntimeError('ORIGINAL_PART_CHANGED')
        nonce=sha(f'nonce-{index}-20261006-{seed}'.encode())[:32] if high_entropy else f'{index+1:032x}'
        record(f'append-{index:03d}',render_call(binding,receipts,'append_next_part',data,nonce))
        receipts.append({'state':'PART_STORED','version':1,'index':index,**{k:spec[k] for k in ('name','bytes','sha256')},
                         'fileIdentity':[device,inode(4+index),0,0o600],'operationNonce':nonce,
                         'bindingSha256':sha(canon(binding)),'previousReceiptSha256':sha(canon(binding if not receipts else receipts[-1])),
                         'continuationSourceSha256':sha(five),'parentChain':chain,'targetIdentity':marker['targetIdentity']})
    record('verify-all-parts',render_call(binding,receipts,'verify_stage'))
    record('unpack',render_call(binding,receipts,'unpack_bootstrap',nonce='1'*32))
    members=ast.literal_eval(next(n.value for n in ast.parse(five) .body if isinstance(n,ast.Assign) and any(isinstance(k,ast.Name) and k.id=='MEMBERS' for k in n.targets)))
    intent={'state':'UNPACK_INTENDED','bindingSha256':sha(canon(binding)),
            'partsReceiptSha256':sha(canon(receipts)),'archiveSha256':sha(archive),
            'operationNonce':'1'*32,'continuationSourceSha256':sha(five)}
    result={'state':'BOOTSTRAP_UNPACKED','bindingSha256':sha(canon(binding)),
            'partsReceiptSha256':sha(canon(receipts)),'archiveSha256':sha(archive),
            'operationNonce':'1'*32,'continuationSourceSha256':sha(five),'intent':intent,
            'intentIdentity':[device,inode(30),0,0o600],
            'files':{name:{**spec,'identity':[device,inode(31+i),0,0o600]} for i,(name,spec) in enumerate(members.items())}}
    unpack_receipt={'state':'UNPACK_RECEIPT','result':result,'resultIdentity':[device,inode(40),0,0o600]}
    record('verify-unpacked',render_call(binding,receipts,'verify_unpacked',unpack_receipt=unpack_receipt))
    report={'state':'SIZED_NOT_RUNTIME_TESTED','highEntropyValidUint64Fixture':high_entropy,'ownerLimitBytes':12288,'containerBytes':C_BYTES,'containerSha256':C_SHA,
            'continuationSourceSha256':sha(five),'allMeasuredCommandsFit':all(v['fits12288'] for v in out.values()),
            'maximumPayloadBytes':max(v['bytes'] for v in out.values()),'commands':out,
            'newRemoteFileProposedOnly':'BOOTSTRAP_CONTINUATION_R5.py root:0600 O_EXCL; not authorized or installed',
            'renderedCommandsExecuted':False,'originalPartsUnchanged':True,'serverRequests':0}
    if not quiet:
        (HERE/('single-file-high-entropy-size-analysis.json' if high_entropy else 'single-file-size-analysis.json')).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({k:v for k,v in report.items() if k!='commands'},indent=2))
    return report

if __name__=='__main__':
    measurements()
    measurements(high_entropy=True)
