import json,sys,time,urllib.request,urllib.parse,urllib.error,pathlib
run=pathlib.Path(sys.argv[1]);expected=None if len(sys.argv)>2 else json.loads((run/'review/EXPECTED_TARGET_API.json').read_text())
headers={'x-job-search-consent':'accepted'}
def get(path,query):
 with urllib.request.urlopen(urllib.request.Request('https://job.orz.md'+path+'?'+urllib.parse.urlencode(query),headers=headers),timeout=30) as response:return json.load(response)
query={'city':'全部城市','companyIds':sys.argv[2] if expected is None else expected['after']['id'],'limit':50,'offset':0}
deadline=time.monotonic()+120
for attempt in range(2):
 try:
  headers.pop('x-job-snapshot-check',None)
  first=get('/api/search',query)
  if first['snapshotRefresh'].get('check'):headers['x-job-snapshot-check']=first['snapshotRefresh']['check']
  actual=get('/api/search',query)
  while actual['snapshotRefresh']['state']=='UPDATING' and time.monotonic()<deadline:time.sleep(2);actual=get('/api/search',query)
  if actual['snapshotRefresh']['state']=='FAILED':raise RuntimeError('WEB_REFRESH_FAILED')
  assert actual['snapshotRefresh']['state']=='CURRENT',actual['snapshotRefresh']['state']
  if expected is not None:
   assert actual['companies']==[expected['after']]
   coverage=get('/api/coverage',{'keyword':expected['afterCoverage']['companyName'],'offset':0,'limit':41});assert coverage['companies']==[expected['afterCoverage']]
  break
 except (urllib.error.HTTPError,RuntimeError) as error:
  if not ((isinstance(error,urllib.error.HTTPError) and error.code==502) or str(error)=='WEB_REFRESH_FAILED'):raise
  if attempt or time.monotonic()>=deadline:raise
  (run/'WEB_REFRESH_INITIAL_FAILURE.json').write_text(json.dumps({'reason':str(error),'httpStatus':getattr(error,'code',None)}))
if expected is None:(run/'PUBLIC_BEFORE.json').write_text(json.dumps(actual,ensure_ascii=False));print(json.dumps({'baselineSaved':True}));sys.exit(0)
result={'status':'WEB_VERIFIED','allFieldsMatch':True,'lastSuccessAt':expected['afterCoverage']['lastSuccessAt'],'uniqueJobs':len(expected['after']['jobs']),'snapshotRefresh':actual['snapshotRefresh']}
(run/'WEB_READBACK_VERIFIED.json').write_text(json.dumps(result,ensure_ascii=False));print(json.dumps(result,ensure_ascii=False))
