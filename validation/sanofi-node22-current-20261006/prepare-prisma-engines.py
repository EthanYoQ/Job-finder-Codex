from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
import shutil
import subprocess
import sys

from replay_tool_support import new_run, preserve_report, write_json


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify_engine(compressed, remote_compressed_sha, remote_binary_sha, pin):
    """Both sidecars AND bytes must match the already-frozen local pins."""
    if remote_compressed_sha != pin['compressed_sha256'] or digest(compressed) != pin['compressed_sha256']:
        raise ValueError('PINNED_COMPRESSED_ENGINE_CHECKSUM_MISMATCH')
    if remote_binary_sha != pin['binary_sha256']:
        raise ValueError('PINNED_BINARY_ENGINE_CHECKSUM_MISMATCH')
    data = gzip.decompress(compressed)
    if digest(data) != pin['binary_sha256'] or len(data) != pin['size']:
        raise ValueError('PINNED_BINARY_ENGINE_BYTES_MISMATCH')
    return data


def download(url, destination):
    process = subprocess.run(
        ['curl', '--fail', '--show-error', '--silent', '--location', '--proto', '=https',
         '--tlsv1.2', '--max-time', '90', url, '-o', str(destination)],
        capture_output=True, text=True,
    )
    if process.returncode:
        raise RuntimeError('Official engine download failed: ' + url + ' ' + process.stderr)


def main(root=None, downloader=download):
    root = Path(root or Path(__file__).resolve().parent)
    run_dir = new_run(root, 'prisma-engines')
    report_path = root / 'prisma-engine-verification.json'
    preserve_report(report_path, run_dir)
    report = {'status': 'IN_PROGRESS', 'engines': [], 'errors': []}
    write_json(report_path, report)
    try:
        contract = json.loads((root / 'RUNTIME_REQUIREMENTS.json').read_text())['prisma']
        commit = json.loads((root / 'main/node_modules/@prisma/engines-version/package.json').read_text())['prisma']['enginesVersion']
        if commit != contract['engineCommit']:
            raise ValueError('PINNED_ENGINE_COMMIT_MISMATCH')
        base = f"https://binaries.prisma.sh/all_commits/{commit}/{contract['platform']}/"
        names = ['schema-engine', 'libquery_engine.so.node']
        pins = {pin['official_url']: pin for pin in contract['engines']}
        if set(pins) != {base + name + '.gz' for name in names}:
            raise ValueError('PINNED_OFFICIAL_ENGINE_URL_MISMATCH')

        def prepare(name):
            pin = pins[base + name + '.gz']
            for extension in ['.gz.sha256', '.sha256', '.gz']:
                downloader(base + name + extension, run_dir / (name + extension))
            compressed = (run_dir / (name + '.gz')).read_bytes()
            remote_compressed = (run_dir / (name + '.gz.sha256')).read_text().split()[0]
            remote_binary = (run_dir / (name + '.sha256')).read_text().split()[0]
            data = verify_engine(compressed, remote_compressed, remote_binary, pin)
            output_name = f"schema-engine-{contract['platform']}" if name == 'schema-engine' else f"libquery_engine-{contract['platform']}.so.node"
            return output_name, data, dict(pin)

        prepared = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [(name, pool.submit(prepare, name)) for name in names]
            for name, future in futures:
                try:
                    prepared.append(future.result())
                except Exception as error:
                    report['errors'].append({'engine': name, 'error': type(error).__name__, 'message': str(error)})
        if report['errors']:
            report['status'] = 'FAILED'
            write_json(report_path, report)
            return 1
        # Do not install either binary until BOTH official downloads match the local pins.
        destination = root / 'runtime/prisma-engines'
        destination.mkdir(parents=True, exist_ok=True)
        for output_name, data, pin in prepared:
            path = destination / output_name
            path.write_bytes(data)
            path.chmod(0o755)
            for candidate in ['main', 'fallback']:
                shutil.copy2(path, root / candidate / 'node_modules/@prisma/engines' / output_name)
            report['engines'].append({**pin, 'local_path': str(path), 'pinned_checksums_verified': True})
        report.update(status='PASS', prisma_version=contract['client'], engine_commit=commit, platform=contract['platform'])
        write_json(report_path, report)
        return 0
    except Exception as error:
        report['errors'].append({'error': type(error).__name__, 'message': str(error)})
        report['status'] = 'FAILED'
        write_json(report_path, report)
        return 1


if __name__ == '__main__':
    sys.exit(main())
