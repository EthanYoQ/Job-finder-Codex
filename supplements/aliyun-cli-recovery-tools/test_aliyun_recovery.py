"""Offline tests use synthetic fixtures only. No real keys or API calls."""
import unittest
from unittest import mock

import aliyun_recovery as recovery


FIXTURE = '\n'.join([
    'ALIYUN_ACCESS_KEY_ID=TEST_ONLY_FAKE_ACCESS_ID',
    'ALIYUN_ACCESS_KEY_SECRET=TEST_ONLY_FAKE_SECRET_VALUE',
    'ALIYUN_DEFAULT_REGION=ap-northeast-2',
])


class LiteralParserTests(unittest.TestCase):
    def test_valid_literal(self):
        self.assertEqual(set(recovery.parse_env(FIXTURE)), recovery.FIELDS)

    def test_quotes_comments_and_export(self):
        text = FIXTURE.replace('ALIYUN_ACCESS_KEY_ID=TEST_ONLY_FAKE_ACCESS_ID',
                               'export ALIYUN_ACCESS_KEY_ID="TEST_ONLY_FAKE_ACCESS_ID"')
        self.assertEqual(set(recovery.parse_env('# Fixture\n\n' + text)), recovery.FIELDS)

    def test_rejects_expansion_and_commands(self):
        for invalid in ('$(echo bad)', '`echo bad`', '${HOME}', 'value;false', 'value\\n'):
            with self.subTest(invalid=invalid), self.assertRaises(recovery.SafeError):
                recovery.parse_env(FIXTURE.replace('TEST_ONLY_FAKE_SECRET_VALUE', invalid))

    def test_rejects_duplicates_extra_keys_and_wrong_region(self):
        for text in (FIXTURE + '\nALIYUN_ACCESS_KEY_ID=TEST_ONLY_DUPLICATE',
                     FIXTURE + '\nOTHER_FIELD=abc',
                     FIXTURE.replace('ap-northeast-2', 'cn-hangzhou')):
            with self.assertRaises(recovery.SafeError):
                recovery.parse_env(text)

    def test_requires_all_fields(self):
        with self.assertRaises(recovery.SafeError):
            recovery.parse_env('ALIYUN_DEFAULT_REGION=ap-northeast-2')

    def test_rejects_malformed_quotes(self):
        with self.assertRaises(recovery.SafeError):
            recovery.parse_env(FIXTURE.replace('TEST_ONLY_FAKE_SECRET_VALUE', '"not_closed'))

    def test_restore_refuses_missing_confirmation_before_reading(self):
        with mock.patch.object(recovery, 'read_source') as read_source:
            with self.assertRaises(recovery.SafeError):
                recovery.restore(recovery.SOURCE, '')
            read_source.assert_not_called()

    def test_prepare_does_not_download_or_run_commands(self):
        with mock.patch.object(recovery, 'read_source'), \
             mock.patch.object(recovery.Path, 'exists', return_value=False), \
             mock.patch.object(recovery, 'download_official_archive') as download, \
             mock.patch.object(recovery.subprocess, 'run') as run:
            result = recovery.prepare(recovery.SOURCE)
            self.assertFalse(result['persistent_credentials_written'])
            self.assertFalse(result['network_requests_made'])
            download.assert_not_called()
            run.assert_not_called()

    def test_cross_workspace_path_is_rejected(self):
        with self.assertRaises(recovery.SafeError):
            recovery.check_workspace_path(recovery.Path('/tmp/outside-approved-workspace'))


if __name__ == '__main__':
    unittest.main()
