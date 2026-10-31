"""Recover source HOLD from retained original read-timeout evidence; never settle a relay request."""
import datetime, hashlib, json, os, pathlib, re, sys

HOLD = 'PRE_CAPTURE_READ_UNKNOWN_PRODUCER_TERMINAL_NO_PUBLISH'
HOLD_FILE = 'pre-capture-read-hold.json'

def read(path): return json.loads(path.read_text())
def stamp(value): return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
def digest(value): return hashlib.sha256(value).hexdigest()
def request_file(path):
    value = read(path)
    assert set(value) == {'schemaVersion','requestId','kind','expiresAt','payload','requestSha256'}
    assert value['schemaVersion'] == 1 and re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', value['requestId'])
    assert path.name == value['requestId'] + '.request.json'
    body = {k:v for k,v in value.items() if k != 'requestSha256'}
    assert digest(json.dumps(body,separators=(',',':'),ensure_ascii=False).encode()) == value['requestSha256']
    return value

def inspect(root, recovery, source_folders, checked_at):
    default = root/'connector-host-task/relay'
    queues = [default, *(root/'rounds').glob('round-*/connector-host-task/relay')]
    owners = {}
    for path in recovery.glob('*/dot-auto-*/relay-checkpoint.json'):
        try:
            checkpoint = read(path); source = checkpoint['sourceId']; run = path.parent
            assert source_folders[source] == run.parent.name
            assert checkpoint['batchId'] == run.name and run.name.startswith('dot-auto-'+run.parent.name+'-')
            queue = pathlib.Path(checkpoint.get('relayDirectory', str(default)))
            assert queue in queues and len(set(checkpoint['requestIds'])) == len(checkpoint['requestIds'])
            for rid in checkpoint['requestIds']:
                owners.setdefault((queue,rid), []).append((run,checkpoint))
        except (KeyError,ValueError,TypeError,AssertionError,OSError):
            continue
    holds, isolated, ineligible, receipts = {}, {}, {}, {}
    # An existing isolation HOLD is never cleared merely because a late response appears.
    for path in recovery.glob('*/dot-auto-*/'+HOLD_FILE):
        receipt = read(path); source = receipt['sourceId']
        assert receipt['schemaVersion'] == 1 and receipt['readOutcome'] == 'UNKNOWN' and receipt['reason'] == HOLD, 'HOLD_RECEIPT_INVALID'
        assert source_folders[source] == path.parent.parent.name and receipt['batchId'] == path.parent.name, 'HOLD_RECEIPT_SCOPE'
        request_path = root/receipt['requestPath']
        assert request_path.parent in queues and request_path.name == receipt['requestId']+'.request.json' and re.fullmatch('[a-f0-9]{64}',receipt['requestFileSha256']), 'HOLD_REQUEST_SCOPE'
        holds[source] = HOLD; receipts[str(path)] = receipt
    for queue in queues:
        for path in queue.glob('*.request.json'):
            try:
                request = request_file(path)
                if request['kind'] != 'READ_CONTEXT' or (queue/(request['requestId']+'.response.json')).exists(): continue
                payload = request['payload']; source = payload['sourceId']; rid = request['requestId']
                assert set(payload) == {'projectId','sourceId','sourceConfigSha256','purpose','dispatchBefore'}, 'READ_PAYLOAD'
                assert payload['projectId'] == 'yiopvxysxrtrnvqxwgbx' and payload['purpose'] == 'PRE_CAPTURE', 'READ_SCOPE'
                assert source in source_folders and re.fullmatch('[a-f0-9]{64}',payload['sourceConfigSha256']), 'READ_IDENTITY'
                assert len(owners.get((queue,rid),[])) == 1, 'READ_OWNER'
                run, checkpoint = owners[(queue,rid)][0]
                assert checkpoint['sourceId'] == source and checkpoint['requestIds'] == [rid], 'READ_NOT_ONLY_REQUEST'
                # Check the whole queue, including responded requests and requests not yet checkpointed.
                requests = list(queue.glob('*.request.json'))
                assert {p.name.removesuffix('.request.json') for p in requests} == {p.name.removesuffix('.request.ready') for p in queue.glob('*.request.ready')}, 'INCOMPLETE_QUEUE'
                for other in requests:
                    other_id = request_file(other)['requestId']
                    assert len(owners.get((queue,other_id),[])) == 1, 'UNOWNED_QUEUE_REQUEST'
                    other_run, other_checkpoint = owners[(queue,other_id)][0]
                    assert other_id == rid or (other_run != run and other_checkpoint['sourceId'] != source), 'SOURCE_HAS_FOLLOWUP'
                marker = read(queue/(rid+'.dispatch.json'))
                assert all(marker[k] == request[k] for k in ('schemaVersion','requestId','requestSha256','kind')), 'DISPATCH_BINDING'
                assert marker['state'] == 'MAY_HAVE_BEEN_SENT', 'DISPATCH_STATE'
                artifacts = list((run/'artifacts').iterdir())
                assert len(artifacts) == 1 and '.failure-' in artifacts[0].name and artifacts[0].suffix == '.json', 'POST_CAPTURE_ARTIFACT'
                failure = read(artifacts[0])
                assert failure['purpose'] == 'PRIVATE_DIAGNOSTIC_NOT_PUBLICATION_AUTHORITY' and failure['sourceId'] == source and failure['batchId'] == run.name, 'FAILURE_BINDING'
                assert failure['phase'] == 'PRE_CAPTURE_CONTEXT' and failure['crawlResult'] is None and any(e.get('code') == 'RELAY_DEADLINE' for e in failure['errors']), 'NOT_READ_TIMEOUT'
                events = [json.loads(line) for line in (run/'diagnostics/process.jsonl').read_text().splitlines() if line.strip()]
                starts, children, exits = ([e for e in events if e['event'] == kind] for kind in ('WRAPPER_START','CHILD_STARTED','CHILD_EXIT'))
                assert len(starts) == len(children) == len(exits) == 1, 'PRODUCER_NOT_TERMINAL'
                start, child, end = starts[0], children[0], exits[0]
                assert start['wrapperPid'] == child['wrapperPid'] == end['wrapperPid'] and child['childPid'] == end['childPid'], 'PRODUCER_IDENTITY'
                assert type(end['exitCode']) is int and end['exitCode'] != 0 and type(end['wrapperExitCode']) is int, 'PRODUCER_NOT_FAILED'
                assert stamp(start['recordedAt']) <= stamp(child['recordedAt']) <= stamp(marker['markedAt']) < stamp(payload['dispatchBefore']) < stamp(request['expiresAt']) <= stamp(failure['recordedAt']) <= stamp(end['recordedAt']) <= stamp(checked_at), 'READ_TIMEOUT_TIMELINE'
                relative = str(path.relative_to(root)); file_hash = digest(path.read_bytes())
                receipt = {'schemaVersion':1,'sourceId':source,'batchId':run.name,'requestId':rid,'requestPath':relative,'requestFileSha256':file_hash,'readOutcome':'UNKNOWN','reason':HOLD}
                receipt_path = run/HOLD_FILE
                if receipt_path.exists(): assert read(receipt_path) == receipt, 'HOLD_RECEIPT_CHANGED'
                receipts[str(receipt_path)] = receipt
                holds[source] = HOLD
                isolated[relative] = file_hash
            except (KeyError,ValueError,TypeError,AssertionError,OSError) as error:
                ineligible[str(path.relative_to(root))] = str(error) or type(error).__name__
    return {'holds':holds,'isolated':isolated,'ineligible':ineligible,'holdReceipts':receipts,'heldQueues':sorted({str(pathlib.Path(r['requestPath']).parent) for r in receipts.values()}),'readOutcome':'UNKNOWN'}

def persist_holds(receipts):
    for name, receipt in receipts.items():
        path = pathlib.Path(name); data = (json.dumps(receipt,sort_keys=True)+'\n').encode()
        try: fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        except FileExistsError:
            assert read(path) == receipt, 'HOLD_RECEIPT_CHANGED'
            with path.open('rb') as existing: os.fsync(existing.fileno())
        else:
            with os.fdopen(fd,'wb') as out: out.write(data); out.flush(); os.fsync(out.fileno())
        directory = os.open(path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
        assert read(path) == receipt, 'HOLD_NOT_PERSISTED'

if __name__ == '__main__':
    root,recovery = map(pathlib.Path,sys.argv[1:3])
    result = inspect(root,recovery,json.loads(sys.argv[3]),sys.argv[4])
    if sys.argv[5:] == ['--persist-holds']: persist_holds(result['holdReceipts'])
    elif sys.argv[5:]: raise ValueError('UNSUPPORTED_MODE')
    print(json.dumps(result))
