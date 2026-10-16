"""Pure closed-release activation renderer. No writes, network or qualification."""
from pathlib import Path
import hashlib,json,sys,types,re
HERE=Path(__file__).resolve().parent
def require(ok,code):
 if not ok:raise RuntimeError(code)
def sha(x):return hashlib.sha256(x).hexdigest()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def source_inputs(package):
 require(type(ACTIVATION_PINS) is dict and set(ACTIVATION_PINS)=={'sourceManifestSha256','builderSha256','canonicalDefaultSha256'} and all(type(x) is str and re.fullmatch('[a-f0-9]{64}',x) for x in ACTIVATION_PINS.values()),'SEQUENCE_ACTIVATION_MEASURED_PINS')
 p=Path(package)/'fixed-host/sequence/build-functions-entry.py';raw=p.read_bytes()
 require(sha(raw)==ACTIVATION_PINS['builderSha256'],'SEQUENCE_ACTIVATION_BUILDER')
 m=types.ModuleType('sequence_activation_builder');m.__file__=str(p);exec(compile(raw,str(p),'exec'),m.__dict__)
 inputs=m.load_source_inputs()
 require(sha(m.render_entry(inputs))==ACTIVATION_PINS['canonicalDefaultSha256'],'SEQUENCE_ACTIVATION_DEFAULT')
 return m,inputs
def render(package,release_bytes,remote_fact):
 builder,inputs=source_inputs(package)
 require(type(release_bytes) is bytes and len(release_bytes)<65536,'SEQUENCE_RELEASE_BYTES')
 release=json.loads(release_bytes);builder.validate_release(inputs,release)
 require(builder.encoded(release).encode()==release_bytes,'SEQUENCE_RELEASE_CANONICAL')
 d=release['profiles']['takeda']
 original=builder.module('fixed-host/install/activation-renderer.py',inputs['fixed-host/install/activation-renderer.py'])
 original.verify_remote_fact(remote_fact,d['build']['commitSha'])
 require(d['expectedRow']['status']=='BUILDING' and d['expectedRow']['commitSha']==d['build']['commitSha'] and d['expectedRow']['sourceTreeHash']==d['build']['sourceTreeSha256'] and d['expectedRow']['runtimeTreeHash']==d['build']['runtimeTreeSha256'],'SEQUENCE_ACTIVATION_IDENTITY')
 require(not d['candidate']['id'].startswith('synthetic-') and d['build']['commitSha']!='1'*40 and not d['build']['commitSha'].startswith('d02f4f5') and d['databaseIdentity']['dbSnapshotHash']!='e'*64,'SEQUENCE_REAL_IDENTITY')
 digest=sha(release_bytes);disabled=builder.render_entry(inputs,release)
 enabled=original.enable_exact(disabled,digest)
 profiles={name:{'deploymentSha256':sha(builder.encoded(release['profiles'][name]).encode()),'cliSha256':release['artifacts'][name]['fixed-'+name+'-preimport-launch.py']} for name in builder.ORDER}
 binding={'schemaVersion':1,**ACTIVATION_PINS,'deploymentSha256':digest,'deployment':d,'release':release,'profiles':profiles,'remoteCommit':remote_fact,'cliSha256':profiles['takeda']['cliSha256'],'disabledEntrySha256':sha(disabled),'disabledEntryBytes':len(disabled),'enabledEntrySha256':sha(enabled),'enabledEntryBytes':len(enabled)}
 binding['bindingSha256']=sha(canonical(binding).encode())
 return {'binding':binding,'disabled':disabled,'enabled':enabled}
