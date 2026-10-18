#!/usr/bin/env python3
"""Recovered from the 2026-10-18 04:43 packaging script; packaging only, no upload."""
import argparse, base64, hashlib, json, pathlib, re, tarfile

OMIT = {'check','cookie','cookies','authorization','accesstoken','refreshtoken','sessionid','tabid','browsercontextid','apikey','privatekey','bundlepath'}
def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items() if key.lower() not in OMIT}
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value

def raw_files(archive):
    for item in archive['files']:
        raw = base64.b64decode(''.join(item['chunks']))
        assert len(raw) == item['byteCount'] and hashlib.sha256(raw).hexdigest() == item['sha256']
        assert not re.search(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}', raw)
    return len(archive['files'])

def pack(runs, relay, output, request_ids):
    # shortcut: the runtime backs up one completed source; use separate calls for separate runs.
    assert len(runs) == 1, 'ONE_RUN_PER_PACKAGE_REQUIRED'
    assert request_ids and len(request_ids) == len(set(request_ids)), 'RELAY_REQUEST_IDS_REQUIRED'
    requests = {}
    for request_id in request_ids:
        assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', request_id), 'RELAY_REQUEST_ID'
        request = json.loads((relay/(request_id+'.request.json')).read_text())
        response = json.loads((relay/(request_id+'.response.json')).read_text())
        body = {key:value for key,value in request.items() if key != 'requestSha256'}
        digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, separators=(',',':')).encode()).hexdigest()
        assert request['requestId'] == request_id and request['requestSha256'] == digest, 'RELAY_REQUEST_HASH'
        assert all(response[key] == request[key] for key in ['schemaVersion','requestId','requestSha256','kind']), 'RELAY_RESPONSE_BINDING'
        assert request['schemaVersion'] == 1 and request['payload']['projectId'] == 'yiopvxysxrtrnvqxwgbx', 'RELAY_PROJECT_BINDING'
        requests.setdefault(request['kind'], []).append((request,response))
    assert set(requests) == {'READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME'}, 'RELAY_KINDS_INCOMPLETE'
    assert len(requests['PUBLISH']) == 1, 'RELAY_PUBLICATION_COUNT'
    members, summary = {}, []
    for run in runs:
        source, batch = run.parent.name, run.name
        assert source not in {row['source'] for row in summary}
        selected = {'OUTCOME.json': next((run/'artifacts').glob('*.outcome.json'))}
        web_name = 'WEB_READBACK_VERIFIED.json' if (run/'WEB_READBACK_VERIFIED.json').exists() else 'WEB_READBACK_PENDING.json'
        selected[web_name] = run/web_name
        for name in ['PACKET_REVIEW.json','NATIVE_RAW_REPLAY.json','ORIGINAL_DEPLOYED_READER_REPLAY.json','EXPECTED_TARGET_API.json']:
            if (run/'review'/name).exists(): selected['review/'+name] = run/'review'/name
        for name in ['CURRENT_SET_DIFF_SUMMARY.json','WEB_REFRESH_INITIAL_FAILURE.json']:
            if (run/name).exists(): selected[name] = run/name
        for folder in ['independent-dom','independent-validation']:
            for path in (run/folder).glob('*.json'): selected[folder+'/'+path.name] = path
        for path in (run/'artifacts').glob('*.independent-validation.json'):
            selected['independent-validation-certificate.json'] = path
        selected = {name:json.loads(path.read_text()) for name,path in selected.items()}
        outcome, review = selected['OUTCOME.json'], selected['review/PACKET_REVIEW.json']
        publication, published = requests['PUBLISH'][0]
        assert review['requestId'] == publication['requestId'] and review['requestSha256'] == publication['requestSha256'], 'REVIEW_REQUEST_BINDING'
        assert review['sqlSha256'] == hashlib.sha256(publication['payload']['sql'].encode()).hexdigest(), 'REVIEW_SQL_BINDING'
        tuple_ = review['tuple']
        assert tuple_['batchId'] == batch and all(tuple_[key] == outcome[key] for key in ['batchId','sourceId','sourceResultId']), 'OUTCOME_TUPLE_BINDING'
        publish_result = published['result']
        assert publish_result.get('status') == 'SUCCEEDED' or (publish_result.get('status') == 'FAILED' and publish_result.get('outcome') == 'UNKNOWN'), 'PUBLICATION_NOT_COMMITTED'
        assert outcome['state'] == 'COMMITTED_EXACT', 'OUTCOME_NOT_COMMITTED'
        for kind, pairs in requests.items():
            for request, response in pairs:
                result = response['result']
                if kind in ['READ_CONTEXT','READ_PUBLICATION_CONTEXT']:
                    if kind == 'READ_PUBLICATION_CONTEXT':
                        assert result['status'] == 'SUCCEEDED' and len(result['rows']) == 1, 'PUBLICATION_CONTEXT_INCOMPLETE'
                        context = result['rows'][0]['context']
                    else:
                        context = result
                        assert request['payload']['sourceId'] == tuple_['sourceId'] and request['payload']['sourceConfigSha256'] == context['sourceConfigSha256'], 'CONTEXT_REQUEST_BINDING'
                    assert context['sourceId'] == tuple_['sourceId'] and context['candidateRow']['id'] == tuple_['releaseCandidateId'], 'CONTEXT_TUPLE_BINDING'
                if kind == 'READ_OUTCOME':
                    assert result['status'] == 'SUCCEEDED' and len(result['rows']) == 1, 'READ_OUTCOME_INCOMPLETE'
                    row, batch_row = result['rows'][0]['row'], result['rows'][0]['batch']
                    assert row['id'] == tuple_['sourceResultId'] and all(row[key] == tuple_[key] for key in ['releaseCandidateId','batchId','sourceId']), 'READ_OUTCOME_TUPLE_BINDING'
                    assert row['atomicCommitState'] == 'COMMITTED' and batch_row['id'] == batch and batch_row['releaseCandidateId'] == tuple_['releaseCandidateId'] and batch_row['status'] == 'SUCCESS', 'READ_OUTCOME_NOT_COMMITTED'
                selected['official/'+request['requestId']+'.request.json'] = request
                selected['official/'+request['requestId']+'.response.json'] = response
            if kind in ['PUBLISH','READ_OUTCOME']:
                selected['official/'+kind+'.json'] = pairs[-1][1]
        for name, value in selected.items():
            data = (json.dumps(clean(value), ensure_ascii=False, indent=2)+'\n').encode()
            # SQL can contain escaped JSON credentials that recursive key removal cannot see.
            assert not re.search(rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|Bearer\s+[^\s"\\]+|(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|private[._-]?key|auth|authorization|cookies?|session(?:id)?|jwt|bearer|basic)["\\\']*\s*[:=]\s*\S+', data, re.I), 'SECRET_IN_EVIDENCE'
            members[source+'/'+name] = data
        archive_path = next((run/'artifacts').glob('*.archive.json'))
        archive_bytes = archive_path.read_bytes()
        count = raw_files(json.loads(archive_bytes))
        members[source+'/archive.json'] = archive_bytes
        exit_record = json.loads((run/'diagnostics/process.jsonl').read_text().splitlines()[-1])
        assert exit_record['exitCode'] == 0
        members[source+'/PRODUCER_EXIT.json'] = (json.dumps({k:v for k,v in exit_record.items() if k not in ['wrapperPid','childPid']}, indent=2)+'\n').encode()
        web = selected[web_name]
        assert web.get('allFieldsMatch') or web.get('status') == 'WEB_PENDING'
        summary.append({'source':source,'batch':batch,'rawFiles':count,'webStatus':'WEB_VERIFIED' if web.get('allFieldsMatch') else 'WEB_PENDING','webJobs':web.get('uniqueJobs')})
    members['RESTORE.json'] = (json.dumps({'sources':summary,'restore':'Decode archive base64 without text conversion; verify original byte count/hash including PDF. Never replay historical SQL/receipts.','scope':'Committed-source packaging; webStatus records verified or pending web readback. No upload or scheduling in this helper.'}, indent=2)+'\n').encode()
    manifest = [{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(members.items())]
    members['MANIFEST.json'] = (json.dumps(manifest, indent=2)+'\n').encode()
    import io
    with tarfile.open(output, 'w:gz') as archive:
        for name,data in sorted(members.items()):
            item = tarfile.TarInfo(name); item.size = len(data)
            archive.addfile(item, io.BytesIO(data))
    return {'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'members':len(members),'sources':summary}

def verify(path):
    with tarfile.open(path) as archive:
        manifest = json.load(archive.extractfile('MANIFEST.json'))
        assert set(archive.getnames()) == {item['path'] for item in manifest} | {'MANIFEST.json'}
        for item in manifest:
            data = archive.extractfile(item['path']).read()
            assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256']
            if item['path'].endswith('/archive.json'): raw_files(json.loads(data))
    return {'verifiedMembers':len(manifest)+1,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='append', type=pathlib.Path)
    parser.add_argument('--relay', type=pathlib.Path)
    parser.add_argument('--request-id', action='append')
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--verify', type=pathlib.Path)
    args = parser.parse_args()
    if args.verify: print(json.dumps(verify(args.verify)))
    else:
        if not args.run or not args.relay or not args.output or not args.request_id: parser.error('--run, --relay, --output and --request-id required')
        print(json.dumps(pack(args.run, args.relay, args.output, args.request_id)))
