"""Pure local export-boundary tests; no producer, host or external-service execution."""
import copy, io, json, os, tempfile, tarfile, unittest
from pathlib import Path
import safe_source as safe

class SafeExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = safe.load_allowlist()
        cls.blobs = safe.stage_blobs(safe.HERE / 'sources', cls.manifest)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='safe-export-negative-', dir=safe.HERE)
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def tree(self):
        path = self.root / 'sources'; safe.write_new_tree(self.blobs, path); return path

    def write_tar(self, extra=None, omit=None, duplicate=None):
        path = self.root / 'mutated.tar.gz'
        with tarfile.open(path, 'w:gz') as tf:
            for name, raw in self.blobs.items():
                if name == omit: continue
                member = tarfile.TarInfo(name); member.size = len(raw); tf.addfile(member, io.BytesIO(raw))
            if extra:
                name, kind = extra; member = tarfile.TarInfo(name)
                if kind == 'symlink': member.type = tarfile.SYMTYPE; member.linkname = '/forbidden'
                elif kind == 'hardlink': member.type = tarfile.LNKTYPE; member.linkname = next(iter(self.blobs))
                else: member.size = 2
                tf.addfile(member, io.BytesIO(b'{}') if member.isfile() else None)
            if duplicate:
                raw = self.blobs[duplicate]; member = tarfile.TarInfo(duplicate); member.size = len(raw); tf.addfile(member, io.BytesIO(raw))
        return path

    def test_01_complete_payload_has_only_fixed_members(self):
        proof = safe.verify_payload(self.blobs, self.manifest)
        self.assertEqual(proof['files'], 130); self.assertEqual(proof['ownerMappings'], 65)
        self.assertFalse(proof['actualExecutionVerified']); self.assertFalse(proof['currentOfficialStateVerified'])

    def test_02_pack_restore_roundtrip(self):
        path = self.root / 'safe.tar.gz'; safe.pack(self.blobs, path)
        restored = safe.tar_blobs(path, self.manifest); safe.write_new_tree(restored, self.root / 'restored')
        self.assertEqual(safe.stage_blobs(self.root / 'restored', self.manifest), self.blobs)

    def test_03_extra_report_rejected(self):
        root = self.tree(); (root / 'REPORT.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'UNLISTED_FILE'): safe.stage_blobs(root, self.manifest)

    def test_04_extra_pyc_rejected(self):
        root = self.tree(); (root / 'unlisted.pyc').write_bytes(b'bytecode')
        with self.assertRaisesRegex(ValueError, 'UNLISTED_FILE'): safe.stage_blobs(root, self.manifest)

    def test_05_extra_run_directory_rejected(self):
        root = self.tree(); (root / 'runs').mkdir()
        with self.assertRaisesRegex(ValueError, 'UNLISTED_DIRECTORY'): safe.stage_blobs(root, self.manifest)

    def test_06_actual_binding_and_nonce_rejected(self):
        for name in ['activation.json', 'control-base.json', 'context-read.sql', 'nonce.json']:
            with self.subTest(name=name):
                root = self.root / name.replace('.', '-'); safe.write_new_tree(self.blobs, root)
                (root / 'hosts/astellas/host' / name).write_text('{}')
                with self.assertRaisesRegex(ValueError, 'UNLISTED_FILE'): safe.stage_blobs(root, self.manifest)

    def test_07_missing_required_template_rejected(self):
        for name in ['host-config.template.json', 'control-base.template.json', 'context-read.sql.template']:
            with self.subTest(name=name):
                root = self.root / name; safe.write_new_tree(self.blobs, root)
                (root / 'hosts/takeda/host' / name).unlink()
                with self.assertRaisesRegex(ValueError, 'MISSING_REQUIRED_MEMBER'): safe.stage_blobs(root, self.manifest)

    def test_08_file_symlink_rejected(self):
        root = self.tree(); p = root / next(iter(self.blobs)); p.unlink(); p.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'STAGING_SYMLINK'): safe.stage_blobs(root, self.manifest)

    def test_09_directory_symlink_rejected(self):
        root = self.tree(); (root / 'escape').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'STAGING_SYMLINK'): safe.stage_blobs(root, self.manifest)

    def test_10_symlink_output_parent_rejected(self):
        link = self.root / 'link'; link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'SYMLINK_COMPONENT'): safe.write_new_tree(self.blobs, link / 'output')
        self.assertFalse((self.root / 'output').exists())

    def test_11_existing_destination_rejected(self):
        root = self.tree()
        with self.assertRaisesRegex(ValueError, 'DESTINATION_MUST_BE_NEW'): safe.write_new_tree(self.blobs, root)

    def test_12_path_traversal_forms_rejected(self):
        for name in ['/absolute', '../escape', 'a/../escape', './path', 'a//b', 'a\\b', 'a/./b', 'a\x00b']:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, 'UNSAFE_PATH'): safe.safe_name(name)

    def test_13_tar_extra_report_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNLISTED_TAR_MEMBER'): safe.tar_blobs(self.write_tar(extra=('REPORT.json', 'file')), self.manifest)

    def test_14_tar_symlink_and_hardlink_rejected(self):
        for kind in ['symlink', 'hardlink']:
            with self.subTest(kind=kind):
                with self.assertRaisesRegex(ValueError, 'NONREGULAR_TAR_MEMBER'): safe.tar_blobs(self.write_tar(extra=('link', kind)), self.manifest)

    def test_15_tar_traversal_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNSAFE_PATH'): safe.tar_blobs(self.write_tar(extra=('../escape', 'file')), self.manifest)

    def test_16_tar_duplicate_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_TAR_MEMBER'): safe.tar_blobs(self.write_tar(duplicate=next(iter(self.blobs))), self.manifest)

    def test_17_tar_missing_template_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNLISTED_TAR_MEMBER'): safe.tar_blobs(self.write_tar(omit='hosts/astellas/host/control-base.template.json'), self.manifest)

    def test_18_source_member_tampering_rejected(self):
        root = self.tree(); (root / next(iter(self.blobs))).write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'PAYLOAD_BYTES_MISMATCH'): safe.stage_blobs(root, self.manifest)

    def test_19_fixed_allowlist_tampering_rejected(self):
        path = self.root / 'allowlist.json'; path.write_text(json.dumps(self.manifest) + '\n')
        with self.assertRaisesRegex(ValueError, 'FIXED_ALLOWLIST_HASH'): safe.load_allowlist(path)

    def test_20_wrong_frozen_input_archive_rejected(self):
        path = self.write_tar()
        with self.assertRaisesRegex(ValueError, 'FROZEN_INPUT_ARCHIVE_HASH'): safe.tar_blobs(path, self.manifest, sealed_input=True)

    def test_21_candidate_template_cannot_claim_binding(self):
        blobs = dict(self.blobs); name = 'hosts/astellas/host/control-base.template.json'; value = json.loads(blobs[name]); value['candidate'] = {'id': 'synthetic-wrong-bound-candidate'}; blobs[name] = json.dumps(value).encode()
        with self.assertRaisesRegex(ValueError, 'UNBOUND_TEMPLATE_REQUIRED'): safe.semantics(blobs)

    def test_22_database_identity_cannot_be_blank_or_substituted(self):
        blobs = dict(self.blobs); name = 'hosts/takeda/host/control-base.template.json'; value = json.loads(blobs[name]); value['databaseIdentity'] = {}; blobs[name] = json.dumps(value).encode()
        with self.assertRaisesRegex(ValueError, 'C51_DATABASE_PIN'): safe.semantics(blobs)

    def test_23_source_plan_cannot_be_replaced(self):
        blobs = dict(self.blobs); name = safe.AUTHORITY + 'takeda.source-plan.json'; value = json.loads(blobs[name]); value['adapterId'] = 'synthetic-other'; blobs[name] = json.dumps(value).encode()
        with self.assertRaisesRegex(ValueError, 'SOURCE_PLAN_CANONICAL_HASH'): safe.semantics(blobs)

    def test_24_owner_dependency_cannot_escape_payload(self):
        blobs = dict(self.blobs); name = safe.OWNER + 'baseline-manifest.json'; value = json.loads(blobs[name]); key = next(k for k in value['files'] if '/hosts/astellas/' in k); entry = value['files'].pop(key); value['files'][value['runtimeRoot'] + '/../escape'] = entry; blobs[name] = json.dumps(value).encode()
        with self.assertRaisesRegex(ValueError, 'UNSAFE_PATH'): safe.semantics(blobs)

if __name__ == '__main__':
    unittest.main(verbosity=2)
