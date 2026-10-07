"""Review only newly generated synthetic fixtures. Real wall clock and unchanged expiry."""
from pathlib import Path
import hashlib,json,subprocess,sys,datetime,re
S=Path(__file__).resolve().parent
(S/'runtime-evidence').mkdir(exist_ok=True,mode=0o700)
R=Path('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z')
SAFE=S/'reviewer-source'
run_name=sys.argv[1];assert re.fullmatch(r'[a-z][a-z0-9-]*',run_name)
label=sys.argv[2] if len(sys.argv)>2 else run_name;assert re.fullmatch(r'[a-z][a-z0-9-]*',label)
payload=S/run_name/'payload';out=S/'runtime-evidence'/('review-'+label);out.mkdir(mode=0o700)
node=R/'runtime/node-v22.23.3-linux-x64/bin/node'
env={'PATH':str(node.parent)+':/usr/bin:/bin','TZ':'UTC','PYTHONDONTWRITEBYTECODE':'1','NODE_OPTIONS':'--require '+str(S/'src/network-deny.cjs'),'TSX_DISABLE_CACHE':'1','NODE_DISABLE_COMPILE_CACHE':'1'}
sha=lambda raw:hashlib.sha256(raw).hexdigest()
results=[];provenance=[]
expected={'astra':'82bbf680f3dfbbb4ce7c6be20803a94feb510b650433a60031cd04240c70fd4a','amgen':'baa95c5997c7142b164895fa1ecfe6cab396fefd8623625e3a0398d06c70c254'}
for key in ['astra','amgen']:
    fixture=json.loads((payload/key/'fixture.json').read_text());assert fixture['classification']=='NEW_SYNTHETIC_CODE_AND_SEED_ONLY'
    assert fixture['syntheticControl']['candidate']['id']=='synthetic-deterministic-true-a-reviewer-v1'
    source=SAFE/key;mirror=out/'reviewer-source'/key;mirror.mkdir(parents=True,mode=0o700)
    for name in ['review-publication.py','machine-json.py','review-packet-envelope.mts']:
        raw=(source/name).read_bytes()
        if name=='review-publication.py':assert sha(raw)==expected[key]
        text=raw.decode()
        # Only TS import locations change in a test copy; decoder/reviewer function bytes stay intact.
        if name=='review-packet-envelope.mts':text=text.replace('../../../..//producer/',str(R/'producer')+'/').replace('../../../../producer/',str(R/'producer')+'/')
        (mirror/name).write_text(text)
        provenance.append({'sourceKey':key,'name':name,'originalSha256':sha(raw),'testCopySha256':sha(text.encode()),'adaptation':'TS import relocation only' if name.endswith('.mts') else 'BYTE_IDENTICAL'})
    original=json.loads((payload/key/'publish-request.json').read_text())
    cutoff=datetime.datetime.fromisoformat(original['payload']['dispatchBefore'].replace('Z','+00:00'))
    if datetime.datetime.now(datetime.timezone.utc)>=cutoff:raise SystemExit('FIXED_SYNTHETIC_FIXTURE_EXPIRED; do not extend it or claim a positive fresh review')
    for variant in ['valid','bad-request-hash','expired-request','missing-archive']:
        host=out/key/variant;run=host/fixture['batchId'];relay=run/'relay';artifacts=run/'artifacts';relay.mkdir(parents=True,mode=0o700);artifacts.mkdir(mode=0o700)
        control=fixture['syntheticControl']
        cfg={'root':str(host),'repo':str(R/'producer'),'node':str(node),'project':control['projectId'],'sourceId':fixture['sourceId'],'sourceConfigSha256':fixture['sourceConfigSha256'],'classification':'NEW_SYNTHETIC_CODE_AND_SEED_ONLY'}
        (host/'host-config.json').write_text(json.dumps(cfg));(host/'control-base.json').write_text(json.dumps(control))
        (host/'activation.json').write_text(json.dumps({'status':'REGISTERED_VERIFIED','candidate':control['candidate'],'build':control['build'],'databaseIdentity':control['databaseIdentity'],'classification':'SYNTHETIC_TEST_INPUT_NOT_REGISTERED_ANYWHERE'}))
        request=json.loads(json.dumps(original))
        if variant=='bad-request-hash':request['requestSha256']='0'*64
        if variant=='expired-request':
            request['expiresAt']='2000-01-01T00:00:00.000Z';body={k:v for k,v in request.items() if k!='requestSha256'}
            request['requestSha256']=sha(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode())
        path=relay/(request['requestId']+'.request.json');path.write_text(json.dumps(request,ensure_ascii=False,separators=(',',':')))
        (relay/(request['requestId']+'.request.json.sql')).write_text(request['payload']['sql'])
        if variant!='missing-archive':(artifacts/(fixture['batchId']+'.archive.json')).write_bytes((payload/key/'archive.json').read_bytes())
        process=subprocess.run([sys.executable,str(mirror/'review-publication.py'),str(host),str(run),request['requestId']],cwd=R/'producer',env=dict(env,JOBFINDER_CLOUD_SOURCE_ID=fixture['sourceId']),capture_output=True,text=True)
        (host/'reviewer-exec.json').write_text(json.dumps({'exitCode':process.returncode,'stdout':process.stdout,'stderr':process.stderr},indent=2))
        assert (process.returncode==0)==(variant=='valid'),(key,variant,process.stderr)
        gate='ACCEPTED'
        if variant=='bad-request-hash':
            diagnostic=[json.loads(line) for line in (run/'packet-machine-diagnostics.jsonl').read_text().splitlines()]
            assert any('HOST_PUBLICATION_REQUEST_HASH' in item.get('stderr','') for item in diagnostic)
            gate='HOST_PUBLICATION_REQUEST_HASH'
        elif variant=='expired-request':
            assert "assert now<datetime.datetime.fromisoformat(request['expiresAt']" in process.stderr
            gate='ORIGINAL_REQUEST_EXPIRY_ASSERTION'
        elif variant=='missing-archive':
            assert 'assert a.is_file()' in process.stderr
            gate='ORIGINAL_ARCHIVE_FILE_REQUIRED_ASSERTION'
        results.append({'sourceKey':key,'variant':variant,'accepted':process.returncode==0,'expectedAccepted':variant=='valid','confirmedGate':gate,'pass':True})
report={'classification':'NEW_SYNTHETIC_REVIEWER_CHECKS_WITH_REAL_WALL_CLOCK','reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resultCount':len(results),'passed':all(x['pass'] for x in results),'results':results,'reviewerProvenance':provenance,'originalProductionReviewerLogicChanged':False,'sqlExecutedByReviewer':False,'productionBindingOrRunRead':False,'pythonClockMocked':False,'packetExpiryExtended':False,'networkGuardInheritedByNodeChildren':True,'runtimeDiagnosticsExcludedFromDeterministicPayload':True}
(out/'SUMMARY.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':'PASS','checks':len(results),'report':str(out/'SUMMARY.json')}))
