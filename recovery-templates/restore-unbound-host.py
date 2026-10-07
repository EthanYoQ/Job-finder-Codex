#!/usr/bin/env python3
"""Create a NEW offline staging host from safe source and explicit null templates.

Never installs into the existing host. The producer symlink is only an import
bridge to the exact, already-restored physical runtime; it is not a new runtime.
The real binder checks that physical runtime and writes a separate PREPARED set.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

TEMPLATES = {
    'host/runtime/load-host-state.js': (
        'load-host-state.unbound.js',
        'e12fdec0403c58c1d6f7c014bd4d3c3b0d34bdb4c443c901611a5443eafa71b4'),
    'supervision/start-monitor-gilead-next-combined.js': (
        'start-monitor-gilead-next-combined.unbound.js',
        '89487bf2378f4fdca66096d645557872ba67cce2b78f7bdbb189210594ce939b'),
}
CANDIDATE_MARKER = 'const expectedCandidate=null; // OWNER_CANDIDATE_BINDING'
DATABASE_MARKER = 'const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING'


def restore(source_root, output_root):
    source_root, output_root = Path(source_root).resolve(), Path(output_root).absolute()
    if output_root.exists() or output_root.is_symlink():
        raise ValueError('RESTORE_REQUIRES_NEW_DIRECTORY')
    if output_root.parent.resolve() != output_root.parent:
        raise ValueError('RESTORE_SYMLINK_PARENT')
    host_base = source_root / 'hosts/gilead'
    cfg = json.loads((host_base / 'host/host-config.template.json').read_text())
    control = json.loads((host_base / 'host/control-base.template.json').read_text())
    if control['candidate'] is not None or control['databaseIdentity'] is not None:
        raise ValueError('RESTORE_REQUIRES_NULL_CONTROL_TEMPLATE')
    for protected in (source_root, Path(cfg['root']), Path(cfg['repo'])):
        if output_root == protected or protected in output_root.parents and protected != source_root:
            raise ValueError('RESTORE_PROTECTED_TARGET')
    producer = Path(cfg['repo'])
    if producer.resolve() != producer or not producer.is_dir():
        raise ValueError('RESTORE_PHYSICAL_PRODUCER_REQUIRED')
    allowed = json.loads((host_base / 'verification/SAFE_SOURCE_ALLOWLIST.json').read_text())['safeFiles']
    allowed = sorted(set(allowed + ['verification/SAFE_SOURCE_ALLOWLIST.json']))
    payloads = {}
    for relative in allowed:
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('RESTORE_SOURCE_PATH')
        source = host_base / path
        if source.is_symlink() or not source.is_file():
            raise ValueError('RESTORE_REGULAR_SOURCE_REQUIRED:' + relative)
        payloads[relative] = source.read_bytes()
    for relative, (template, digest) in TEMPLATES.items():
        body = (source_root / 'recovery-templates' / template).read_bytes()
        text = body.decode()
        if hashlib.sha256(body).hexdigest() != digest or text.count(CANDIDATE_MARKER) != 1:
            raise ValueError('RESTORE_UNBOUND_TEMPLATE_HASH_OR_MARKER:' + template)
        if 'load-host-state' in template and text.count(DATABASE_MARKER) != 1:
            raise ValueError('RESTORE_DATABASE_MARKER')
        payloads[relative] = body
    # No file is created until the complete source/template closure has passed.
    output_root.mkdir(mode=0o700)
    staged_base = output_root / 'hosts/gilead'
    for relative, body in payloads.items():
        destination = staged_base / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body)
    staged_host = staged_base / 'host'
    cfg['root'] = str(staged_host)
    (staged_host / 'host-config.json').write_text(json.dumps(cfg, indent=2) + '\n')
    (staged_host / 'control-base.json').write_text(json.dumps(control, indent=2) + '\n')
    activation = dict(status='UNREGISTERED_NOT_ACTIVATED', build=control['build'],
                      candidate=None, databaseIdentity=None)
    (staged_host / 'activation.json').write_text(json.dumps(activation, indent=2) + '\n')
    (output_root / 'producer').symlink_to(producer, target_is_directory=True)
    result = dict(classification='OFFLINE_UNBOUND_STAGING_ONLY', sourceRoot=str(source_root),
                  outputRoot=str(output_root), host=str(staged_host), physicalProducer=str(producer),
                  moduleImportBridge=str(output_root / 'producer'), candidate=None,
                  databaseIdentity=None, activation='UNREGISTERED_NOT_ACTIVATED',
                  binder=str(staged_host / 'runtime/prepare-owner-binding.mts'),
                  destinationExistsRequired=False, existingHostModified=False,
                  publisherStateCreated=False, launchAuthorized=False)
    (output_root / 'RESTORED_UNBOUND_TEMPLATE.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: restore-unbound-host.py <new-offline-staging-directory>')
    print(json.dumps(restore(Path(__file__).resolve().parents[1], sys.argv[1])))
