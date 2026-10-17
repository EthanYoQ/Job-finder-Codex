import io,json,pathlib,runpy,sys,tempfile,unittest.mock as m
script=pathlib.Path(__file__).with_name('readback-original-web.py')
def run(final):
 replies=iter([{'state':'UPDATING','check':'one'},{'state':'FAILED','check':'one'},{'state':'UPDATING','check':'two'},{'state':final,'check':'two'}]);calls=[]
 def get(req,**kwargs):
  calls.append(req.full_url);return io.BytesIO(json.dumps({'snapshotRefresh':next(replies),'companies':[]}).encode())
 with tempfile.TemporaryDirectory() as d,m.patch('urllib.request.urlopen',get),m.patch.object(sys,'argv',[str(script),d,'company-test']):
  try:runpy.run_path(str(script),run_name='__main__')
  except SystemExit as e:assert e.code==0
  except AssertionError:
   assert final=='FAILED'
  else:raise AssertionError('script did not exit')
  assert len(calls)==4
  assert 'check' not in json.loads((pathlib.Path(d)/'WEB_REFRESH_INITIAL_FAILURE.json').read_text())
run('CURRENT');run('FAILED');print('PASS: one original read-only refresh recovery, persistent failure retained, check token excluded')
