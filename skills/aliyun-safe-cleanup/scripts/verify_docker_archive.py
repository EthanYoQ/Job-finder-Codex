#!/usr/bin/env python3
"""Read-only verification of Docker save archives. Never extracts or loads an image."""
import argparse,gzip,hashlib,json,os,pathlib,re,stat,tarfile
ID=re.compile(r'^sha256:[0-9a-f]{64}$')
class InvalidArchive(RuntimeError):pass

class BudgetReader:
 def __init__(self,source,limit):self.source=source;self.limit=limit;self.read_bytes=0
 def read(self,size=-1):
  remaining=self.limit-self.read_bytes
  request=min(size if size>=0 else remaining+1,remaining+1,1024*1024)
  chunk=self.source.read(request)
  self.read_bytes+=len(chunk)
  if self.read_bytes>self.limit:raise InvalidArchive('UNCOMPRESSED_STREAM_LIMIT')
  return chunk

class BoundedTarInfo(tarfile.TarInfo):
 def _charge_metadata(self,tarfile_obj):
  used=getattr(tarfile_obj,'_cleanup_metadata_bytes',0)+self.size
  if used>2*1024*1024:raise InvalidArchive('CUMULATIVE_METADATA_LIMIT')
  tarfile_obj._cleanup_metadata_bytes=used
 def _proc_pax(self,tarfile_obj):
  if self.size>64*1024:raise InvalidArchive('PAX_METADATA_LIMIT')
  self._charge_metadata(tarfile_obj)
  return super()._proc_pax(tarfile_obj)
 def _proc_gnulong(self,tarfile_obj):
  if self.size>8*1024:raise InvalidArchive('GNU_LONG_METADATA_LIMIT')
  self._charge_metadata(tarfile_obj)
  return super()._proc_gnulong(tarfile_obj)


class HashingReader:
 def __init__(self,source):self.source=source;self.digest=hashlib.sha256();self.read_bytes=0
 def read(self,size=-1):
  chunk=self.source.read(min(size if size>=0 else 1024*1024,1024*1024))
  self.read_bytes+=len(chunk)
  if self.read_bytes>4*1024**3:raise InvalidArchive('COMPRESSED_ARCHIVE_LIMIT')
  self.digest.update(chunk)
  return chunk

