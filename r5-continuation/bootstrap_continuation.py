"""Offline minimal bootstrap continuation; no CLI, transport, retry, or cleanup.

Loader must hash-check the frozen r4 module and this module before exec, inject
FENCE_MODULE and VERIFIED_MODULE_SHA256, and pin independently persisted receipts.
Only exact bootstrap parts and five sealed members may be written. No deployment interface.
Stable trusted/root-controlled paths and an external UNKNOWN no-retry gate remain
mandatory. This module cannot authenticate a caller's invented success history.
"""
import hashlib
import json
import os
import stat
import io
import tarfile

R4_MODULE_SHA256 = 'd420bd7bb06bc1f4303f24433054ae203f2228532b5acb20ffe86e38bed37d5a'
ARCHIVE_SHA256 = 'e2da27eb1961193b9576c4c65158bc557a67f8cc14bbddd12380cea013a2b505'
ARCHIVE_BYTES = 68220
MODULE_FILE = 'BOOTSTRAP_CONTINUATION_R5.py'
UNPACK_INTENT = 'bootstrap-unpack-intent.json'
UNPACK_RESULT = 'bootstrap-unpack-result.json'
MEMBERS = {'baseline.json': {'bytes': 5413, 'sha256': 'a1f9ae676d6047f26e25a1de2a76aa354057fe1a2e3984ded5a3ea1ffbcddf67'}, 'deploy-primitives.py': {'bytes': 9377, 'sha256': '5d835fe81274070adb0a4db452aeec6ee25e3514a60e9241518a0f56c5bd3216'}, 'manifest.json': {'bytes': 128576, 'sha256': '7916b08759eefe8e61966f906100873617fd3d45e7716d2e374254983adc80b4'}, 'pair-control.py': {'bytes': 31313, 'sha256': '51501a8293958e96dceb72876d1c8c347ce9c42e20d6d380d94d2ea71a95807a'}, 'static-protocol.py': {'bytes': 8660, 'sha256': '9b8eb364e18050d55d7a4b769e2058d273d5a032dcdb7485a402648aa88b1335'}}
PARTS = [{'name': 'bootstrap.part000', 'bytes': 6500, 'sha256': 'd77df9b3f410bf08ee80fdf9cb1284dadfbfba4fe149c7c15b1a7b5fc65c8f3c'}, {'name': 'bootstrap.part001', 'bytes': 6500, 'sha256': 'e64caa1f5c4b19cbbf414753333970504b6b7bb093a38095e0e2bce03b8ab1a3'}, {'name': 'bootstrap.part002', 'bytes': 6500, 'sha256': '8209441ce7356e46395c0764ffe4f9ba97da64efd1c4945342beaafdbf86c0e4'}, {'name': 'bootstrap.part003', 'bytes': 6500, 'sha256': 'f932b33b1b87b4789c923ec4eaacb5d10b3de5c3e622a35182d0bd92e6fd653f'}, {'name': 'bootstrap.part004', 'bytes': 6500, 'sha256': '10445bbed9fd65397f154c581582e97b4fe6c56121f0730bb233109178299312'}, {'name': 'bootstrap.part005', 'bytes': 6500, 'sha256': '8c07aa8ebde2aeacece8fd7d949a85848741849a9977285c4e7f67a8623048e4'}, {'name': 'bootstrap.part006', 'bytes': 6500, 'sha256': '8ce91a1c6b34e170b973a733393ba0b964a823eec756b35127c609ad493986ed'}, {'name': 'bootstrap.part007', 'bytes': 6500, 'sha256': 'fc339a4a10be5f815b8f790f0247e50519654f265f8256b0d3ff0d8e837e9570'}, {'name': 'bootstrap.part008', 'bytes': 6500, 'sha256': '905ac7ea08f259567577a425fdbaf2d668cde60c6f079523d4959bbe0c1b1d00'}, {'name': 'bootstrap.part009', 'bytes': 6500, 'sha256': 'f6653e6e7718ecf27029621cd5b00679edd3fae92cdea427d2424bf0b5eed8a6'}, {'name': 'bootstrap.part010', 'bytes': 3220, 'sha256': 'cff4aa72897058ac2ccdf311c31876ca49e19ae019baf5223f07ad3f7897b7dc'}]


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def nonce_ok(value):
    return (isinstance(value, str) and len(value) == 32 and
            all(c in '0123456789abcdef' for c in value))


