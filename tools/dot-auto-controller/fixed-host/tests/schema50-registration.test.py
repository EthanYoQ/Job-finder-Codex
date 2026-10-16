"""Static renderer assertions only; no database engine or catalog qualification."""
from pathlib import Path
import importlib.util,hashlib,json
root=Path(__file__).resolve().parents[1];path=root/'scripts/render-schema50-retirement.py'
spec=importlib.util.spec_from_file_location('registration',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
row={k:'a'*64 for k in m.FIELDS};row.update(id=m.TARGET,goalId=m.GOAL,version=75,commitSha=m.COMMIT,status='BUILDING',finalizedAt=None,releaseQaEvidenceSha256=None,minimumStableCompanyCount=41,migrationVersion='20261006172300_job_projection_delta_contract',oracleVersion='staged-official-source-v1',createdAt='2026-10-11 10:08:08.337')
sql=m.transaction(row);ddl=m.guard_ddl()
assert sql.startswith('BEGIN ISOLATION LEVEL READ COMMITTED;') and sql.endswith('COMMIT;\n')
assert sql.count(ddl)==1
assert sql.index('SCHEMA50_PRIOR_HISTORY_DRIFT')<sql.index(ddl)<sql.index('INSERT INTO public."_prisma_migrations"')<sql.index('UPDATE public."ReleaseCandidate" SET status')
assert 'clock_timestamp()' in m.registration_preflight() and 'clock_timestamp()' in m.registration_finish(ddl)
assert '"prismaEngineExecuted":false' in m.registration_finish(ddl)
assert hashlib.sha256(ddl.encode()).hexdigest() in m.registration_finish(ddl)
assert 'ON CONFLICT' not in sql and 'UPDATE public."_prisma_migrations"' not in sql
assert 'V75_FENCE_ALREADY_PRESENT_RECONCILE_DO_NOT_RETRY' in sql
assert 'UPDATE public."ReleaseCandidate"' not in ddl and '_prisma_migrations' not in ddl
for field,value in [('id','other'),('version',76),('status','INVALIDATED'),('commitSha','b'*40)]:
 try:m.transaction({**row,field:value})
 except ValueError:pass
 else:raise AssertionError('Tuple drift accepted: '+field)
for key,value in row.items():
 if not isinstance(value,str):continue
 try:m.transaction({**row,key:'$v75_preflight$'})
 except ValueError:pass
 else:raise AssertionError('Unsafe delimiter accepted: '+key)
for malformed in ['$v75_preflight$; SELECT 1; --', "quote'", 'not-a-hash']:
 try:m.transaction({**row,'schemaHash':malformed})
 except ValueError:pass
 else:raise AssertionError('Unsafe hash accepted')
try:m.registration_finish(ddl+'--tampered')
except ValueError:pass
else:raise AssertionError('Tampered DDL registered')
# Ensure the transaction consumes one validated DDL snapshot, never a second read.
original=m.guard_ddl;calls=[]
def once():
 calls.append(1)
 if len(calls)>1:raise AssertionError('DDL reread')
 return original()
m.guard_ddl=once;m.transaction(row);assert len(calls)==1
print(json.dumps({'kind':'SCHEMA50_REGISTRATION_STATIC_TESTS','passed':True,'databaseExecuted':False,'atomicRollbackActuallyTested':False}))