def verify(path,expected_ids,max_uncompressed=12*1024**3):
 path=pathlib.Path(path)
 ids=set(expected_ids)
 if not ids or len(ids)!=len(expected_ids) or any(not ID.fullmatch(x) for x in ids):raise InvalidArchive('EXPECTED_IDS_INVALID')
 if not stat.S_ISREG(path.lstat().st_mode):raise InvalidArchive('ARCHIVE_NOT_REGULAR')
 fd=os.open(str(path),os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as raw:
  before=os.fstat(raw.fileno())
  if not stat.S_ISREG(before.st_mode):raise InvalidArchive('ARCHIVE_NOT_REGULAR')
  if before.st_size>4*1024**3:raise InvalidArchive('COMPRESSED_ARCHIVE_LIMIT')
  reader=HashingReader(raw)
  result=_verify_open_stream(reader,ids,max_uncompressed)
  after=os.fstat(raw.fileno());at_path=path.lstat()
  identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  if identity(before)!=identity(after) or identity(after)!=identity(at_path):raise InvalidArchive('ARCHIVE_CHANGED_DURING_VERIFY')
  if reader.read_bytes!=after.st_size:raise InvalidArchive('COMPRESSED_STREAM_INCOMPLETE')
  result.update({'archiveBytes':after.st_size,'archiveSha256':reader.digest.hexdigest()})
  return result

def _verify_open_stream(reader,ids,max_uncompressed):
 hashes={};configs={};manifest=None;total=0
 with gzip.GzipFile(fileobj=reader,mode='rb') as compressed_source:
  source=BudgetReader(compressed_source,max_uncompressed)
  with tarfile.open(fileobj=source,mode='r|',tarinfo=BoundedTarInfo) as tar:
   for member in tar:
    name=member.name
    parts=pathlib.PurePosixPath(name).parts
    if not parts or name.startswith('/') or '..' in parts or '\\' in name:raise InvalidArchive('MEMBER_PATH_UNSAFE')
    name=str(pathlib.PurePosixPath(name))
    if name in ('index.json','oci-layout'):raise InvalidArchive('OCI_LAYOUT_REQUIRES_SEPARATE_REVIEW')
    if name in hashes:raise InvalidArchive('DUPLICATE_MEMBER')
    if len(hashes)>=20000:raise InvalidArchive('TOO_MANY_MEMBERS')
    if member.isdir():hashes[name]={'kind':'directory'};continue
    if not member.isfile():raise InvalidArchive('UNSUPPORTED_MEMBER_TYPE')
    if member.size<0 or total+member.size>max_uncompressed:raise InvalidArchive('UNCOMPRESSED_LIMIT')
    known_config=next((x for x in ids if name in (x[7:]+'.json','blobs/sha256/'+x[7:])),None)
    capture=name=='manifest.json' or known_config is not None
    if capture and member.size>2*1024*1024:raise InvalidArchive('JSON_MEMBER_LIMIT')
    digest=hashlib.sha256();payload=bytearray();read=0
    stream=tar.extractfile(member)
    for chunk in iter(lambda:stream.read(1024*1024),b''):
     read+=len(chunk);digest.update(chunk)
     if capture:payload.extend(chunk)
    if read!=member.size:raise InvalidArchive('MEMBER_SIZE_MISMATCH')
    total+=read;hashes[name]={'kind':'file','sha256':digest.hexdigest(),'bytes':read}
    if name=='manifest.json':manifest=json.loads(payload.decode('utf8'))
    if known_config:
     if 'sha256:'+digest.hexdigest()!=known_config:raise InvalidArchive('CONFIG_ID_MISMATCH')
     configs[name]={'id':known_config,'data':json.loads(payload.decode('utf8'))}
  # Reading through gzip EOF is required to verify CRC and length after tar EOF.
  for chunk in iter(lambda:source.read(1024*1024),b''):pass
 if not isinstance(manifest,list) or len(manifest)!=len(ids):raise InvalidArchive('MANIFEST_IMAGE_COUNT')
 restored=set();layers=0
 for entry in manifest:
  if not isinstance(entry,dict) or entry.get('RepoTags') not in (None,[]):raise InvalidArchive('UNEXPECTED_REPOSITORY_TAGS')
  config_name=entry.get('Config')
  if config_name not in configs:raise InvalidArchive('MISSING_OR_UNEXPECTED_CONFIG')
  config=configs[config_name];image_id=config['id']
  if image_id in restored:raise InvalidArchive('DUPLICATE_IMAGE')
  layer_names=entry.get('Layers');diff_ids=config['data'].get('rootfs',{}).get('diff_ids')
  if not isinstance(layer_names,list) or not isinstance(diff_ids,list) or len(layer_names)!=len(diff_ids):raise InvalidArchive('LAYER_COUNT_MISMATCH')
  for name,want in zip(layer_names,diff_ids):
   h=hashes.get(name)
   if not isinstance(want,str) or not ID.fullmatch(want) or not h or h.get('kind')!='file' or 'sha256:'+h['sha256']!=want:raise InvalidArchive('LAYER_CONTENT_MISMATCH_OR_UNSUPPORTED_COMPRESSION')
   layers+=1
  restored.add(image_id)
 if restored!=ids:raise InvalidArchive('IMAGE_SET_MISMATCH')
 return {'status':'ARCHIVE_CONTENT_VERIFIED_NOT_RESTORE_TESTED','imageIds':sorted(ids),'imageCount':len(ids),'manifestLayerReferences':layers,'archiveMembers':len(hashes),'uncompressedFileBytes':total,'totalDecompressedStreamBytes':source.read_bytes,'repoDigestRestorationVerified':False,'dockerLoadExecuted':False,'repositoryTagsVerifiedEmpty':True,'supportedArchiveFormat':'classic Docker save with raw layer archives; OCI layout rejected'}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('archive');p.add_argument('expected_json');args=p.parse_args()
 expected=json.loads(pathlib.Path(args.expected_json).read_text())
 print(json.dumps(verify(args.archive,expected['candidateIds']),sort_keys=True))
if __name__=='__main__':main()