def trusted_modules():
    source = globals().get('VERIFIED_MODULE_SHA256')
    require(isinstance(source, str) and len(source) == 64 and
            all(c in '0123456789abcdef' for c in source), 'SOURCE_BINDING_MISSING_OR_INVALID')
    fence = globals().get('FENCE_MODULE')
    require(isinstance(fence, dict) and
            fence.get('VERIFIED_MODULE_SHA256') == R4_MODULE_SHA256,
            'FROZEN_R4_MODULE_BINDING_MISSING')
    require(isinstance(globals().get('VERIFIED_CONTAINER_SHA256'), str) and
            len(VERIFIED_CONTAINER_SHA256) == 64 and
            type(globals().get('VERIFIED_CONTAINER_BYTES')) is int,
            'CONTAINER_BINDING_MISSING')
    return fence, source


def marker_data(fence_receipt, fence):
    require(isinstance(fence_receipt, dict) and fence_receipt.get('state') == 'FENCE_CREATED',
            'NO_FENCE_SUCCESS_RECEIPT')
    marker = fence_receipt['marker']
    require(marker.get('release') == fence['RELEASE'] and
            marker.get('oldScriptSha256') == fence['OLD_SHA'] and
            marker.get('fenceSourceSha256') == R4_MODULE_SHA256 and
            nonce_ok(marker.get('nonce')), 'FENCE_RECEIPT_BINDING_MISMATCH')
    raw = canonical(marker) + b'\n'
    require(digest(raw) == fence_receipt.get('markerSha256'), 'FENCE_RECEIPT_HASH_MISMATCH')
    return {fence['MARKER']: raw,
            fence['HASH_FILE']: (fence_receipt['markerSha256'] + '\n').encode()}


def validate_binding(binding, fence, source):
    require(isinstance(binding, dict) and binding.get('state') == 'CONTINUATION_BOUND',
            'NO_CONTINUATION_BINDING')
    require(binding.get('continuationSourceSha256') == source and
            binding.get('fenceModuleSha256') == R4_MODULE_SHA256,
            'CONTINUATION_SOURCE_CHANGED')
    spec = binding.get('moduleFile', {})
    require(spec.get('name') == MODULE_FILE and
            spec.get('sha256') == VERIFIED_CONTAINER_SHA256 and
            spec.get('bytes') == VERIFIED_CONTAINER_BYTES, 'MODULE_FILE_BINDING_MISMATCH')
    expected = marker_data(binding['fenceReceipt'], fence)
    require(set(binding['markerIdentities']) == set(expected), 'MARKER_IDENTITY_SET_MISMATCH')
    return expected


def open_target(fence_receipt, fence):
    marker = fence_receipt['marker']
    fds, chain = fence['open_chain']()
    dfd = None
    try:
        require(chain == marker['parentChain'], 'PARENT_IDENTITY_CHANGED')
        dfd = os.open(fence['RELEASE'], fence['DFLAGS'], dir_fd=fds[-1])
        require(fence['identity'](os.fstat(dfd)) == marker['targetIdentity'],
                'TARGET_IDENTITY_CHANGED')
        fence['check_chain'](chain, marker['targetIdentity'])
        return fds, dfd
    except BaseException:
        close_target(fds, dfd)
        raise


def close_target(fds, dfd):
    if dfd is not None:
        os.close(dfd)
    for fd in reversed(fds):
        os.close(fd)


def read_exact(dfd, name, size, expected_hash, fence, expected_identity=None):
    flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open(name, flags, dir_fd=dfd)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        ident = fence['identity'](before)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_uid == fence['TRUSTED_UID'] and
                stat.S_IMODE(before.st_mode) == 0o600 and before.st_size == size,
                'BAD_FILE: ' + name)
        require(expected_identity is None or ident == expected_identity,
                'FILE_IDENTITY_CHANGED: ' + name)
        raw = stream.read(size + 1)
        after = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino, before.st_uid, before.st_mode,
                 before.st_nlink, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_uid, after.st_mode,
                 after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                'FILE_CHANGED_DURING_READ: ' + name)
        require(len(raw) == size and digest(raw) == expected_hash, 'FILE_HASH_MISMATCH: ' + name)
        return raw, ident


