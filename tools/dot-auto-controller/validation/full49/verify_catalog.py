"""Read-only comparison of saved native full49 catalog output; no DB connection."""
from pathlib import Path
import json,sys
R=Path(__file__).resolve().parent
def verify(row):
 manifest=json.loads((R/'INPUT_MANIFEST.json').read_text());expected=json.loads((R/'CATALOG_EXPECTED.json').read_text())
 if not 170000<=int(row['serverVersion'])<180000:raise ValueError('PG17_REQUIRED')
 ledger=row['ledger']
 if len(ledger)!=49 or len({r['migrationName'] for r in ledger})!=49:raise ValueError('EXACT49_LEDGER_REQUIRED')
 if any(not r['finished'] or r['rolledBack'] for r in ledger):raise ValueError('INCOMPLETE_LEDGER')
 if sorted([{'migrationName':r['migrationName'],'checksum':r['checksum']} for r in ledger],key=lambda x:x['migrationName'])!=manifest['prior49']:raise ValueError('LEDGER_BYTES_DRIFT')
 if not row['crypto'] or row['crypto']['name']!='pgcrypto' or row['crypto']['schema']!='extensions':raise ValueError('NATIVE_PGCRYPTO_REQUIRED')
 if row['functions']!=expected['functions']:raise ValueError('FUNCTION_DEFINITION_DRIFT')
 if row['baselineCheckMd5']!=expected['baselineCheckMd5'] or row['sourceGuardProsrcSha256']!=expected['sourceGuardProsrcSha256']:raise ValueError('SOURCE_GUARD_DRIFT')
 actual=row['triggers']
 if len(actual)!=len(expected['triggers']):raise ValueError('TRIGGER_COUNT')
 for wanted in expected['triggers']:
  matches=[t for t in actual if t['tableName']==wanted['tableName'] and t['name']==wanted['name']]
  if len(matches)!=1 or any(matches[0].get(k)!=v for k,v in {**wanted,'enabled':'O','deferrable':True,'initiallyDeferred':True}.items()):raise ValueError('TRIGGER_PROFILE_DRIFT')
 if row['fencePresent'] is not False:raise ValueError('NOT_BEFORE_RETIREMENT')
 return {'status':'FULL49_CATALOG_MATCH_ONLY','nativeReplayProvenByThisRead':False,'concurrencyPassed':False,'publisherFixtureQualified':False}
if __name__=='__main__':print(json.dumps(verify(json.load(open(sys.argv[1]))),indent=2))
