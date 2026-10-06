import os,re,json,hashlib,datetime,time,pathlib
START=datetime.datetime(2026,10,6,1,25); END=datetime.datetime(2026,10,6,2,15)
ANCHORS={'t-kor6z6fzj3vp79c':datetime.datetime(2026,10,6,1,55,56),'t-kor6z6gejjotyww':datetime.datetime(2026,10,6,2,0,37),'t-kor6z6gtrq0562o':datetime.datetime(2026,10,6,2,5,21)}
EXPECTED='83790ab0a9fcb5f91adab951be4a11649698d5db1f056923d048fcc686617fb7'
TS=re.compile(r'(20\d\d[-/]\d\d[-/]\d\d)[ T](\d\d:\d\d:\d\d)(?:[.,]\d+)?')
IDS=re.compile(r'\bt-[A-Za-z0-9]{8,64}\b')
def timestamp(line):
 m=TS.search(line[:200])
 if not m:return None
 try:return datetime.datetime.strptime(m.group(1).replace('/','-')+'T'+m.group(2),'%Y-%m-%dT%H:%M:%S')
 except ValueError:return None
def safe_row(line,name,num):
 stamps=timestamp(line);ids=sorted(set(IDS.findall(line)))
 tags=[tag for tag in ['receive','start','finish','success','exit','timeout','report','cancel','error','abort','terminate'] if re.search(r'\b'+tag+r'(?:ed|ing|s)?\b',line,re.I)]
 match=re.search(r'(?:exit[_ -]?(?:code|status))\s*[=:]\s*["\']?(-?\d{1,5})',line,re.I)
 return {'file':name,'line':num,'localTimestamp':stamps.isoformat() if stamps else None,'invokeIds':ids,'eventTags':tags,'exitCode':int(match.group(1)) if match else None,'expectedPayloadHashPresent':EXPECTED in line,'oldReleasePathMarkerPresent':'sanofi-pair-20261006T0057Z' in line,'lineSha256':hashlib.sha256(line.encode()).hexdigest(),'lineBytes':len(line.encode())}
