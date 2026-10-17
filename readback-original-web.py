import json,sys,time,urllib.request,urllib.parse,pathlib
run=pathlib.Path(sys.argv[1]);expected=None if len(sys.argv)>2 else json.loads((run/'review/EXPECTED_TARGET_API.json').read_text())
headers={'x-job-search-consent':'accepted'}
def get(path,query):
 with urllib.request.urlopen(urllib.request.Request('https://job.orz.md'+path+'?'+urllib.parse.urlencode(query),headers=headers),timeout=30) as response:return json.load(response)
query={'city':'全部城市','companyIds':sys.argv[2] if expected is None else expected['after']['id'],'limit':50,'offset':0}
first=get('/api/search',query);headers['x-job-snapshot-check']=first['snapshotRefresh']['check']
actual=get('/api/search',query);deadline=time.monotonic()+120
while actual['snapshotRefresh']['state']=='UPDATING' and time.monotonic()<deadline:time.sleep(2);actual=get('/api/search',query)
if actual['snapshotRefresh']['state']=='FAILED':
 (run/'WEB_REFRESH_INITIAL_FAILURE.json').write_text(json.dumps({k:v for k,v in actual['snapshotRefresh'].items() if k!='check'}))
 headers.pop('x-job-snapshot-check',None);first=get('/api/search',query);headers['x-job-snapshot-check']=first['snapshotRefresh']['check'];actual=get('/api/search',query)
 while actual['snapshotRefresh']['state']=='UPDATING' and time.monotonic()<deadline:time.sleep(2);actual=get('/api/search',query)
assert actual['snapshotRefresh']['state']=='CURRENT',actual['snapshotRefresh']['state']
if expected is None:(run/'PUBLIC_BEFORE.json').write_text(json.dumps(actual,ensure_ascii=False));print(json.dumps({'baselineSaved':True}));sys.exit(0)
assert actual['companies']==[expected['after']]
coverage=get('/api/coverage',{'keyword':expected['afterCoverage']['companyName'],'offset':0,'limit':41});assert coverage['companies']==[expected['afterCoverage']]
result={'status':'WEB_VERIFIED','allFieldsMatch':True,'lastSuccessAt':expected['afterCoverage']['lastSuccessAt'],'uniqueJobs':len(expected['after']['jobs']),'snapshotRefresh':actual['snapshotRefresh']}
(run/'WEB_READBACK_VERIFIED.json').write_text(json.dumps(result,ensure_ascii=False));print(json.dumps(result,ensure_ascii=False))
