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

def pack(runs, relay, output):
    members, summary = {}, []
    requests = []
    # Preserve the original bounded lookup. A missing receipt fails rather than inventing success.
    for path in sorted(relay.glob('*.request.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]:
        text = path.read_text()
        requests.append((path, json.loads(text), text))
    for run in runs:
        source, batch = run.parent.name, run.name
        assert source not in {row['source'] for row in summary}
        selected = {'WEB_READBACK_VERIFIED.json': run/'WEB_READBACK_VERIFIED.json',
                    'OUTCOME.json': next((run/'artifacts').glob('*.outcome.json'))}
        for name in ['PACKET_REVIEW.json','NATIVE_RAW_REPLAY.json','ORIGINAL_DEPLOYED_READER_REPLAY.json','EXPECTED_TARGET_API.json']:
            if (run/'review'/name).exists(): selected['review/'+name] = run/'review'/name
        for name in ['CURRENT_SET_DIFF_SUMMARY.json','WEB_REFRESH_INITIAL_FAILURE.json']:
            if (run/name).exists(): selected[name] = run/name
        for folder in ['independent-dom','independent-validation']:
            for path in (run/folder).glob('*.json'): selected[folder+'/'+path.name] = path
        for path in (run/'artifacts').glob('*.independent-validation.json'):
            selected['independent-validation-certificate.json'] = path
        found = set()
        for path, request, text in requests:
            kind = request['kind']
            if kind in ['PUBLISH','READ_OUTCOME'] and batch in text:
                response = path.with_name(path.name.replace('.request.json','.response.json'))
                assert json.loads(response.read_text())['kind'] == kind
                selected['official/'+kind+'.json'] = response
                found.add(kind)
        assert found == {'PUBLISH','READ_OUTCOME'}
        for name, path in selected.items():
            members[source+'/'+name] = (json.dumps(clean(json.loads(path.read_text())), ensure_ascii=False, indent=2)+'\n').encode()
        archive_path = next((run/'artifacts').glob('*.archive.json'))
        count = raw_files(json.loads(archive_path.read_bytes()))
        members[source+'/archive.json'] = archive_path.read_bytes()
        exit_record = json.loads((run/'diagnostics/process.jsonl').read_text().splitlines()[-1])
        assert exit_record['exitCode'] == 0
        members[source+'/PRODUCER_EXIT.json'] = (json.dumps({k:v for k,v in exit_record.items() if k not in ['wrapperPid','childPid']}, indent=2)+'\n').encode()
        outcome = json.loads(members[source+'/OUTCOME.json']); web = json.loads(members[source+'/WEB_READBACK_VERIFIED.json'])
        assert outcome['state'] == 'COMMITTED_EXACT' and outcome['publishAcknowledged'] and web['allFieldsMatch']
        summary.append({'source':source,'batch':batch,'rawFiles':count,'webJobs':web['uniqueJobs']})
    members['RESTORE.json'] = (json.dumps({'sources':summary,'restore':'Decode archive base64 without text conversion; verify original byte count/hash including PDF. Never replay historical SQL/receipts.','scope':'Success packaging only. No upload or automatic scheduling is implemented by this helper.'}, indent=2)+'\n').encode()
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
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--verify', type=pathlib.Path)
    args = parser.parse_args()
    if args.verify: print(json.dumps(verify(args.verify)))
    else:
        if not args.run or not args.relay or not args.output: parser.error('--run, --relay and --output required')
        print(json.dumps(pack(args.run, args.relay, args.output)))