def _bind_initial_fence(fence_receipt):
    """Read-only bootstrap binding; preserve the r4 exactly-two-marker verifier."""
    fence, source = trusted_modules()
    expected = marker_data(fence_receipt, fence)
    fence['verify_fence'](fence_receipt)
    fds, dfd = open_target(fence_receipt, fence)
    try:
        require(set(os.listdir(dfd)) == set(expected), 'UNEXPECTED_CONTENT')
        identities = {}
        for name, raw in expected.items():
            _, identities[name] = read_exact(dfd, name, len(raw), digest(raw), fence)
        marker = fence_receipt['marker']
        fence['check_chain'](marker['parentChain'], marker['targetIdentity'])
        return {'state': 'CONTINUATION_BOUND', 'version': 1,
                'continuationSourceSha256': source, 'fenceModuleSha256': R4_MODULE_SHA256,
                'fenceReceipt': json.loads(canonical(fence_receipt)),
                'markerIdentities': identities}
    finally:
        close_target(fds, dfd)


def validate_receipts(binding, receipts, source):
    require(isinstance(receipts, list) and len(receipts) <= len(PARTS), 'BAD_RECEIPT_SEQUENCE')
    previous = digest(canonical(binding))
    seen_nonces = {binding['fenceReceipt']['marker']['nonce']}
    marker = binding['fenceReceipt']['marker']
    for index, receipt in enumerate(receipts):
        require(isinstance(receipt, dict) and receipt.get('state') == 'PART_STORED',
                'NO_PART_SUCCESS_RECEIPT')
        expected = PARTS[index]
        require(type(receipt.get('index')) is int and receipt['index'] == index and
                all(receipt.get(k) == expected[k] for k in ('name', 'bytes', 'sha256')) and
                receipt.get('continuationSourceSha256') == source and
                receipt.get('bindingSha256') == digest(canonical(binding)) and
                receipt.get('previousReceiptSha256') == previous and
                receipt.get('parentChain') == marker['parentChain'] and
                receipt.get('targetIdentity') == marker['targetIdentity'],
                'PART_RECEIPT_BINDING_MISMATCH')
        nonce = receipt.get('operationNonce')
        require(nonce_ok(nonce) and nonce not in seen_nonces, 'REUSED_OR_INVALID_NONCE')
        seen_nonces.add(nonce)
        previous = digest(canonical(receipt))
    return previous, seen_nonces


def inspect_open_stage(binding, receipts, fence, source, dfd):
    expected_markers = validate_binding(binding, fence, source)
    previous, nonces = validate_receipts(binding, receipts, source)
    names = set(expected_markers) | {MODULE_FILE} | {p['name'] for p in PARTS[:len(receipts)]}
    require(set(os.listdir(dfd)) == names, 'UNEXPECTED_CONTENT')
    for name, raw in expected_markers.items():
        read_exact(dfd, name, len(raw), digest(raw), fence, binding['markerIdentities'][name])
    spec = binding['moduleFile']
    read_exact(dfd, MODULE_FILE, spec['bytes'], spec['sha256'], fence, spec['identity'])
    archive = hashlib.sha256()
    for spec, receipt in zip(PARTS, receipts):
        raw, _ = read_exact(dfd, spec['name'], spec['bytes'], spec['sha256'], fence,
                            receipt['fileIdentity'])
        archive.update(raw)
    if len(receipts) == len(PARTS):
        require(sum(p['bytes'] for p in PARTS) == ARCHIVE_BYTES and
                archive.hexdigest() == ARCHIVE_SHA256, 'ARCHIVE_HASH_MISMATCH')
    marker = binding['fenceReceipt']['marker']
    fence['check_chain'](marker['parentChain'], marker['targetIdentity'])
    return previous, nonces


