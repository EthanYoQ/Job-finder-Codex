"""One normal, company-filtered public read. No database calls or forced refresh."""
from pathlib import Path
from urllib.parse import urlencode
import collections, datetime, hashlib, json, re, subprocess, sys

destination, company_id, company_name = sys.argv[1:]
if not re.fullmatch(r'company-[a-z0-9-]+', company_id):
    raise ValueError('company ID required')
p = Path(destination); p.mkdir(parents=True, exist_ok=False)
urls = {
    'search': 'https://job.orz.md/api/search?' + urlencode({'city':'全部城市','province':'全部地区','companyIds':company_id,'sort':'COMPANY_PINYIN_ASC','limit':50,'offset':0}),
    'coverage': 'https://job.orz.md/api/coverage?' + urlencode({'keyword':company_name,'offset':0,'limit':41})
}
args = ['curl','--fail-early']
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
for i,(key,url) in enumerate(urls.items()):
    if i: args += ['--next']
    args += ['--silent','--show-error','--compressed','--fail-with-body','--connect-timeout','20','--max-time','60','-H','x-job-search-consent: accepted','-A','job-finder-public-readback/1.0','-D',str(p/(key+'-headers.txt')),'-o',str(p/(key+'.json')),'-w','%{json}\n',url]
try:
    result = subprocess.run(args,capture_output=True,text=True,timeout=130)
    stdout, stderr, code = result.stdout, result.stderr, result.returncode
except subprocess.TimeoutExpired as error:
    stdout = error.stdout or b''; stderr = error.stderr or b''
    stdout = stdout.decode(errors='replace') if isinstance(stdout,bytes) else stdout
    stderr = stderr.decode(errors='replace') if isinstance(stderr,bytes) else stderr
    code = 124
(p/'curl.stdout').write_text(stdout); (p/'curl.stderr').write_text(stderr)
lines = stdout.splitlines(); rows = []; invalid_json = False
for i,key in enumerate(urls):
    try: meta = json.loads(lines[i]) if i < len(lines) else {}
    except ValueError: meta = {}; invalid_json = True
    body = p/(key+'.json'); raw = body.read_bytes() if body.exists() else None
    try: data = json.loads(raw) if raw else {}
    except (ValueError,UnicodeError): data = {}; invalid_json = True
    companies = data.get('companies',[])
    jobs = [j for company in companies for j in company.get('jobs',[])]
    header = p/(key+'-headers.txt')
    rows.append({'endpoint':key,'httpCode':meta.get('http_code'),'totalSeconds':meta.get('time_total'),'appConnectSeconds':meta.get('time_appconnect'),'bodyPresent':raw is not None,'bytes':len(raw) if raw is not None else None,'sha256':hashlib.sha256(raw).hexdigest() if raw is not None else None,'totalJobs':data.get('totalJobs'),'companyCount':len(companies),'lastUpdatedAt':data.get('lastUpdatedAt'),'snapshotRefresh':data.get('snapshotRefresh'),'sourceResultCounts':dict(collections.Counter(j.get('sourceResultId') for j in jobs)),'lastSeenTimes':sorted(set(j.get('lastSeenAt') for j in jobs if isinstance(j.get('lastSeenAt'),str))),'coverageTimes':[{'companyId':c.get('id'),'lastSuccessAt':c.get('lastSuccessAt'),'state':c.get('state'),'health':c.get('health')} for c in companies] if key=='coverage' else [],'headers':[line for line in header.read_text().splitlines() if line.lower().startswith(('server-timing:','content-encoding:'))] if header.exists() else []})
summary = {'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'curlExitCode':code,'invalidJson':invalid_json,'scope':'company-filtered search and keyword-filtered coverage, no force refresh','companyId':company_id,'results':rows}
(p/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False)); raise SystemExit(code or int(invalid_json))
