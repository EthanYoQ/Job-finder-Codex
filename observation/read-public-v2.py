import datetime,hashlib,json,subprocess,sys
from pathlib import Path
p=Path(sys.argv[1]);p.mkdir(exist_ok=False)
urls={'search':'https://job.orz.md/api/search?city=%E5%85%A8%E9%83%A8%E5%9F%8E%E5%B8%82&province=%E5%85%A8%E9%83%A8%E5%9C%B0%E5%8C%BA&sort=COMPANY_PINYIN_ASC&limit=50&offset=0','coverage':'https://job.orz.md/api/coverage?keyword=&offset=0&limit=41'}
args=['curl','--fail-early'];started=datetime.datetime.now(datetime.timezone.utc).isoformat()
for i,(key,url) in enumerate(urls.items()):
 if i:args+=['--next']
 args+=['--silent','--show-error','--compressed','--fail-with-body','--connect-timeout','20','--max-time','60','-H','x-job-search-consent: accepted','-A','job-finder-public-readback/1.0','-D',str(p/(key+'-headers.txt')),'-o',str(p/(key+'.json')),'-w','%{json}\n',url]
result=subprocess.run(args,capture_output=True,text=True,timeout=130)
(p/'curl.stderr').write_text(result.stderr);(p/'curl.stdout').write_text(result.stdout)
lines=result.stdout.splitlines();rows=[];parse_failed=False
for i,key in enumerate(urls):
 meta=json.loads(lines[i]) if i<len(lines) else {};body=p/(key+'.json');raw=body.read_bytes() if body.exists() else None
 data={};parse_error=None
 if raw is not None and meta.get('response_code')==200:
  try:data=json.loads(raw)
  except (ValueError,UnicodeError) as error:parse_error=str(error);parse_failed=True
 header=p/(key+'-headers.txt');headers=header.read_text().splitlines() if header.exists() else []
 record={'endpoint':key,'attempted':i<len(lines),'status':meta.get('response_code'),'bodyPresent':raw is not None,'bytes':len(raw) if raw is not None else None,'sha256':hashlib.sha256(raw).hexdigest() if raw is not None else None,'timeTotal':meta.get('time_total'),'timeTls':meta.get('time_appconnect'),'curlExitCode':meta.get('exitcode'),'totalJobs':data.get('totalJobs'),'companyCount':len(data.get('companies',[])) if data else None,'lastUpdatedAt':data.get('lastUpdatedAt'),'snapshotRefresh':data.get('snapshotRefresh'),'groupStartedAt':started,'groupCompletedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'headers':[line for line in headers if line.lower().startswith(('server-timing:','content-encoding:','content-length:','retry-after:'))],'jsonParseError':parse_error}
 (p/(key+'-metadata.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');rows.append(record)
summary={'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'curlExitCode':result.returncode,'results':rows,'purpose':'READ_ONLY_PUBLIC_OBSERVATION_TRANSPORT_FAILURES_RETAINED'}
for filename in ('transport-summary.json','summary.json'):(p/filename).write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False));sys.exit(result.returncode or (1 if parse_failed else 0))

