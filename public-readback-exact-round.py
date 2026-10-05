import argparse,json,datetime,hashlib
from pathlib import Path
R=Path('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z')
NO_MEMBER_PROOF=object()

def canonical_string_set_sha256(values):
 # Match runtimeBatchIdentity.ts: unique strings, UTF-8 byte order, compact JSON.
 canonical=sorted(set(values),key=lambda value:value.encode('utf-8'))
 return hashlib.sha256(json.dumps(canonical,ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()

def verify_member_identity(d,row,jobs,expectation):
 """Fail closed unless the formal CURRENT/GRACE/VISIBLE proof binds this row."""
 def require(condition,reason):
  if not condition:raise ValueError(reason)
 def nonblank(value):return isinstance(value,str) and bool(value.strip())
 require(expectation['sourceResultId']==row['id']==d['sourceResultId'],'source-result binding')
 require(nonblank(row['id']) and row['sourceId']==d['sourceId'] and row['batchId']==d['batchId'],'finalized row binding')
 require(row['atomicCommitState']=='COMMITTED' and row['completenessState']=='VERIFIED' and
         row['transportState']=='SUCCEEDED' and row['adapterState']=='SUCCEEDED','finalized row state')
 require(type(d['currentJobCount']) is int and type(row['dedupeOutputCount']) is int and
         d['currentJobCount']==row['dedupeOutputCount'],'current count binding')
 sets={kind:{} for kind in ('CURRENT','GRACE','VISIBLE')}
 ids={kind:set() for kind in sets}
 require(isinstance(expectation['members'],list),'members must be an array')
 for member in expectation['members']:
  kind=member['setKind'];key=member['jobKey'];public_id=member['publicJobId'];missing=member['missingCount']
  require(kind in sets and nonblank(key) and nonblank(public_id),'member identity')
  require(type(missing) is int and missing in (0,1) and
          (kind!='CURRENT' or missing==0) and (kind!='GRACE' or missing==1),'member missing count')
  require(member['jobKeySha256']==hashlib.sha256(key.encode('utf-8')).hexdigest(),'member job-key hash')
  for field,value in (('sourceResultId',row['id']),('sourceId',row['sourceId']),('batchId',row['batchId'])):
   require(field not in member or member[field]==value,'member '+field+' binding')
  require(key not in sets[kind] and public_id not in ids[kind],'duplicate member key or public ID')
  sets[kind][key]=(public_id,missing);ids[kind].add(public_id)
 require(len(sets['CURRENT'])==row['dedupeOutputCount'],'CURRENT member count')
 for kind,field in (('CURRENT','canonicalCurrentJobSetSha256'),('GRACE','canonicalGraceJobSetSha256'),('VISIBLE','canonicalVisibleJobSetSha256')):
  require(canonical_string_set_sha256(sets[kind])==row[field],kind+' canonical hash')
 require(not (sets['CURRENT'].keys() & sets['GRACE'].keys()) and
         not (ids['CURRENT'] & ids['GRACE']),'CURRENT/GRACE overlap')
 require({**sets['CURRENT'],**sets['GRACE']}==sets['VISIBLE'],'VISIBLE union or member mapping')
 certificate=row.get('completenessCertificate') or {}
 # portablePublicSnapshot publishes VISIBLE only for source-quality receipts.
 require(not ids['GRACE'] or certificate.get('schemaVersion')=='plan-bound-source-quality-v1','receipt does not publish GRACE')
 company_id=certificate.get('companyId')
 require(nonblank(company_id),'receipt company binding')
 require(len(jobs)==len(ids['VISIBLE']) and len({j['id'] for j in jobs})==len(jobs),'public count or duplicate ID')
 require(all(j['sourceId']==row['sourceId'] and j['sourceResultId']==row['id'] and
             j['companyId']==company_id and type(j['inGrace']) is bool for j in jobs),'public source/result/company or grace type')
 require({j['id'] for j in jobs if not j['inGrace']}==ids['CURRENT'],'public CURRENT IDs')
 require({j['id'] for j in jobs if j['inGrace']}==ids['GRACE'],'public GRACE IDs')

def utc(t):
 parsed=datetime.datetime.fromisoformat(t.replace('Z','+00:00'))
 return parsed.replace(tzinfo=datetime.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(datetime.timezone.utc)

def public_status(d,row,jobs,coverage,observed,expectation=NO_MEMBER_PROOF):
 # No proof retains the original no-GRACE contract; counts never admit GRACE.
 error=None
 if expectation is NO_MEMBER_PROOF:
  identity=bool(len(jobs)==d['currentJobCount'] and jobs and all(j['sourceResultId']==d['sourceResultId'] and not j['inGrace'] for j in jobs))
 else:
  try:verify_member_identity(d,row,jobs,expectation);identity=True
  except (KeyError,TypeError,ValueError,UnicodeError) as exc:identity=False;error=str(exc)
 time_ok=bool(coverage and observed and utc(coverage['lastSuccessAt'])==utc(observed))
 exact=bool(identity and coverage and coverage['state']=='PUBLISHING' and coverage['health']=='HEALTHY' and time_ok)
 return identity,time_ok,exact,error

def main():
 parser=argparse.ArgumentParser(description='Verify a saved public readback against completed source batches.')
 parser.add_argument('readback_dir')
 parser.add_argument('--verify-only',action='store_true',help='Print the report without writing summary or completion files.')
 parser.add_argument('--run-dir',action='append',help='Read only this completed run directory; repeat to select more runs.')
 args=parser.parse_args()
 p=Path(args.readback_dir);p=p if p.is_absolute() else R/p
 a=json.loads((p/'search.json').read_text());b=json.loads((p/'coverage.json').read_text())
 sm=json.loads((p/'search-metadata.json').read_text());cm=json.loads((p/'coverage-metadata.json').read_text())
 assert sm['status']==cm['status']==200
 jobs=[j for c in a['companies'] for j in c['jobs']]
 assert len(jobs)==a['totalJobs'] and len({j['id'] for j in jobs})==len(jobs)
 cov={c['id']:c for c in b['companies']}
 latest={}
 runs=[(Path(v) if Path(v).is_absolute() else R/v)/'completion-summary.json' for v in args.run_dir] if args.run_dir else list((R/'hosts').glob('*/dot-*-20261005*/completion-summary.json'))+list((R/'hosts').glob('*/*/dot-*-20261005*/completion-summary.json'))
 for f in runs:
  d=json.loads(f.read_text())
  if d.get('state')!='COMMITTED_EXACT':continue
  k=d['sourceId']
  if k not in latest or d['batchFinishedAt']>latest[k][0]['batchFinishedAt']:latest[k]=(d,f)
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
  proof=f.parent/'PUBLIC_VISIBLE_MEMBER_EXPECTATION.json'
  expectation=json.loads(proof.read_text()) if proof.exists() else NO_MEMBER_PROOF
  identity,time_ok,exact,error=public_status(d,row,js,c,observed,expectation)
  item={'sourceId':k,'batchId':d['batchId'],'sourceResultId':d['sourceResultId'],'expectedCurrentJobs':d['currentJobCount'],'publicJobs':len(js),'exactBatchVisible':identity,'coverageTimeMatches':time_ok,'publicVerified':exact,'coverageAt':c.get('lastSuccessAt') if c else None,'expectedCoverageAt':observed}
  if error:item['membershipError']=error
  out.append(item)
  if exact and not args.verify_only:
   d.update(publicVerified=True,publicVerifiedAt=checked);f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 summary={'checkedAt':checked,'companies':len(a['companies']),'jobs':a['totalJobs'],'lastUpdatedAt':a['lastUpdatedAt'],'searchRefresh':a.get('snapshotRefresh'),'coverageRefresh':b.get('snapshotRefresh'),'sourceBatches':out,'exactNewBatchSources':sum(x['publicVerified'] for x in out),'exactNewBatchJobs':sum(x['expectedCurrentJobs'] for x in out if x['publicVerified']),'currentCompletedSources':len(out),'currentCompletedJobs':sum(x['expectedCurrentJobs'] for x in out),'requestMetrics':[sm,cm]}
 if not args.verify_only:(p/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:v for k,v in summary.items() if k!='requestMetrics'},ensure_ascii=False))

if __name__=='__main__':main()
