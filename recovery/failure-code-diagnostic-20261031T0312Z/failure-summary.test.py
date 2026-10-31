import json,pathlib,subprocess,sys,tempfile

root=pathlib.Path(__file__).resolve().parent
script=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else root/'failure-summary.py'
def summary(run):
 return subprocess.check_output([sys.executable,str(script),str(run)],text=True).strip()

# Exact retained private diagnostic; reading it is not source capture or relay execution.
actual=json.loads(summary(root/'fixtures'))
assert actual=={'failureCode':'RELAY_DEADLINE','phase':'PRE_CAPTURE_CONTEXT',
 'reason':[{'class':'Error','code':'RELAY_DEADLINE','stage':None}],'jobCount':0},actual

with tempfile.TemporaryDirectory() as d:
 run=pathlib.Path(d);(run/'artifacts').mkdir();artifact=run/'artifacts/test.failure-local.json'
 errors=[{'class':'Error','code':'PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION','stage':None},
         {'class':'Error','code':'RELAY_DEADLINE','stage':None}]
 base={'phase':'DB_STARTED_PUBLICATION','errors':errors,'crawlResult':{'jobs':[{}],
       'observation':{'completenessBlockerReason':'UNCHANGED_BLOCKER'}}}
 cases=[({},errors[0]['code']),({'failureCode':'EXPLICIT_TOP_LEVEL'},'EXPLICIT_TOP_LEVEL'),
        ({'failureCode':None},errors[0]['code']),({'errors':[{'code':None},{'code':'CAUSE_CODE'}]},'CAUSE_CODE'),
        ({'errors':[{'code':None}]},None),({'errors':[]},None),({'errors':None},None)]
 for update,expected in cases:
  artifact.write_text(json.dumps({**base,**update}))
  result=json.loads(summary(run))
  assert result=={'failureCode':expected,'phase':'DB_STARTED_PUBLICATION','reason':'UNCHANGED_BLOCKER','jobCount':1},result
 artifact.write_text(json.dumps({'phase':'LEGACY','message':'legacy message'}))
 assert json.loads(summary(run))=={'failureCode':None,'phase':'LEGACY','reason':'legacy message','jobCount':0}
 artifact.unlink()
 assert summary(run)=='Producer exited without a completed publication or failure artifact'
print('PASS: retained producer error code, ordered cause fallback, explicit top-level precedence and unchanged reason/phase/job count/empty-run behavior')
