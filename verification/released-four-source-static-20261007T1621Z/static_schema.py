"""Strict source configuration schema. This module never reads operational state."""
import hashlib, json

SOURCE_FIELDS = {'id','companyId','kind','atsKind','status','officialEntryUrl','officialChainEvidenceUrl'}
ROW_FIELDS = {'sourceKey','sourceId','route','source','sourceConfigSha256','currentSourcePlan','implementations'}
TOP_FIELDS = {'schemaVersion','artifactKind','runtimeRoot','producerCommit','nodeVersion','sources'}
SOURCES = {
    'novo': ('source-novo-nordisk-china-social','PORTABLE','40305820c3aa3f36e74f06873c0ddd1a52266cb74d277b3a36137c81fc5c604e'),
    'ucb': ('source-ucb-china-social','PORTABLE','0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146'),
    'hengrui': ('source-hengrui-social','PORTABLE','93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e'),
    'roche': ('source-roche-china-social','TRUE_A','d0e8002bbc03e3da46bbb02c30b533b5b968f38ac5db2c357c009de2eb4066ed'),
}
FORBIDDEN = {'checkedAt','referenceCheckedAt','manualEntry','selectedReferenceArtifact','originalRouteFile','lastAcceptedBinding','registeredExecutionBinding','restoredHostStatus','preparationStatus','originalProcessTerminal','historicalOriginalProcessTerminal','historicalBindingsAreReferenceOnly','archiveRetention','remoteArchiveRetention','recoveryVerification','candidateRow'}

def exact(value, keys, label):
    if not isinstance(value,dict) or set(value) != set(keys):
        raise ValueError('STATIC_FIELDS_REQUIRED:'+label)

def no_history(value):
    if isinstance(value,dict):
        for key,item in value.items():
            if key in FORBIDDEN: raise ValueError('HISTORICAL_METADATA_FORBIDDEN:'+key)
            no_history(item)
    elif isinstance(value,list):
        for item in value: no_history(item)

def validate_inputs(data):
    exact(data,TOP_FIELDS,'root');no_history(data)
    assert data['schemaVersion']==1 and data['artifactKind']=='STATIC_SOURCE_CONFIGURATION_ONLY','STATIC_INPUT_KIND'
    assert data['producerCommit']=='28402a299bb04cbf5873da66c2fe8ca76827c0d1' and data['nodeVersion']=='v22.23.3','STATIC_PRODUCER'
    assert isinstance(data['sources'],list) and len(data['sources'])==4,'STATIC_SOURCE_COUNT'
    seen=set()
    for row in data['sources']:
        exact(row,ROW_FIELDS,'source');key=row['sourceKey'];assert key in SOURCES and key not in seen,'STATIC_SOURCE_KEY';seen.add(key)
        assert (row['sourceId'],row['route'],row['sourceConfigSha256'])==SOURCES[key],'STATIC_SOURCE_TUPLE'
        exact(row['source'],SOURCE_FIELDS,'source-config')
        assert all(isinstance(v,str) and v for v in row['source'].values()),'STATIC_SOURCE_VALUES'
        assert row['source']['id']==row['sourceId'],'STATIC_SOURCE_ID'
        plan=row['currentSourcePlan'];assert isinstance(plan,dict),'STATIC_FULL_PLAN_REQUIRED'
        common={'adapterId','company','source','executionAuthority','expectedChannels','expectedChannelSetHash','json','transportPolicy'}
        extra={'novo':{'officialJsonFetch','transientRetryPolicy'},'ucb':{'officialJsonFetch'},'hengrui':{'moka'},'roche':{'officialJsonFetch','transientRetryPolicy'}}
        exact(plan,common|extra[key],'complete-plan')
        for field in ['adapterId','company','source','executionAuthority','expectedChannels','expectedChannelSetHash','json','transportPolicy']:
            if field not in plan: raise ValueError('STATIC_PLAN_FIELD_REQUIRED:'+field)
        assert all(plan['source'].get(k)==v for k,v in row['source'].items()),'STATIC_SOURCE_PLAN_BINDING'
        assert isinstance(row['implementations'],list) and len(row['implementations'])==5,'STATIC_IMPLEMENTATIONS'
        roles=set()
        for item in row['implementations']:
            exact(item,{'role','path','sha256'},'implementation');roles.add(item['role'])
            assert isinstance(item['path'],str) and not item['path'].startswith('/') and '..' not in item['path'].split('/'),'STATIC_IMPLEMENTATION_PATH'
            assert isinstance(item['sha256'],str) and len(item['sha256'])==64 and all(x in '0123456789abcdef' for x in item['sha256']),'STATIC_IMPLEMENTATION_HASH'
        assert roles=={'entrypoint','quality','sourcePlan','archive','wrapper'},'STATIC_IMPLEMENTATION_ROLES'
    assert seen==set(SOURCES),'STATIC_SOURCE_SET'
    return data
