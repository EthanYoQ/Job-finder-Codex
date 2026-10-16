"""Synthetic filesystem cases against both original template functions and checked()."""
import hashlib,json,os,pathlib,runpy,tempfile,uuid
HOST=pathlib.Path(__file__).resolve().parents[1]
passed=0
for profile in ('templates','biogen'):
    loaded=runpy.run_path(str(HOST/profile/'fixed-preimport-launch.py.in'))
    g=loaded['relay_publication_state'].__globals__
    for scenario in ('complete','no-ready-empty','no-ready-full','ready-only','ready-content','ready-mode','ready-symlink','ready-hardlink','bad-json','bad-hash','orphan-dispatch','temp-only','final-temp','bad-temp-name'):
        root=pathlib.Path(tempfile.mkdtemp(prefix='request-ready-'+profile+'-'))
        relay=root/'relay';relay.mkdir(mode=0o700)
        g['PRIVATE']=root
        rid=str(uuid.uuid4());final=relay/(rid+'.request.json');ready=relay/(rid+'.request.ready')
        body={'schemaVersion':1,'requestId':rid,'kind':'PUBLISH','expiresAt':'2026-10-16T05:00:00.000Z','payload':{}}
        packet={**body,'requestSha256':hashlib.sha256(g['encoded'](body)).hexdigest()}
        def put(p,data):
            fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'wb') as f:f.write(data)
        if scenario not in ('ready-only','temp-only','bad-temp-name'):
            put(final,b'' if scenario=='no-ready-empty' else b'{' if scenario=='bad-json' else g['encoded']({**packet,'requestSha256':'0'*64} if scenario=='bad-hash' else packet))
        if scenario not in ('no-ready-empty','no-ready-full','orphan-dispatch','temp-only','bad-temp-name'):
            if scenario=='ready-symlink':
                other=root/'marker';put(other,b'');ready.symlink_to(other)
            else:put(ready,b'x' if scenario=='ready-content' else b'')
        if scenario=='ready-mode':ready.chmod(0o644)
        if scenario=='ready-hardlink':os.link(ready,root/'marker-link')
        if scenario=='orphan-dispatch':
            put(relay/(rid+'.dispatch.json'),g['encoded']({'schemaVersion':1,'requestId':rid,'requestSha256':packet['requestSha256'],'kind':'PUBLISH','state':'MAY_HAVE_BEEN_SENT','markedAt':'2026-10-16T04:00:00.000Z'}))
        if scenario in ('temp-only','final-temp'):put(relay/(rid+'.request-publishing-'+str(uuid.uuid4())+'.tmp'),b'partial')
        if scenario=='bad-temp-name':put(relay/'invalid.request-publishing-invalid.tmp',b'partial')
        try:
            result=g['relay_publication_state']()
            assert scenario=='complete',(profile,scenario,'unexpected acceptance')
            assert result==([packet],[],[])
        except Exception as error:
            if scenario=='complete':raise
            if scenario=='orphan-dispatch':assert str(error)=='FIXED_ORPHAN_DISPATCH_HOLD',str(error)
            elif scenario in ('no-ready-empty','no-ready-full','temp-only','final-temp'):assert str(error)=='FIXED_REQUEST_NOT_READY_HOLD',str(error)
            elif scenario=='ready-only':assert str(error)=='FIXED_ORPHAN_REQUEST_READY_HOLD',str(error)
            elif scenario=='bad-temp-name':assert str(error)=='FIXED_REQUEST_TEMP_FILENAME',str(error)
            elif scenario=='bad-hash':assert str(error)=='FIXED_REQUEST_HASH',str(error)
            elif scenario=='bad-json':assert isinstance(error,json.JSONDecodeError),str(error)
            else:assert str(error) in ('FIXED_FILE','FIXED_FILE_CHANGED'),str(error)
        # Test-only trees remain available for inspection; no real fault evidence is removed.
        passed+=1
    # The direct diagnostic entry must validate readiness before parsing the request.
    import inspect
    diagnostic=inspect.getsource(g['record_tool_result'])
    assert diagnostic.index('request_ready(')<diagnostic.index("r=decode(checked(PRIVATE/'relay'")
    passed+=1
print(json.dumps({'status':'PASS','synthetic':True,'cases':passed,'profiles':['Takeda','Biogen'],'realTemplateFunctions':True,'networkOrDatabaseCalls':0}))
