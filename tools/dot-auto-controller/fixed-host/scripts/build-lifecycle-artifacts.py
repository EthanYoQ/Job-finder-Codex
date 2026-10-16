#!/usr/bin/python3
"""Deterministic lifecycle source generation; default loader is disabled.
Offline render methods create no files and grant no production authority.
"""
from pathlib import Path
import hashlib,json

HOST=Path(__file__).resolve().parents[1]
TOKEN='__FIXED_LIFECYCLE_BINDING__'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(ok,code):
    if not ok:raise RuntimeError(code)

def render_loader(template,digest_source,binding=None):
    require(template.count(TOKEN)==1 and template.count('__FIXED_SHA256_SOURCE__')==1,'LIFECYCLE_TEMPLATE')
    if binding is not None:
        require(set(binding)=={'holderPath','holderSha256','stableDirectory','entrySha256','entryBytes'},'LIFECYCLE_LOADER_BINDING_KEYS')
    return template.replace(TOKEN,json.dumps(binding,separators=(',',':'))).replace('__FIXED_SHA256_SOURCE__',json.dumps(digest_source)).encode()

def render_offline_module(source,cases_root):
    root=Path(cases_root)
    require(root.is_absolute() and root.name=='lifecycle-cases' and 'job-finder-fixed-live-controller-v1' not in root.parts,'LIFECYCLE_OFFLINE_RENDER_ONLY')
    require(source.count('__FIXED_LIFECYCLE_SCOPE__')==1,'LIFECYCLE_MODULE_TOKEN')
    return source.replace('__FIXED_LIFECYCLE_SCOPE__',repr({'kind':'TEST_ONLY','casesRoot':str(root)})).encode()

def render_fixed_module(source):
    """Pure bytes only. Does not inspect/create LIVE, lock or owner directory.
    Installer provisions exact domain once and pins actual parent/lock inodes.
    This fixed policy is not DB, reader, installation or remote-source authority.
    """
    require(source.count('__FIXED_LIFECYCLE_SCOPE__')==1,'LIFECYCLE_MODULE_TOKEN')
    policy={'kind':'FIXED_PRODUCTION_SOURCE','parent':'/workspace/scratch/5e9614251709','target':'job-finder-fixed-live-controller-v1'}
    return source.replace('__FIXED_LIFECYCLE_SCOPE__',repr(policy)).encode()


def render_holder(template,binding=None):
    require(template.count(TOKEN)==1,'LIFECYCLE_HOLDER_TOKEN')
    return template.replace(TOKEN,repr(binding)).encode()

def render_fixed_owner_bundle(sources,domain,entry_sha256,entry_bytes,cli_sha256,
                              activation_helper_sha256=None,deployment_binding=None,
                              registration_sql=None):
    """Pure reviewed fixed-owner artifacts; caller publishes while original EX held.
    `sources` are canonical builder-verified source bytes. Domain must come from
    the installer-owned one-time provision, never inferred from a target file.
    No file is read/created, and null activation remains unqualified.
    """
    import re
    target='job-finder-fixed-live-controller-v1'
    parent='/workspace/scratch/5e9614251709'
    owner=parent+'/.'+target+'.lifecycle-owner'
    require(type(domain) is dict and set(domain)=={'parent','target','parentIdentity','lockIdentity'} and domain['parent']==parent and domain['target']==target,'FIXED_OWNER_DOMAIN')
    require(all(type(domain[k]) in (list,tuple) and len(domain[k])==2 and all(type(v) is int and v>=0 for v in domain[k]) for k in ('parentIdentity','lockIdentity')),'FIXED_OWNER_INODES')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for v in (entry_sha256,cli_sha256)) and type(entry_bytes) is int and 0<entry_bytes<=1024*1024,'FIXED_OWNER_PINS')
    get=lambda n:sources['fixed-host/'+n].decode()
    module=render_fixed_module(get('lifecycle/lifecycle_lock.py'))
    holder_binding={'modulePath':owner+'/lifecycle_lock.py','moduleSha256':sha(module),'domain':domain,'entrySha256':entry_sha256,'entryBytes':entry_bytes}
    holder=render_holder(get('lifecycle/holder.py.in'),holder_binding)
    loader_binding={'holderPath':owner+'/holder.py','holderSha256':sha(holder),'stableDirectory':owner,'entrySha256':entry_sha256,'entryBytes':entry_bytes}
    out={'lifecycle_lock.py':module,'cli-entry.py':sources['fixed-host/lifecycle/cli-entry.py'],
         'binding.json':json.dumps({'domain':domain,'moduleSha256':sha(module),'cliSha256':cli_sha256},sort_keys=True,separators=(',',':')).encode(),
         'holder.py':holder,'functions-loader.js':render_loader(get('functions/lifecycle-loader.template.js'),get('functions/sha256.js'),loader_binding)}
    activation=None
    if deployment_binding is not None:
        require(type(activation_helper_sha256) is str and re.fullmatch('[a-f0-9]{64}',activation_helper_sha256) and type(registration_sql) is str and registration_sql,'FIXED_ACTIVATION_SOURCE_PINS')
        ex_binding={k:holder_binding[k] for k in ('modulePath','moduleSha256','domain')}
        ex_binding.update(helperPath=owner+'/local-activation.py',helperSha256=activation_helper_sha256)
        exclusive=render_holder(get('lifecycle/exclusive-holder.py.in'),ex_binding)
        out['exclusive-holder.py']=exclusive
        activation={'holderPath':owner+'/exclusive-holder.py','holderSha256':sha(exclusive),'stableDirectory':owner,'registrationSql':registration_sql,'deploymentBinding':deployment_binding}
    else:
        require(activation_helper_sha256 is None and registration_sql is None,'FIXED_ACTIVATION_NULL_BINDING')
    rows=next(line for line in get('functions/host-helper.js').splitlines() if line.startswith('function rows('))
    out['functions-activate.js']=render_activation(get('functions/lifecycle-activation.template.js'),get('functions/sha256.js'),rows,activation)
    return out


def default_loader():
    return render_loader((HOST/'functions/lifecycle-loader.template.js').read_text(),
                         (HOST/'functions/sha256.js').read_text())

def render_activation(template,digest_source,rows_source,binding=None):
    require(template.count(TOKEN)==1 and template.count('__FIXED_SHA256_SOURCE__')==1 and template.count('__FIXED_ROWS_SOURCE__')==1,'LIFECYCLE_ACTIVATION_TEMPLATE')
    return template.replace(TOKEN,json.dumps(binding,separators=(',',':'))).replace('__FIXED_SHA256_SOURCE__',json.dumps(digest_source)).replace('__FIXED_ROWS_SOURCE__',json.dumps(rows_source)).encode()

def default_activation():
    rows=next(line for line in (HOST/'functions/host-helper.js').read_text().splitlines() if line.startswith('function rows('))
    return render_activation((HOST/'functions/lifecycle-activation.template.js').read_text(),(HOST/'functions/sha256.js').read_text(),rows)

if __name__=='__main__':
    import sys
    require(sys.argv[1:]==['check-default'],'LIFECYCLE_BUILD_OPERATION')
    raw=default_loader()
    require(raw==(HOST/'functions-loader.js').read_bytes() and default_activation()==(HOST/'functions-activate.js').read_bytes(),'LIFECYCLE_DEFAULT_BYTES')
    print(json.dumps({'kind':'LIFECYCLE_DEFAULT_DISABLED','sha256':sha(raw),
                      'productionQualified':False,'activation':False}))