def main():
 deadline=time.monotonic()+30;roots=set();agents=[]
 for ent in pathlib.Path('/proc').iterdir():
  if not ent.name.isdigit():continue
  try:
   exe=os.readlink(ent/'exe')
   if '/aliyun-assist/' in exe and pathlib.Path(exe).name in ['aliyun-service','aliyun_assist_service','AliYunDunUpdate']:
    p=pathlib.Path(exe);roots.add(p.parent);agents.append({'pid':int(ent.name),'executable':str(p)})
  except OSError:pass
 result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'agentProcesses':agents,'files':[],'anchors':[],'windowRows':[],'limits':{'maxFiles':8,'maxBytesPerFile':33554432,'maxLineBytes':65536,'maxElapsedSeconds':30,'rawLogOrCommandReturned':False,'tmpScanned':False,'agentModified':False}}
 selected=[]
 for root in sorted(roots):
  if not re.fullmatch(r'/usr/local/share/aliyun-assist/[A-Za-z0-9._-]+',str(root)):continue
  log=root/'log'
  if log.is_symlink() or not log.is_dir():continue
  for p in sorted(log.iterdir()):
   if re.fullmatch(r'aliyun_assist_main\.log(?:\.(?:2026100[567]|2026-10-0[567])(?:\.\d+)?)?',p.name):
    if p.is_symlink() or not p.is_file():continue
    selected.append(p)
 if len(selected)>8:
  result['stoppedReason']='TOO_MANY_RELEVANT_LOG_FILES';print(json.dumps(result));return
 rows=[]
 for p in selected:
  meta={'path':str(p),'bytes':p.stat().st_size,'scannedBytes':0,'complete':True};num=0
  with open(p,'rb') as f:
   while True:
    if meta['scannedBytes']>=33554432 or time.monotonic()>deadline:meta['complete']=False;break
    raw=f.readline(65537)
    if not raw:break
    num+=1;meta['scannedBytes']+=len(raw)
    if len(raw)>65536:
     while raw and not raw.endswith(b'\n') and meta['scannedBytes']<33554432:
      raw=f.readline(65537);meta['scannedBytes']+=len(raw)
     continue
    line=raw.decode('utf-8','replace');ts=timestamp(line)
    if not ts:continue
    is_anchor=any(a in line for a in ANCHORS)
    # Only retain relevant day/time metadata. Raw text is never persisted or returned.
    if is_anchor or (datetime.datetime(2026,10,5,12)<=ts<=datetime.datetime(2026,10,7,17) and (IDS.search(line) or EXPECTED in line or 'sanofi-pair-20261006T0057Z' in line)):
     row=safe_row(line,str(p),num);rows.append(row)
     if len(rows)>20000:meta['complete']=False;result['stoppedReason']='METADATA_ROW_LIMIT';break
  result['files'].append(meta)
  if not meta['complete']:result['coverageIncomplete']=True
 offsets=[]
 for row in rows:
  for a in row['invokeIds']:
   if a in ANCHORS:
    diff=(datetime.datetime.strptime(row['localTimestamp'],'%Y-%m-%dT%H:%M:%S')-ANCHORS[a]).total_seconds();nearest=round(diff/900)*900
    if -43200<=nearest<=50400 and abs(diff-nearest)<=120:
     offsets.append(nearest);result['anchors'].append(dict(row,anchorInvokeId=a,offsetCandidateSeconds=nearest,residualSeconds=diff-nearest))
 unique=sorted(set(offsets));result['timeOffsetsSeconds']=unique
 if len(unique)==1 and len({x['anchorInvokeId'] for x in result['anchors']})>=2:
  offset=unique[0];result['calibration']='MULTIPLE_KNOWN_INVOKES_AGREE'
  for row in rows:
   utc=datetime.datetime.strptime(row['localTimestamp'],'%Y-%m-%dT%H:%M:%S')-datetime.timedelta(seconds=offset)
   if START<=utc<=END:
    row['utcTimestamp']=utc.isoformat()+'Z';result['windowRows'].append(row)
  result['windowRowsTruncated']=len(result['windowRows'])>400
  result['windowRows']=result['windowRows'][:400]
 else:result['calibration']='INSUFFICIENT_OR_AMBIGUOUS_NO_WINDOW_CLAIM'
 grouped={}
 for row in result['windowRows']:
  keys=row['invokeIds'] or ['NO_INVOKE_ID']
  for key in keys:
   g=grouped.setdefault(key,{'invokeId':key,'firstUtc':row['utcTimestamp'],'lastUtc':row['utcTimestamp'],'eventTags':set(),'exitCodes':set(),'matchedLineCount':0,'expectedPayloadHashPresent':False,'oldReleasePathMarkerPresent':False,'lineHashes':[]})
   g['firstUtc']=min(g['firstUtc'],row['utcTimestamp']);g['lastUtc']=max(g['lastUtc'],row['utcTimestamp'])
   g['eventTags'].update(row['eventTags']);g['matchedLineCount']+=1
   if row['exitCode'] is not None:g['exitCodes'].add(row['exitCode'])
   g['expectedPayloadHashPresent']|=row['expectedPayloadHashPresent'];g['oldReleasePathMarkerPresent']|=row['oldReleasePathMarkerPresent'];g['lineHashes'].append(row['lineSha256'])
 result['windowInvocations']=[]
 for key,g in sorted(grouped.items()):
  g['eventTags']=sorted(g['eventTags']);g['exitCodes']=sorted(g['exitCodes']);g['matchedLinesHash']=hashlib.sha256(('\n'.join(g.pop('lineHashes'))).encode()).hexdigest();result['windowInvocations'].append(g)
 result.pop('windowRows');result['anchors']=[next(x for x in result['anchors'] if x['anchorInvokeId']==key) for key in sorted({x['anchorInvokeId'] for x in result['anchors']})]
 result['scopeConclusion']='Positive matches may identify tasks; absence never proves non-submission.'
 import zlib,base64
 data=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()
 print('AUDIT_SHA256='+hashlib.sha256(data).hexdigest())
 print('AUDIT_ZLIB_BASE64='+base64.b64encode(zlib.compress(data)).decode())
if __name__=='__main__':main()
