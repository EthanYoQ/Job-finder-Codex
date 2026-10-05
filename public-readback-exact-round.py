import json,sys,datetime,hashlib
from pathlib import Path
R=Path('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z')
p=Path(sys.argv[1]);p=p if p.is_absolute() else R/p
a=json.loads((p/'search.json').read_text());b=json.loads((p/'coverage.json').read_text())
sm=json.loads((p/'search-metadata.json').read_text());cm=json.loads((p/'coverage-metadata.json').read_text())
assert sm['status']==cm['status']==200
jobs=[j for c in a['companies'] for j in c['jobs']]
assert len(jobs)==a['totalJobs'] and len({j['id'] for j in jobs})==len(jobs)
cov={c['id']:c for c in b['companies']}
latest={}
for f in list((R/'hosts').glob('*/dot-*-20261005*/completion-summary.json'))+list((R/'hosts').glob('*/*/dot-*-20261005*/completion-summary.json')):
 d=json.loads(f.read_text())
 if d.get('state')!='COMMITTED_EXACT':continue
 k=d['sourceId']
 if k not in latest or d['batchFinishedAt']>latest[k][0]['batchFinishedAt']:latest[k]=(d,f)
def utc(t):
 parsed=datetime.datetime.fromisoformat(t.replace('Z','+00:00'))
 return parsed.replace(tzinfo=datetime.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(datetime.timezone.utc)
out=[];checked=max(sm['groupCompletedAt'],cm['groupCompletedAt'])
for k,(d,f) in sorted(latest.items()):
 js=[j for j in jobs if j['sourceId']==k]
 row=json.loads((f.parent/'FINALIZED_BATCH_AND_RELEASE.json').read_text())[0]['row']
 cert=row.get('completenessCertificate') or {}
 obs=json.loads((f.parent/'POST_COMMIT_OBSERVATION.json').read_text())
 o=(obs[0] if obs else {}) if isinstance(obs,list) else (obs.get('observation') or obs.get('observations',[{}])[0])
 if not o.get('crawledAt'):
  z=json.loads((f.parent/'FINALIZED_BATCH_AND_RELEASE.json').read_text())[0]
  o=(z.get('observations') or [{}])[0]
 observed=cert.get('observedAt') if cert.get('grade')=='A' else (o.get('crawledAt') or d.get('crawledAt'))
 if not observed:
  # Earlier exact observation reports used a row array.
  candidates=obs if isinstance(obs,list) else obs.get('rows',[])
  if candidates:observed=candidates[0].get('crawledAt')
 c=cov.get(js[0]['companyId']) if js else None
 identity=bool(len(js)==d['currentJobCount'] and js and all(j['sourceResultId']==d['sourceResultId'] and not j['inGrace'] for j in js))
 time_ok=bool(c and observed and utc(c['lastSuccessAt'])==utc(observed))
 exact=bool(identity and c and c['state']=='PUBLISHING' and c['health']=='HEALTHY' and time_ok)
 item={'sourceId':k,'batchId':d['batchId'],'sourceResultId':d['sourceResultId'],'expectedCurrentJobs':d['currentJobCount'],'publicJobs':len(js),'exactBatchVisible':identity,'coverageTimeMatches':time_ok,'publicVerified':exact,'coverageAt':c.get('lastSuccessAt') if c else None,'expectedCoverageAt':observed}
 out.append(item)
 if exact:
  d.update(publicVerified=True,publicVerifiedAt=checked);f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
summary={'checkedAt':checked,'companies':len(a['companies']),'jobs':a['totalJobs'],'lastUpdatedAt':a['lastUpdatedAt'],'searchRefresh':a.get('snapshotRefresh'),'coverageRefresh':b.get('snapshotRefresh'),'sourceBatches':out,'exactNewBatchSources':sum(x['publicVerified'] for x in out),'exactNewBatchJobs':sum(x['expectedCurrentJobs'] for x in out if x['publicVerified']),'currentCompletedSources':len(out),'currentCompletedJobs':sum(x['expectedCurrentJobs'] for x in out),'requestMetrics':[sm,cm]}
(p/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='requestMetrics'},ensure_ascii=False))
