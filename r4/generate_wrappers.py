#!/usr/bin/env python3
"""Reproduce only the two local r4 templates, or compare them with --check.

Never submits commands, reads a server snapshot, or writes a production path.
Compression output is pinned; a different zlib encoding fails closed.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib

HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / 'fence_module.py'
MODULE_SHA256 = 'd420bd7bb06bc1f4303f24433054ae203f2228532b5acb20ffe86e38bed37d5a'
MODULE_BYTES = 9232
PACKED_SHA256 = '4f0a023193b0dcdadb1c5f34e4a05505a71df47a71a680c08d830f88073c762e'
PACKED_BYTES = 2839
OPERATION_NONCE = '749339f6066e43fe8ed0110650f17c35'


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def render_templates():
    source = MODULE_PATH.read_bytes()
    require(len(source) == MODULE_BYTES and hashlib.sha256(source).hexdigest() == MODULE_SHA256,
            'REVIEWED_R4_MODULE_CHANGED')
    packed = zlib.compress(source, level=9)
    require(len(packed) == PACKED_BYTES and hashlib.sha256(packed).hexdigest() == PACKED_SHA256,
            'COMPRESSION_ENCODING_CHANGED')
    require(zlib.decompress(packed) == source, 'DECOMPRESSION_DIFFERS')
    encoded = base64.b64encode(packed).decode('ascii')
    common = f'''#!/bin/sh
set -eu
umask 077
exec python3 - <<'PY'
import base64,hashlib,json,zlib
MODULE_SHA256 = '{MODULE_SHA256}'
MODULE_BYTES = {MODULE_BYTES}
PACKED_SHA256 = '{PACKED_SHA256}'
PACKED_BYTES = {PACKED_BYTES}
PACKED_B64 = '{encoded}'
EXPECTED_PARENT_CHAIN = None  # PIN_EXISTING_PARENT_CHAIN_OR_LEAVE_NONE
EXPECTED_ANCESTOR_CHAIN = None  # PIN_ANCESTORS_ONLY_FOR_APPROVED_ABSENT_PARENT
OPERATION_NONCE = '{OPERATION_NONCE}'
packed = base64.b64decode(PACKED_B64, validate=True)
if len(packed) != PACKED_BYTES or hashlib.sha256(packed).hexdigest() != PACKED_SHA256:
    raise RuntimeError('COMPRESSED_MODULE_HASH_MISMATCH')
source = zlib.decompress(packed)
if len(source) != MODULE_BYTES or hashlib.sha256(source).hexdigest() != MODULE_SHA256:
    raise RuntimeError('EMBEDDED_MODULE_HASH_MISMATCH')
def valid_chain(chain, length):
    return (isinstance(chain, list) and len(chain) == length and
            all(isinstance(row, list) and len(row) == 4 and
                all(type(v) is int and 0 <= v < 2**64 for v in row) and
                row[2] == 0 and row[3] <= 0o7777 and not row[3] & 0o022
                for row in chain))
existing_plan = EXPECTED_ANCESTOR_CHAIN is None and valid_chain(EXPECTED_PARENT_CHAIN, 3)
absent_plan = EXPECTED_PARENT_CHAIN is None and valid_chain(EXPECTED_ANCESTOR_CHAIN, 2)
if not (existing_plan or absent_plan):
    raise RuntimeError('REAL_PARENT_PLAN_NOT_PINNED')
module = {{'__name__': '_fence',
          'VERIFIED_MODULE_SHA256': MODULE_SHA256}}
exec(compile(source, '<pinned-fence-module>', 'exec'), module)
# REVIEWED_MODULE_READY
'''
    create = common + '''result = module['create_fence'](EXPECTED_PARENT_CHAIN, OPERATION_NONCE, EXPECTED_ANCESTOR_CHAIN)
print(json.dumps(result, sort_keys=True, separators=(',', ':')), flush=True)
PY
'''
    read = common + '''SUCCESS_RECEIPT = None  # PIN_EXACT_INDEPENDENTLY_PERSISTED_CREATE_SUCCESS
if not isinstance(SUCCESS_RECEIPT, dict) or SUCCESS_RECEIPT.get('state') != 'FENCE_CREATED':
    raise RuntimeError('NO_SUCCESS_RECEIPT')
marker = SUCCESS_RECEIPT.get('marker', {})
chain = marker.get('parentChain')
parent_bound = ((existing_plan and chain == EXPECTED_PARENT_CHAIN and
                 marker.get('parentCreated') is False) or
                (absent_plan and valid_chain(chain, 3) and
                 chain[:-1] == EXPECTED_ANCESTOR_CHAIN and
                 chain[-1][2:] == [0, 0o700] and marker.get('parentCreated') is True))
if (marker.get('nonce') != OPERATION_NONCE or not parent_bound or
    marker.get('fenceSourceSha256') != MODULE_SHA256):
    raise RuntimeError('RECEIPT_BINDING_MISMATCH')
result = module['verify_fence'](SUCCESS_RECEIPT)
print(json.dumps(result, sort_keys=True, separators=(',', ':')), flush=True)
PY
'''
    result = {'create-fence.template.sh': create.encode(),
              'read-fence.template.sh': read.encode()}
    require(all(len(raw) < 9415 for raw in result.values()), 'TEMPLATE_SIZE_BUDGET_EXCEEDED')
    return result


def main():
    require(sys.argv[1:] in ([], ['--check']), 'ONLY_OPTION_IS_CHECK')
    rendered = render_templates()
    for name, raw in rendered.items():
        if sys.argv[1:] == ['--check']:
            require((HERE / name).read_bytes() == raw, 'TEMPLATE_DIFFERS: ' + name)
        else:
            (HERE / name).write_bytes(raw)
    print(json.dumps({'mode': 'check' if sys.argv[1:] else 'generate',
                      'zlibRuntime': zlib.ZLIB_RUNTIME_VERSION,
                      'files': {name: {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                                for name, raw in rendered.items()}}, sort_keys=True))


if __name__ == '__main__':
    main()