def verify_stage(binding, completed_receipts):
    """Read-only exact set; no unknown/partial files may be adopted."""
    fence, source = trusted_modules()
    validate_binding(binding, fence, source)
    validate_receipts(binding, completed_receipts, source)
    fds, dfd = open_target(binding['fenceReceipt'], fence)
    try:
        inspect_open_stage(binding, completed_receipts, fence, source, dfd)
        return {'state': 'BOOTSTRAP_STAGE_VERIFIED', 'completedParts': len(completed_receipts),
                'bindingSha256': digest(canonical(binding)),
                'archiveSha256': ARCHIVE_SHA256 if len(completed_receipts) == len(PARTS) else None}
    finally:
        close_target(fds, dfd)


def append_next_part(binding, completed_receipts, data, operation_nonce):
    """One authorized new intent only. Any UNKNOWN forbids retry externally."""
    fence, source = trusted_modules()
    require(os.geteuid() == fence['TRUSTED_UID'], 'BAD_UID')
    validate_binding(binding, fence, source)
    _, seen = validate_receipts(binding, completed_receipts, source)
    require(nonce_ok(operation_nonce) and operation_nonce not in seen,
            'REUSED_OR_INVALID_NONCE')
    index = len(completed_receipts)
    require(index < len(PARTS), 'BOOTSTRAP_ALREADY_COMPLETE')
    part = PARTS[index]
    require(isinstance(data, bytes) and len(data) == part['bytes'] and
            digest(data) == part['sha256'], 'PART_DATA_MISMATCH')
    os.umask(0o077)
    fds, dfd = open_target(binding['fenceReceipt'], fence)
    try:
        previous, _ = inspect_open_stage(binding, completed_receipts, fence, source, dfd)
        fence['exclusive_write'](dfd, part['name'], data)  # PHASE_BEFORE_PART
        os.fsync(dfd)  # PHASE_AFTER_PART_WRITE
        os.fsync(fds[-1])
        _, file_id = read_exact(dfd, part['name'], part['bytes'], part['sha256'], fence)
        marker = binding['fenceReceipt']['marker']
        receipt = {'state': 'PART_STORED', 'version': 1, 'index': index,
                   **part, 'fileIdentity': file_id, 'operationNonce': operation_nonce,
                   'bindingSha256': digest(canonical(binding)),
                   'previousReceiptSha256': previous, 'continuationSourceSha256': source,
                   'parentChain': marker['parentChain'], 'targetIdentity': marker['targetIdentity']}
        inspect_open_stage(binding, completed_receipts + [receipt], fence, source, dfd)
        return receipt  # PHASE_BEFORE_RECEIPT
    finally:
        close_target(fds, dfd)


def install_module(fence_receipt, container_bytes):
    """One O_EXCL module file, after unchanged r4 exactly-two-marker proof."""
    fence, source = trusted_modules()
    require(os.geteuid() == fence['TRUSTED_UID'], 'BAD_UID')
    require(isinstance(container_bytes, bytes) and len(container_bytes) == VERIFIED_CONTAINER_BYTES and
            digest(container_bytes) == VERIFIED_CONTAINER_SHA256, 'CONTAINER_BYTES_MISMATCH')
    binding = _bind_initial_fence(fence_receipt)
    os.umask(0o077)
    fds, dfd = open_target(fence_receipt, fence)
    try:
        expected = marker_data(fence_receipt, fence)
        require(set(os.listdir(dfd)) == set(expected), 'UNEXPECTED_CONTENT')
        for name, raw in expected.items():
            read_exact(dfd, name, len(raw), digest(raw), fence, binding['markerIdentities'][name])
        fence['exclusive_write'](dfd, MODULE_FILE, container_bytes)  # PHASE_BEFORE_MODULE
        os.fsync(dfd)  # PHASE_AFTER_MODULE_WRITE
        os.fsync(fds[-1])
        _, file_id = read_exact(dfd, MODULE_FILE, VERIFIED_CONTAINER_BYTES,
                                VERIFIED_CONTAINER_SHA256, fence)
        binding['moduleFile'] = {'name': MODULE_FILE, 'bytes': VERIFIED_CONTAINER_BYTES,
                                 'sha256': VERIFIED_CONTAINER_SHA256, 'identity': file_id}
        inspect_open_stage(binding, [], fence, source, dfd)
        return binding  # PHASE_BEFORE_MODULE_RECEIPT
    finally:
        close_target(fds, dfd)


