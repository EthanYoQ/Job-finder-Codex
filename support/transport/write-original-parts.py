import sys,json,os,pathlib,hashlib,re
root=pathlib.Path('/workspace/scratch/5e9614251709')
source=pathlib.Path(sys.argv[1]);dest=pathlib.Path(sys.argv[2])
assert (dest.parent==root/'connector-host-task/relay' or re.fullmatch(r'rounds/round-[a-f0-9]{32}/connector-host-task/relay',str(dest.parent.relative_to(root)))) and dest.name.endswith('.host-result.json')
x=json.loads(source.read_text());packet=x['packet'];meta=x['meta']
text=json.dumps(packet,ensure_ascii=False,separators=(',',':'));raw=text.encode();u=text.encode('utf-16-le')
assert hashlib.sha256(raw).hexdigest()==meta['sha256'] and len(raw)==meta['byteCount'] and len(u)//2==meta['charCount']
assert packet['requestSha256']==meta['requestSha256'] and dest.name==packet['requestId']+'.host-result.json'
assert not dest.exists() and not dest.with_name(dest.stem+'.ready.json').exists()
for i in range(meta['count']):
 part={**meta,'index':i,'text':u[i*32000:(i+1)*32000].decode('utf-16-le','surrogatepass')}
 path=dest.with_name(dest.stem+'.part-'+str(i).zfill(6)+'.json')
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f:json.dump(part,f,ensure_ascii=True,separators=(',',':'))
print(json.dumps({'partsWritten':meta['count'],'sha256':meta['sha256']}))
