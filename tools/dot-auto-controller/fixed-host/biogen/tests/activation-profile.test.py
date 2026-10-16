"""Pure regression assertions; full original EX qualify/activate is a separate suite."""
from pathlib import Path
import hashlib,runpy
P=Path(__file__).resolve().parents[1];HOST=P.parent
original=(HOST/'install/templates/local-activation.py.in').read_text();profile=(P/'local-activation.py.in').read_text()
old="PACKAGE/'fixed-host/scripts/build-functions-entry.py'";new="PACKAGE/'fixed-host/biogen/build-functions-entry.py'"
assert original.count(old)==1 and profile.count(new)==1
assert profile.replace(new,old)==original,'All original qualification/raw/deadline/EX/history logic must be byte-identical'
a=(P/'activation-renderer.py').read_text();b=(P/'bound-artifacts.py.in').read_text()
assert "HERE/'local-activation.py.in'" in a
assert "source('fixed-host/biogen/local-activation.py.in')" in b
assert "source('fixed-host/install/templates/local-activation.py.in')" not in b
old_hash=hashlib.sha256((HOST/'scripts/build-functions-entry.py').read_bytes()).hexdigest();new_hash=hashlib.sha256((P/'build-functions-entry.py').read_bytes()).hexdigest()
assert old_hash!=new_hash,'Regression requires distinct actual builder identities'
print({'passed':True,'cases':6,'oldBuilderSha256':old_hash,'profileBuilderSha256':new_hash,'newExecutionAuthority':False})