def unpack_bootstrap(binding, completed_receipts, operation_nonce):
    """Only the original five members and original unpack intent/result names."""
    fence, source = trusted_modules()
    validate_binding(binding, fence, source)
    _, seen = validate_receipts(binding, completed_receipts, source)
    require(len(completed_receipts) == len(PARTS), 'INCOMPLETE_BOOTSTRAP')
    require(nonce_ok(operation_nonce) and operation_nonce not in seen, 'REUSED_OR_INVALID_NONCE')
    require(os.geteuid() == fence['TRUSTED_UID'], 'BAD_UID')
    os.umask(0o077)
    fds, dfd = open_target(binding['fenceReceipt'], fence)
    try:
        inspect_open_stage(binding, completed_receipts, fence, source, dfd)
        raw = b''.join(read_exact(dfd, p['name'], p['bytes'], p['sha256'], fence,
                                 receipt['fileIdentity'])[0]
                       for p, receipt in zip(PARTS, completed_receipts))
        require(len(raw) == ARCHIVE_BYTES and digest(raw) == ARCHIVE_SHA256, 'ARCHIVE_HASH_MISMATCH')
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
            entries = archive.getmembers()
            require(len(entries) == len(MEMBERS) and {m.name for m in entries} == set(MEMBERS) and
                    all(m.isfile() and m.size == MEMBERS[m.name]['bytes'] for m in entries),
                    'ARCHIVE_MEMBER_MISMATCH')
            bodies = {m.name: archive.extractfile(m).read() for m in entries}
        require(all(digest(raw) == MEMBERS[name]['sha256'] for name, raw in bodies.items()),
                'ARCHIVE_MEMBER_HASH_MISMATCH')
        intent = {'state': 'UNPACK_INTENDED', 'bindingSha256': digest(canonical(binding)),
                  'partsReceiptSha256': digest(canonical(completed_receipts)),
                  'archiveSha256': ARCHIVE_SHA256, 'operationNonce': operation_nonce,
                  'continuationSourceSha256': source}
        intent_raw = canonical(intent) + b'\n'
        fence['exclusive_write'](dfd, UNPACK_INTENT, intent_raw)  # PHASE_BEFORE_UNPACK_INTENT
        os.fsync(dfd)
        files = {}
        _, intent_id = read_exact(dfd, UNPACK_INTENT, len(intent_raw), digest(intent_raw), fence)
        for name in sorted(bodies):
            fence['check_chain'](binding['fenceReceipt']['marker']['parentChain'],
                                 binding['fenceReceipt']['marker']['targetIdentity'])
            fence['exclusive_write'](dfd, name, bodies[name])  # PHASE_BEFORE_UNPACK_MEMBER
            _, file_id = read_exact(dfd, name, MEMBERS[name]['bytes'], MEMBERS[name]['sha256'], fence)
            files[name] = {**MEMBERS[name], 'identity': file_id}
        result = {'state': 'BOOTSTRAP_UNPACKED', 'bindingSha256': digest(canonical(binding)),
                  'partsReceiptSha256': digest(canonical(completed_receipts)),
                  'archiveSha256': ARCHIVE_SHA256, 'operationNonce': operation_nonce,
                  'continuationSourceSha256': source, 'intent': intent,
                  'intentIdentity': intent_id, 'files': files}
        result_raw = canonical(result) + b'\n'
        fence['exclusive_write'](dfd, UNPACK_RESULT, result_raw)  # PHASE_BEFORE_UNPACK_RESULT
        os.fsync(dfd)
        os.fsync(fds[-1])
        _, result_id = read_exact(dfd, UNPACK_RESULT, len(result_raw), digest(result_raw), fence)
        receipt = {'state': 'UNPACK_RECEIPT', 'result': result, 'resultIdentity': result_id}
        _verify_unpacked_open(binding, completed_receipts, receipt, fence, source, dfd)
        return receipt  # PHASE_BEFORE_UNPACK_RECEIPT
    finally:
        close_target(fds, dfd)


