import io,itertools,json,pathlib,runpy,sys,tempfile,unittest.mock as m

script=pathlib.Path(__file__).with_name('readback-original-web.py')

def run(states, expected_searches, mismatch=None):
 company={'id':'company-test','jobs':[{'id':'unchanged-job','title':'Existing job'}]}
 coverage={'companyName':'Test company','lastSuccessAt':'2026-10-30T12:00:00Z'}
 replies=itertools.chain(states,itertools.repeat(states[-1])); calls=[]
 def get(req,**kwargs):
  calls.append((req.full_url,dict(req.header_items())))
  if '/api/coverage?' in req.full_url:
   row={**coverage,'companyName':'Wrong company'} if mismatch=='coverage' else coverage
   body={'companies':[row]}
  else:
   row={**company,'jobs':[]} if mismatch=='search' else company
   body={'snapshotRefresh':next(replies),'companies':[row]}
  return io.BytesIO(json.dumps(body).encode())
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);(root/'review').mkdir()
  (root/'review'/'EXPECTED_TARGET_API.json').write_text(json.dumps({'after':company,'afterCoverage':coverage}))
  with m.patch('urllib.request.urlopen',get),m.patch('time.sleep'),m.patch.object(sys,'argv',[str(script),d]):
   try:runpy.run_path(str(script),run_name='__main__')
   except AssertionError:
    assert mismatch is not None
   else:
    assert mismatch is None
  searches=[call for call in calls if '/api/search?' in call[0]]
  assert len(searches)==expected_searches, calls
  if states[0].get('check'):
   assert searches[1][1].get('X-job-snapshot-check')==states[0]['check']
  if mismatch:
   assert not (root/'WEB_READBACK_VERIFIED.json').exists()
  else:
   receipt=json.loads((root/'WEB_READBACK_VERIFIED.json').read_text())
   assert receipt['allFieldsMatch'] and receipt['uniqueJobs']==1
   assert sum('/api/coverage?' in call[0] for call in calls)==1

current={'state':'CURRENT'}
run([current],1)
run([{'state':'CURRENT','check':'correlated'},current],2)
run([{'state':'UPDATING'},current],2)
run([current],1,'search')
run([current],1,'coverage')
print('PASS: settled no-token response uses one search; check/UPDATING paths retained; full job and coverage equality still reject mismatches')
