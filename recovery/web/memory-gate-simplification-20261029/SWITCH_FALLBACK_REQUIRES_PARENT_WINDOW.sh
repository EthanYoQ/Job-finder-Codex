set -eu
python3 - <<'PY'
from pathlib import Path
import hashlib,urllib.request
rows=[{'role': 'fallback', 'relativePath': 'src/crawler/traversalCertificate.ts', 'candidatePath': '/workspace/scratch/5e9614251709/recovery104-work/bi-bayer-compact-integration-20261029T1319Z/remote-restored-tree/tools/dot-auto-controller/vendor/reader-fallback/src/crawler/traversalCertificate.ts', 'expectedOldLocalSha256': '2bf94ec1f6bff40d86d875e2fcf983913dc32bbe8060a44f9e10ea4c0caf1604', 'newSha256': '1cf286c9fa1aec06590de9ba6386ac2b03e3da3e92dc56c0816ad074313bf375', 'newBytes': 116386, 'liveVerified': True, 'liveSha256': '2bf94ec1f6bff40d86d875e2fcf983913dc32bbe8060a44f9e10ea4c0caf1604', 'absoluteTarget': '/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/compatible-fallback/src/crawler/traversalCertificate.ts'}, {'role': 'fallback', 'relativePath': 'src/domain/portablePublicSnapshot.ts', 'candidatePath': '/workspace/scratch/5e9614251709/recovery104-work/bi-bayer-compact-integration-20261029T1319Z/remote-restored-tree/tools/dot-auto-controller/vendor/reader-fallback/src/domain/portablePublicSnapshot.ts', 'expectedOldLocalSha256': '8d31a7206da617d9b4e586ac1e8f52822c69e9495f8c3bea773323891fad4a6d', 'newSha256': '92a587b5fef630659c76ddf403c0c09e66576e7519ff6168e603161c27f3ed07', 'newBytes': 31166, 'liveVerified': True, 'liveSha256': '8d31a7206da617d9b4e586ac1e8f52822c69e9495f8c3bea773323891fad4a6d', 'absoluteTarget': '/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/compatible-fallback/src/domain/portablePublicSnapshot.ts'}]
for r in rows:
 assert hashlib.sha256(Path(r['absoluteTarget']).read_bytes()).hexdigest()==r['liveSha256']
 assert hashlib.sha256((Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.compact-bayer-stage-20261029T1355Z')/'new'/r['role']/r['relativePath']).read_bytes()).hexdigest()==r['newSha256']
 assert hashlib.sha256((Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.compact-bayer-stage-20261029T1355Z')/'rollback'/r['role']/r['relativePath']).read_bytes()).hexdigest()==r['liveSha256']
assert urllib.request.urlopen('http://127.0.0.1:3036/readyz',timeout=5).status==200
assert '127.0.0.1:3036' in Path('/etc/nginx/conf.d/job.conf').read_text()
PY
/usr/bin/pm2 stop 57 >/dev/null
python3 - <<'PY'
from pathlib import Path
import hashlib,shutil,json
mem=int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))
print(json.dumps({'stoppedRole':'fallback','MemAvailableKB':mem,'historicalRequiredKB_NotCurrentGate':704052}))
for r in [{'role': 'fallback', 'relativePath': 'src/crawler/traversalCertificate.ts', 'candidatePath': '/workspace/scratch/5e9614251709/recovery104-work/bi-bayer-compact-integration-20261029T1319Z/remote-restored-tree/tools/dot-auto-controller/vendor/reader-fallback/src/crawler/traversalCertificate.ts', 'expectedOldLocalSha256': '2bf94ec1f6bff40d86d875e2fcf983913dc32bbe8060a44f9e10ea4c0caf1604', 'newSha256': '1cf286c9fa1aec06590de9ba6386ac2b03e3da3e92dc56c0816ad074313bf375', 'newBytes': 116386, 'liveVerified': True, 'liveSha256': '2bf94ec1f6bff40d86d875e2fcf983913dc32bbe8060a44f9e10ea4c0caf1604', 'absoluteTarget': '/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/compatible-fallback/src/crawler/traversalCertificate.ts'}, {'role': 'fallback', 'relativePath': 'src/domain/portablePublicSnapshot.ts', 'candidatePath': '/workspace/scratch/5e9614251709/recovery104-work/bi-bayer-compact-integration-20261029T1319Z/remote-restored-tree/tools/dot-auto-controller/vendor/reader-fallback/src/domain/portablePublicSnapshot.ts', 'expectedOldLocalSha256': '8d31a7206da617d9b4e586ac1e8f52822c69e9495f8c3bea773323891fad4a6d', 'newSha256': '92a587b5fef630659c76ddf403c0c09e66576e7519ff6168e603161c27f3ed07', 'newBytes': 31166, 'liveVerified': True, 'liveSha256': '8d31a7206da617d9b4e586ac1e8f52822c69e9495f8c3bea773323891fad4a6d', 'absoluteTarget': '/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/compatible-fallback/src/domain/portablePublicSnapshot.ts'}]:
 target=Path(r['absoluteTarget']);assert hashlib.sha256(target.read_bytes()).hexdigest()==r['liveSha256']
 shutil.copyfile(Path('/opt/jobfinder-candidates/release-f9f05a9eefc32e5095de4c9b/.compact-bayer-stage-20261029T1355Z')/'new'/r['role']/r['relativePath'],target)
 assert hashlib.sha256(target.read_bytes()).hexdigest()==r['newSha256']
PY
/usr/bin/pm2 restart 57 >/dev/null
python3 - <<'PY'
import urllib.request,time,json
end=time.monotonic()+60
while True:
 try:
  r=urllib.request.urlopen('http://127.0.0.1:3031/readyz',timeout=5)
  if r.status==200:print(json.dumps({'role':'fallback','readyHttp':200}));break
 except Exception:pass
 if time.monotonic()>=end:raise RuntimeError('READY_TIMEOUT_KEEP_OTHER_SIDE_SERVING_USE_ORIGINAL_ROLLBACK')
 time.sleep(1)
PY
