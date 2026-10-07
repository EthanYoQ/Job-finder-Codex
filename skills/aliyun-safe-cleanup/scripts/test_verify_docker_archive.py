import gzip,hashlib,io,json,os,pathlib,tarfile,tempfile,unittest
from verify_docker_archive import verify,InvalidArchive
class ArchiveTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'archive.tar.gz'
 def tearDown(self):self.tmp.cleanup()
 def fixture(self,wrong_layer=False,unsafe=False,duplicate=False,extra_image=False,secret=False,tagged=False,oci=False):
  layer=b'archived-layer-data';layer_sha=hashlib.sha256(layer).hexdigest()
  config={'rootfs':{'diff_ids':['sha256:'+layer_sha]},'config':{'Env':['TOKEN=secret-canary' if secret else 'SAFE=true']}}
  raw=json.dumps(config,separators=(',',':')).encode();image='sha256:'+hashlib.sha256(raw).hexdigest();name=image[7:]+'.json'
  manifest=[{'Config':name,'Layers':['layer/layer.tar'],'RepoTags':['protected-app:latest'] if tagged else None}]
  if extra_image:manifest.append(manifest[0])
  entries=[(name,raw),('layer/layer.tar',b'bad' if wrong_layer else layer),('manifest.json',json.dumps(manifest).encode())]
  if oci:entries.append(('index.json',b'{}'))
  if unsafe:entries.append(('../escape',b'no'))
  if duplicate:entries.append((name,raw))
  with tarfile.open(self.path,'w:gz') as t:
   for key,data in entries:
    m=tarfile.TarInfo(key);m.size=len(data);t.addfile(m,io.BytesIO(data))
  return image
 def test_valid_archive(self):
  image=self.fixture();r=verify(self.path,[image]);self.assertEqual(r['imageCount'],1);self.assertFalse(r['dockerLoadExecuted']);self.assertFalse(r['repoDigestRestorationVerified'])
 def test_corrupt_layer(self):
  image=self.fixture(wrong_layer=True)
  with self.assertRaisesRegex(InvalidArchive,'LAYER_CONTENT'):verify(self.path,[image])
 def test_path_escape(self):
  image=self.fixture(unsafe=True)
  with self.assertRaisesRegex(InvalidArchive,'PATH_UNSAFE'):verify(self.path,[image])
 def test_duplicate_member(self):
  image=self.fixture(duplicate=True)
  with self.assertRaisesRegex(InvalidArchive,'DUPLICATE_MEMBER'):verify(self.path,[image])
 def test_unexpected_image(self):
  image=self.fixture(extra_image=True)
  with self.assertRaisesRegex(InvalidArchive,'MANIFEST_IMAGE_COUNT'):verify(self.path,[image])
 def test_gzip_crc_failure(self):
  image=self.fixture();b=bytearray(self.path.read_bytes());b[-8]^=1;self.path.write_bytes(b)
  with self.assertRaises((gzip.BadGzipFile,tarfile.ReadError)):verify(self.path,[image])
 def test_truncated_gzip(self):
  image=self.fixture();self.path.write_bytes(self.path.read_bytes()[:-6])
  with self.assertRaises((EOFError,tarfile.ReadError)):verify(self.path,[image])
 def test_uncompressed_budget(self):
  image=self.fixture()
  with self.assertRaisesRegex(InvalidArchive,'UNCOMPRESSED.*LIMIT'):verify(self.path,[image],max_uncompressed=1)
 def test_symlink_archive(self):
  image=self.fixture();link=self.path.with_name('link.gz');link.symlink_to(self.path)
  with self.assertRaisesRegex(InvalidArchive,'NOT_REGULAR'):verify(link,[image])
 def test_trailing_stream_budget(self):
  image=self.fixture()
  content=gzip.decompress(self.path.read_bytes())+b'X'*(4*1024*1024)
  self.path.write_bytes(gzip.compress(content))
  with self.assertRaisesRegex(InvalidArchive,'UNCOMPRESSED_STREAM_LIMIT'):verify(self.path,[image],max_uncompressed=32768)
 def test_pax_metadata_budget(self):
  image=self.fixture()
  content=gzip.decompress(self.path.read_bytes())
  with tarfile.open(self.path,'w:gz',format=tarfile.PAX_FORMAT) as t:
   m=tarfile.TarInfo('metadata');m.size=0;m.pax_headers={'comment':'x'*(1024*1024)};t.addfile(m,io.BytesIO(b''))
  with self.assertRaisesRegex(InvalidArchive,'PAX_METADATA_LIMIT|UNCOMPRESSED_STREAM_LIMIT'):verify(self.path,[image],max_uncompressed=2*1024*1024)
 def test_returned_hash_matches_compressed_bytes(self):
  image=self.fixture();r=verify(self.path,[image]);self.assertEqual(r['archiveSha256'],hashlib.sha256(self.path.read_bytes()).hexdigest())
 def test_mutation_preserving_size_and_mtime_rejected(self):
  image=self.fixture();before=self.path.stat()
  from unittest.mock import patch
  from verify_docker_archive import HashingReader
  original=HashingReader.read;once=[False]
  def changed(reader,size=-1):
   if not once[0]:
    once[0]=True;b=bytearray(self.path.read_bytes());b[9]^=1;self.path.write_bytes(b);os.utime(self.path,ns=(before.st_atime_ns,before.st_mtime_ns))
   return original(reader,size)
  with patch.object(HashingReader,'read',changed):
   with self.assertRaisesRegex(InvalidArchive,'ARCHIVE_CHANGED_DURING_VERIFY'):verify(self.path,[image])
 def test_unexpected_tags_rejected(self):
  image=self.fixture(tagged=True)
  with self.assertRaisesRegex(InvalidArchive,'UNEXPECTED_REPOSITORY_TAGS'):verify(self.path,[image])
 def test_oci_layout_rejected(self):
  image=self.fixture(oci=True)
  with self.assertRaisesRegex(InvalidArchive,'OCI_LAYOUT_REQUIRES_SEPARATE_REVIEW'):verify(self.path,[image])
 def test_cumulative_pax_metadata_budget(self):
  image=self.fixture()
  with tarfile.open(self.path,'w:gz',format=tarfile.PAX_FORMAT) as t:
   for i in range(100):
    m=tarfile.TarInfo('entry-'+str(i));m.size=0;m.pax_headers={'comment':'x'*60000};t.addfile(m,io.BytesIO(b''))
  with self.assertRaisesRegex(InvalidArchive,'CUMULATIVE_METADATA_LIMIT'):verify(self.path,[image])
 def test_no_config_disclosure(self):
  image=self.fixture(secret=True);self.assertNotIn('secret-canary',json.dumps(verify(self.path,[image])))
if __name__=='__main__':unittest.main()
