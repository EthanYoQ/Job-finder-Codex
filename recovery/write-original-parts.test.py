"""Offline actual transfer writer; only workspace literal relocated to temporary fixture."""
import pathlib,tempfile,subprocess,json,hashlib,math
script=pathlib.Path(__file__).parent/'takeda-original-recovery-20261017T0417Z/transport/write-original-parts.py'
with tempfile.TemporaryDirectory(prefix='jobfinder-parts-') as directory:
 root=pathlib.Path(directory)
 writer=root/'writer.py';writer.write_text(script.read_text().replace('/workspace/scratch/5e9614251709',str(root)))
 packet={'requestId':'test-request','requestSha256':'a'*64,'text':'职位内容'*10000}
 raw=json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode();utf=raw.decode().encode('utf-16-le')
 meta={'sha256':hashlib.sha256(raw).hexdigest(),'byteCount':len(raw),'charCount':len(utf)//2,'count':math.ceil(len(utf)/32000),'requestSha256':packet['requestSha256']}
 source=root/'transfer.json';source.write_text(json.dumps({'packet':packet,'meta':meta}))
 def run(dest,ok):
  dest.parent.mkdir(parents=True,exist_ok=True)
  result=subprocess.run(['python3','-I',str(writer),str(source),str(dest)],capture_output=True,text=True)
  assert (result.returncode==0)==ok,(dest,result.stdout,result.stderr)
  return result
 for relative in ['connector-host-task/relay','rounds/round-'+'a'*32+'/connector-host-task/relay']:
  dest=root/relative/'test-request.host-result.json';run(dest,True)
  parts=sorted(dest.parent.glob('test-request.host-result.part-*.json'))
  assert len(parts)==meta['count']
  joined=''.join(json.loads(p.read_text())['text'] for p in parts)
  assert joined.encode('utf-16-le')==utf
  for i,p in enumerate(parts):
   part=json.loads(p.read_text());assert part['index']==i and all(part[k]==v for k,v in meta.items())
  run(dest,False) # exclusive creation rejects duplicate
 for relative in ['rounds/round-short/connector-host-task/relay','rounds/round-'+'A'*32+'/connector-host-task/relay','other/relay','rounds/round-'+'a'*32+'/connector-host-task/relay/child']:
  run(root/relative/'test-request.host-result.json',False)
 run(root/'connector-host-task/relay/wrong.host-result.json',False)
 original=source.read_text();bad=json.loads(original);bad['meta']['sha256']='0'*64;source.write_text(json.dumps(bad))
 run(root/('rounds/round-'+'b'*32+'/connector-host-task/relay/test-request.host-result.json'),False)
 source.write_text(original)
print('PASS actual writer: default/round unicode multipart roundtrip, original metadata, duplicate/path/name/hash rejection')
