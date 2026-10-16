"""Stage reviewed candidate-only additions in an ephemeral source copy. No DB access."""
from pathlib import Path
import hashlib,json,shutil,sys
root=Path(__file__).resolve().parent
controller=Path(sys.argv[1]).resolve()
pins=json.loads((root/'BASE_SOURCE_PINS.json').read_text())
for rel,want in pins['gitBlobSha1'].items():
 data=(controller/rel).read_bytes()
 if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=want:raise ValueError('BASE_SOURCE_DRIFT:'+rel)
manifest=json.loads((root/'INPUT_MANIFEST.json').read_text())
# Bind all49 existing source migrations to reviewed input bytes before staging.
for m in manifest['prior49']:
 src=controller/'vendor/c60-source/prisma/migrations'/m['migrationName']/'migration.sql'
 data=src.read_bytes()
 if hashlib.sha256(data).hexdigest()!=m['checksum']:raise ValueError('BASE_MIGRATION_DRIFT:'+m['migrationName'])
 dst=root/'migrations49'/m['migrationName']/'migration.sql';dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(data)
for rel,want in json.loads((root/'SOURCE_OVERLAY_PINS.json').read_text()).items():
 data=(root/'source-overlay'/rel).read_bytes()
 if hashlib.sha256(data).hexdigest()!=want:raise ValueError('SOURCE_OVERLAY_DRIFT:'+rel)
 dst=controller/rel;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(data)
for src in (root/'overlay/tests/helpers').glob('nativeFull49*.ts'):
 shutil.copyfile(src,controller/'vendor/c60-source/tests/helpers'/src.name)
shutil.copyfile(root/'tsconfig.native-full49.json',controller/'vendor/c60-source/tsconfig.native-full49.json')
print(json.dumps({'status':'TEST_SOURCE_ASSEMBLED_ONLY','all49Matched':True,'databaseExecutions':0,'sourceOverlayFiles':4}))
