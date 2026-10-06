"""Synthetic, local-only regressions. Does not run systemctl, Node RPC or Aliyun."""
import json
import pathlib
import runpy
import unittest

API = runpy.run_path(str(pathlib.Path(__file__).with_name('audit.py')))

class ReadonlyProjectionTests(unittest.TestCase):
    def test_nonzero_show_preserves_stdout_and_stderr(self):
        r = API['result']('show', 'geo-backup.timer', 1,
                          'Id=geo-backup.timer\nActiveState=active\nUnitFileState=enabled\n',
                          'Failed to get properties: Unit name chrony-dnssrv@.timer is neither a valid invocation ID nor unit name.\n')
        self.assertEqual(r['returncode'], 1)
        self.assertEqual(r['stdout']['properties']['ActiveState'], 'active')
        self.assertEqual(r['stdout']['properties']['UnitFileState'], 'enabled')
        self.assertGreater(r['stderr']['bytes'], 0)
        self.assertIn('chrony-dnssrv@.timer', r['stderr']['sanitizedLines'][0])

    def test_nonzero_is_enabled_retains_disabled(self):
        r = API['result']('is-enabled', 'example@.timer', 1, 'disabled\n', '')
        self.assertEqual(r['stdout']['otherLines'][0]['safeState'], 'disabled')

    def test_synthetic_secrets_and_urls_are_withheld(self):
        marker = 'SYNTHETIC_NOT_A_REAL_CREDENTIAL_758c'
        r = API['result']('show', 'example.service', 1,
                          'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/example/task.js --token=' + marker + ' ; }\nUnknownProperty=' + marker + '\n',
                          'TOKEN=' + marker + '\nhttps://invalid.example/?token=' + marker + '\n')
        serialized = json.dumps(r)
        self.assertNotIn(marker, serialized)
        self.assertNotIn('https://', serialized)
        self.assertEqual(r['stdout']['properties']['ExecStart']['visibleProgramOrScriptPaths'],
                         ['/opt/example/task.js', '/usr/bin/node'])
        self.assertTrue(r['stdout']['otherLines'][0]['sha256'])
        self.assertTrue(r['stderr']['sanitizedLines'])

    def test_empty_streams_have_stable_digests(self):
        r = API['result']('show', 'example.service', 0, '', '')
        self.assertEqual(r['stdout']['sha256'], API['sha'](''))
        self.assertEqual(r['stderr']['sha256'], API['sha'](''))

if __name__ == '__main__':
    unittest.main()
