#!/usr/bin/env python3
"""Secret-free recovery helper. Preparation is read-only; restore needs fresh approval."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import ssl
import stat
import subprocess
import tarfile
import urllib.parse
import urllib.request

WORKSPACE = Path('/workspace/scratch/5e9614251709')
ROOT = WORKSPACE / '.aliyun-dot'
HOME = ROOT / 'home'
CONFIG = HOME / '.aliyun/config.json'
BINARY = ROOT / 'bin/aliyun'
SOURCE = WORKSPACE / 'attachments/6df57dfe-cbb9-40bc-bd1d-eac02063e1a1/aliyun-korea.env.bin'
VERSION = '3.5.1'
PROFILE = 'dot-web-deploy'
REGION = 'ap-northeast-2'
ARCHIVE_NAME = 'aliyun-cli-linux-3.5.1-amd64.tgz'
ARCHIVE = ROOT / 'downloads' / ARCHIVE_NAME
ARCHIVE_URL = 'https://github.com/aliyun/aliyun-cli/releases/download/v3.5.1/' + ARCHIVE_NAME
ARCHIVE_SIZE = 77419794
ARCHIVE_SHA256 = '3a9a45b9c7899228074135612d2b7ebbf32abb97826d825787cb454cd3011bdc'
FIELDS = {'ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET', 'ALIYUN_DEFAULT_REGION'}
PROFILE_FIELDS = {'name', 'mode', 'access_key_id', 'access_key_secret', 'region_id',
                  'output_format', 'language', 'connect_timeout', 'read_timeout', 'retry_count'}


class SafeError(Exception):
    """Only fixed, non-sensitive error codes may be exposed."""


def require(condition, code):
    if not condition:
        raise SafeError(code)


def check_workspace_path(path):
    require(path.is_absolute(), 'absolute_path_required')
    require('..' not in path.parts, 'parent_path_not_allowed')
    try:
        relative = path.relative_to(WORKSPACE)
    except ValueError:
        raise SafeError('path_outside_approved_workspace') from None
    current = WORKSPACE
    require(WORKSPACE.is_dir() and not WORKSPACE.is_symlink(), 'workspace_unavailable')
    for part in relative.parts:
        current /= part
        require(not current.is_symlink(), 'symlink_not_allowed')


def private_file(path, mode=0o600):
    check_workspace_path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode), 'regular_file_required')
    require(info.st_uid == os.getuid() and info.st_nlink == 1, 'file_owner_or_links_invalid')
    require(stat.S_IMODE(info.st_mode) == mode, 'file_permissions_invalid')


def private_dir(path, create=False):
    check_workspace_path(path)
    if create and not path.exists():
        path.mkdir(mode=0o700)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid(), 'directory_owner_invalid')
    require(stat.S_IMODE(info.st_mode) == 0o700, 'directory_permissions_invalid')


def parse_env(text):
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].strip()
        key, separator, value = line.partition('=')
        key, value = key.strip(), value.strip()
        require(separator and key in FIELDS and key not in values, 'env_fields_invalid')
        if value and value[0] in "\"'":
            require(len(value) >= 2 and value[-1] == value[0], 'env_literal_quotes_invalid')
            value = value[1:-1]
        require(bool(re.fullmatch(r'[A-Za-z0-9_+/=.-]+', value)), 'env_literal_invalid')
        values[key] = value
    require(set(values) == FIELDS, 'env_required_fields_missing')
    require(values['ALIYUN_DEFAULT_REGION'] == REGION, 'unexpected_region')
    require(all(16 <= len(values[key]) <= 256 for key in FIELDS
                if key != 'ALIYUN_DEFAULT_REGION'), 'credential_length_invalid')
    return values


def read_source(path):
    private_file(path)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        raw = stream.read(16385)
    require(len(raw) <= 16384, 'credential_file_too_large')
    return parse_env(raw.decode('utf-8-sig'))


def read_archive():
    private_file(ARCHIVE)
    require(ARCHIVE.stat().st_size == ARCHIVE_SIZE, 'archive_size_mismatch')
    raw = ARCHIVE.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA256, 'archive_digest_mismatch')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        members = archive.getmembers()
        require(len(members) == 1, 'archive_layout_invalid')
        member = members[0]
        require(member.name in ('aliyun', './aliyun') and member.isfile()
                and not member.islnk() and not member.issym(), 'archive_entry_invalid')
        require(0 < member.size < 200_000_000, 'binary_size_invalid')
        return archive.extractfile(member).read()


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        require(url.scheme == 'https' and url.hostname in {
            'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'
        }, 'unapproved_download_redirect')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download_official_archive():
    if ARCHIVE.exists():
        read_archive()
        return
    partial = ARCHIVE.with_suffix('.part')
    check_workspace_path(partial)
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    opener = urllib.request.build_opener(OfficialRedirect(), urllib.request.HTTPSHandler(context=context))
    descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    completed = False
    try:
        with os.fdopen(descriptor, 'wb') as output:
            with opener.open(ARCHIVE_URL, timeout=60) as response:
                total = 0
                digest = hashlib.sha256()
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    require(total <= ARCHIVE_SIZE, 'archive_exceeds_expected_size')
                    digest.update(chunk)
                    output.write(chunk)
                require(total == ARCHIVE_SIZE, 'archive_size_mismatch')
                require(digest.hexdigest() == ARCHIVE_SHA256, 'archive_digest_mismatch')
            output.flush()
            os.fsync(output.fileno())
        require(not ARCHIVE.exists(), 'archive_target_already_exists')
        os.rename(partial, ARCHIVE)
        completed = True
    finally:
        if not completed and partial.exists():
            partial.unlink()  # Only this invocation's public download fragment.


def exclusive_write(path, data, mode):
    check_workspace_path(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def safe_environment():
    environment = {'HOME': str(HOME), 'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
                   'ALIBABA_CLOUD_DISABLE_EXTERNAL_PROCESS': 'true',
                   'ALIBABA_CLOUD_CLI_PLUGIN_AUTO_INSTALL': 'false'}
    for key in ('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy',
                'http_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR'):
        if key in os.environ:
            environment[key] = os.environ[key]
    return environment


def verify_binary():
    private_file(BINARY, 0o700)
    expected_binary = read_archive()
    require(hashlib.sha256(BINARY.read_bytes()).digest() == hashlib.sha256(expected_binary).digest(),
            'installed_binary_digest_mismatch')


def validate_private_config():
    for directory in (ROOT, HOME, CONFIG.parent):
        private_dir(directory)
    private_file(CONFIG)
    config = json.loads(CONFIG.read_text())
    require(set(config) == {'current', 'profiles', 'meta_path'}, 'configuration_fields_invalid')
    require(config['current'] == PROFILE and config['meta_path'] == '', 'configuration_target_invalid')
    require(len(config['profiles']) == 1, 'configuration_profile_count_invalid')
    profile = config['profiles'][0]
    require(set(profile) == PROFILE_FIELDS, 'profile_fields_invalid')
    require(profile['name'] == PROFILE and profile['mode'] == 'AK'
            and profile['region_id'] == REGION, 'profile_target_invalid')
    parse_env('\n'.join((
        'ALIYUN_ACCESS_KEY_ID=' + profile['access_key_id'],
        'ALIYUN_ACCESS_KEY_SECRET=' + profile['access_key_secret'],
        'ALIYUN_DEFAULT_REGION=' + profile['region_id'])))


def restore(source, approval_message_id):
    # A string/flag is NOT authorization. The caller must first obtain fresh user confirmation.
    require(bool(approval_message_id.strip()), 'fresh_approval_reference_required')
    require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'unsupported_platform')
    require(not CONFIG.exists() and not CONFIG.is_symlink(), 'existing_config_will_not_be_overwritten')
    values = read_source(source)
    for directory in (ROOT, ROOT / 'downloads', ROOT / 'bin', HOME, CONFIG.parent):
        private_dir(directory, create=True)
    download_official_archive()
    binary = read_archive()
    if BINARY.exists():
        verify_binary()
    else:
        exclusive_write(BINARY, binary, 0o700)
    version = subprocess.run([str(BINARY), 'version'], env=safe_environment(),
                             capture_output=True, text=True, timeout=15)
    require(version.returncode == 0 and version.stdout.strip() == VERSION, 'cli_version_mismatch')
    profile = {'name': PROFILE, 'mode': 'AK', 'access_key_id': values['ALIYUN_ACCESS_KEY_ID'],
               'access_key_secret': values['ALIYUN_ACCESS_KEY_SECRET'], 'region_id': REGION,
               'output_format': 'json', 'language': 'en', 'connect_timeout': 10,
               'read_timeout': 20, 'retry_count': 0}
    config = {'current': PROFILE, 'profiles': [profile], 'meta_path': ''}
    exclusive_write(CONFIG, (json.dumps(config, separators=(',', ':')) + '\n').encode(), 0o600)
    # The CLI may create its empty plugin directory while starting.
    plugins = CONFIG.parent / 'plugins'
    if plugins.exists():
        check_workspace_path(plugins)
        require(plugins.is_dir() and not any(plugins.iterdir()), 'unexpected_plugin_directory')
        os.chmod(plugins, 0o700)
    validate_private_config()
    return {'restored': True, 'profile': PROFILE, 'region': REGION, 'sts_called': False}


def prepare(source):
    # No directory creation, installation, credential writes, or network requests.
    read_source(source)
    result = {'source_valid': True, 'profile': PROFILE, 'region': REGION,
              'configuration_exists': CONFIG.exists(), 'binary_exists': BINARY.exists(),
              'archive_exists': ARCHIVE.exists(), 'persistent_credentials_written': False,
              'network_requests_made': False}
    if ARCHIVE.exists():
        read_archive()
        result['archive_verified'] = True
    if BINARY.exists():
        verify_binary()
        result['binary_verified'] = True
    if CONFIG.exists():
        validate_private_config()
        result['configuration_valid'] = True
    return result


def verify_sts():
    verify_binary()
    validate_private_config()
    command = [str(BINARY), 'sts', 'GetCallerIdentity', '--profile', PROFILE,
               '--region', REGION, '--endpoint', 'sts.ap-northeast-2.aliyuncs.com', '--secure',
               '--connect-timeout', '10', '--read-timeout', '20', '--retry-count', '0']
    result = subprocess.run(command, env=safe_environment(), capture_output=True,
                            text=True, timeout=50)
    # Never forward CLI stdout/stderr, URLs, signatures, identifiers, or API response bodies.
    require(result.returncode == 0, 'sts_command_failed_output_suppressed')
    response = json.loads(result.stdout)
    require(isinstance(response, dict) and all(response.get(key) for key in
            ('AccountId', 'Arn', 'RequestId', 'IdentityType')), 'sts_response_invalid')
    return {'sts_verified': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest='command', required=True)
    preparing = subcommands.add_parser('prepare', help='Offline, read-only checks; no installation or writes.')
    preparing.add_argument('--credential-file', type=Path, default=SOURCE)
    restoring = subcommands.add_parser('restore', help='Install/configure only after fresh user approval.')
    restoring.add_argument('--credential-file', type=Path, default=SOURCE)
    restoring.add_argument('--approval-message-id', required=True,
                           help='Reference to fresh confirmation; a flag alone never grants authorization.')
    subcommands.add_parser('verify', help='Read-only STS call; prints success only, never the identity response.')
    arguments = parser.parse_args()
    os.umask(0o077)
    try:
        if arguments.command == 'prepare':
            result = prepare(arguments.credential_file)
        elif arguments.command == 'restore':
            result = restore(arguments.credential_file, arguments.approval_message_id)
        else:
            result = verify_sts()
        print(json.dumps(result, sort_keys=True))
        return 0
    except SafeError as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
    except Exception as error:
        # Exception messages can contain credential-bearing URLs. Expose type only.
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
