import json,pathlib,runpy,sys,tempfile,urllib.request,urllib.error,io
from unittest.mock import patch
X=pathlib.Path(__file__).parent
expected={'after':{'id':'company-test','jobs':[]},'afterCoverage':{'companyName':'Test','lastSuccessAt':'now'}}
current={'snapshotRefresh':{'state':'CURRENT','check':'secret'},'companies':[expected['after']]}
coverage={'companies':[expected['afterCoverage']]}
def case(responses,success,calls):
 with tempfile.TemporaryDirectory() as d:
  p=pathlib.Path(d);(p/'review').mkdir();(p/'review/EXPECTED_TARGET_API.json').write_text(json.dumps(expected))
  seen=[]
  def opened(*args,**kwargs):
   seen.append(1);v=responses.pop(0)
   if isinstance(v,Exception):raise v
   return io.BytesIO(json.dumps(v).encode())
  with patch.object(sys,'argv',['readback',d]),patch.object(urllib.request,'urlopen',opened):
   try:runpy.run_path(str(X/'after/readback-original-web.py'));assert success
   except urllib.error.HTTPError:assert not success
  assert len(seen)==calls
  assert (p/'WEB_READBACK_VERIFIED.json').exists()==success
err=lambda code:urllib.error.HTTPError('https://job.orz.md/api/search',code,'test',{},None)
case([current,err(502),current,current,coverage],True,5)
case([err(502),err(502)],False,2)
case([err(403)],False,1)
case([current,{'snapshotRefresh':{'state':'FAILED'}},current,current,coverage],True,5)
print('PASS existing single recovery covers 502/FAILED; repeated502 stops;403 no retry')
