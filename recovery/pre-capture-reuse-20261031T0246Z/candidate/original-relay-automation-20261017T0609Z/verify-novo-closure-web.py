import json, pathlib, sys
run=pathlib.Path(sys.argv[1])
before=json.loads((run/'PUBLIC_BEFORE.json').read_text())
after=json.loads((run/'web-after/PUBLIC_BEFORE.json').read_text())
closed=json.loads((run/'expected-captures.json').read_text())
ids={item['capture']['identity']['jobId'] for item in closed}
assert len(before['companies'])==len(after['companies'])==1
expected=dict(before['companies'][0]); expected['jobs']=[job for job in expected['jobs'] if job['id'] not in ids]
assert len(before['companies'][0]['jobs'])-len(expected['jobs'])==len(ids)
assert after['companies']==[expected], 'NOVO_WEB_EXACT_PROJECTION_MISMATCH'
old=json.loads((run/'reader-before.json').read_text());new=json.loads((run/'post-commit/reader-before.json').read_text())
for key in ['lastSuccessAt','lastAttemptAt']:
 assert old.get(key)==new.get(key), 'NOVO_SOURCE_FRESHNESS_CHANGED'
assert {job['id'] for job in new['jobs']}=={job['id'] for job in expected['jobs']}
result={'status':'WEB_VERIFIED','closedCount':len(ids),'remainingJobs':len(expected['jobs']),'otherJobsAllFieldsUnchanged':True,'sourceLastSuccessAt':new.get('lastSuccessAt'),'sourceLastAttemptAt':new.get('lastAttemptAt')}
(run/'WEB_READBACK_VERIFIED.json').write_text(json.dumps(result))
print(json.dumps(result))