def _verify_unpacked_open(binding, receipts, unpack_receipt, fence, source, dfd):
    require(isinstance(unpack_receipt, dict) and unpack_receipt.get('state') == 'UNPACK_RECEIPT',
            'NO_UNPACK_SUCCESS_RECEIPT')
    validate_binding(binding, fence, source)
    _, seen = validate_receipts(binding, receipts, source)
    require(len(receipts) == len(PARTS), 'INCOMPLETE_BOOTSTRAP')
    result = unpack_receipt['result']
    require(result.get('state') == 'BOOTSTRAP_UNPACKED' and
            result.get('bindingSha256') == digest(canonical(binding)) and
            result.get('partsReceiptSha256') == digest(canonical(receipts)) and
            result.get('archiveSha256') == ARCHIVE_SHA256 and
            result.get('continuationSourceSha256') == source and
            nonce_ok(result.get('operationNonce')) and result['operationNonce'] not in seen and
            set(result.get('files', {})) == set(MEMBERS), 'UNPACK_RECEIPT_BINDING_MISMATCH')
    expected_markers = marker_data(binding['fenceReceipt'], fence)
    names = set(expected_markers) | {MODULE_FILE, UNPACK_INTENT, UNPACK_RESULT} | set(MEMBERS) | {p['name'] for p in PARTS}
    require(set(os.listdir(dfd)) == names, 'UNEXPECTED_CONTENT')
    for name, raw in expected_markers.items():
        read_exact(dfd, name, len(raw), digest(raw), fence, binding['markerIdentities'][name])
    spec = binding['moduleFile']
    read_exact(dfd, MODULE_FILE, spec['bytes'], spec['sha256'], fence, spec['identity'])
    aggregate = hashlib.sha256()
    for spec, receipt in zip(PARTS, receipts):
        raw, _ = read_exact(dfd, spec['name'], spec['bytes'], spec['sha256'], fence, receipt['fileIdentity'])
        aggregate.update(raw)
    require(aggregate.hexdigest() == ARCHIVE_SHA256, 'ARCHIVE_HASH_MISMATCH')
    for name, spec in MEMBERS.items():
        require(all(result['files'][name].get(k) == spec[k] for k in ('bytes', 'sha256')),
                'UNPACK_MEMBER_BINDING_MISMATCH')
        read_exact(dfd, name, spec['bytes'], spec['sha256'], fence, result['files'][name]['identity'])
    expected_intent = {'state': 'UNPACK_INTENDED', 'bindingSha256': digest(canonical(binding)),
                       'partsReceiptSha256': digest(canonical(receipts)), 'archiveSha256': ARCHIVE_SHA256,
                       'operationNonce': result['operationNonce'], 'continuationSourceSha256': source}
    require(result['intent'] == expected_intent, 'UNPACK_INTENT_BINDING_MISMATCH')
    for name, value, identity in [(UNPACK_INTENT, expected_intent, result['intentIdentity']),
                                  (UNPACK_RESULT, result, unpack_receipt['resultIdentity'])]:
        raw = canonical(value) + b'\n'
        read_exact(dfd, name, len(raw), digest(raw), fence, identity)
    marker = binding['fenceReceipt']['marker']
    fence['check_chain'](marker['parentChain'], marker['targetIdentity'])


def verify_unpacked(binding, receipts, unpack_receipt):
    fence, source = trusted_modules()
    validate_binding(binding, fence, source)
    fds, dfd = open_target(binding['fenceReceipt'], fence)
    try:
        _verify_unpacked_open(binding, receipts, unpack_receipt, fence, source, dfd)
        return {'state': 'BOOTSTRAP_UNPACK_VERIFIED', 'archiveSha256': ARCHIVE_SHA256,
                'members': sorted(MEMBERS)}
    finally:
        close_target(fds, dfd)
