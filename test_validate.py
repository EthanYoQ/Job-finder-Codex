"""All bodies and all review attestations below are synthetic fixtures."""
import copy
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from validate import CONTRACT, digest, read_json, validate


def fixture(directory):
    root = directory / "bodies"
    root.mkdir(parents=True)
    payload = b"SYNTHETIC PAYLOAD: alpha\nSYNTHETIC PAYLOAD: beta\n"
    contents = {
        "bootstrap": b"SYNTHETIC BOOTSTRAP DESCRIPTION. No executable program.\n",
        "payload": payload,
        "chunk-000": payload[:23],
        "chunk-001": payload[23:],
        "intent": b'{"synthetic":true,"historicalOnly":true,"action":"example-deploy"}\n',
        "receipt": b'{"synthetic":true,"historicalOnly":true,"result":"example-only"}\n',
    }
    roles = {"bootstrap": "bootstrap", "payload": "payload", "chunk-000": "chunk",
             "chunk-001": "chunk", "intent": "historical-intent", "receipt": "historical-receipt"}
    dependencies = {"bootstrap": [], "payload": ["bootstrap"], "chunk-000": ["payload"],
                    "chunk-001": ["payload"], "intent": ["payload"], "receipt": ["intent", "payload"]}
    manifest = {"contractId": CONTRACT, "mode": "complete", "runtimeReady": False,
                "launchAuthorized": False, "restoreLiveState": False, "replayAuthority": "none",
                "restoreMode": "offline-inert", "artifacts": [], "transfers": [], "gaps": []}
    scope = {"contractId": CONTRACT, "frozen": True, "syntheticFixtureOnly": True,
             "requiredArtifacts": [], "transfers": []}
    for key, body in contents.items():
        rel = ("archive-only/" if key in {"intent", "receipt"} else "materials/") + key + ".txt"
        (root / rel).parent.mkdir(exist_ok=True)
        (root / rel).write_bytes(body)
        item = {"id": key, "role": roles[key], "sha256": digest(body), "dependsOn": dependencies[key],
                "bodyPath": rel, "size": len(body), "provenance": "original", "originalBodyIncluded": True,
                "markedSafe": True, "review": {"status": "approved-nonsecret", "sha256": digest(body),
                "reviewer": "synthetic-fixture-reviewer", "reviewedAt": "2026-10-06T15:00:00Z", "findings": []},
                "restoreDisposition": "archive-only" if key in {"intent", "receipt"} else "inert-material",
                "replayAuthority": "none", "liveStateEligible": False, "automaticActivation": False}
        manifest["artifacts"].append(item)
        scope["requiredArtifacts"].append({field: item[field] for field in ("id", "role", "sha256", "dependsOn")})
    transfer = {"id": "synthetic-transfer", "payloadId": "payload", "bootstrapId": "bootstrap",
                "chunkIds": ["chunk-000", "chunk-001"]}
    scope["transfers"].append(copy.deepcopy(transfer))
    manifest["transfers"].append({**transfer, "chunkCount": 2})
    return manifest, scope, root


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="synthetic-deployment-contract-")
        self.addCleanup(self.temp.cleanup)
        self.manifest, self.scope, self.root = fixture(Path(self.temp.name))

    def artifact(self, key):
        return next(a for a in self.manifest["artifacts"] if a["id"] == key)

    def result(self):
        return validate(self.manifest, self.scope, self.root)

    def reject(self, expected):
        result = self.result()
        self.assertFalse(result["valid"], result)
        self.assertFalse(result["recoveryComplete"])
        self.assertFalse(result["runtimeReady"])
        self.assertTrue(any(expected in error for error in result["errors"]), result)

    def omit(self, key):
        item = self.artifact(key)
        (self.root / item["bodyPath"]).unlink()
        item.update(bodyPath=None, originalBodyIncluded=False, provenance="unavailable", markedSafe=False,
                    omissionReason="Synthetic unavailable original", review={"status": "pending"})
        self.manifest["gaps"].append({"id": key, "reason": "Synthetic unavailable original"})

    def test_complete_originals_and_transfer_pass(self):
        result = self.result()
        self.assertTrue(result["valid"], result)
        self.assertTrue(result["recoveryComplete"])
        self.assertFalse(result["runtimeReady"])
        self.assertFalse(result["launchAuthorized"])

    def test_hash_only_cannot_be_complete(self):
        self.omit("bootstrap")
        self.reject("hashes alone")

    def test_original_flag_cannot_hide_missing_body(self):
        self.omit("intent")
        self.artifact("intent")["originalBodyIncluded"] = True
        self.reject("originalBodyIncluded")

    def test_explicit_partial_records_gap(self):
        self.omit("chunk-001")
        self.manifest["mode"] = "partial"
        result = self.result()
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["gaps"], ["chunk-001"])
        self.assertFalse(result["recoveryComplete"])
        self.assertFalse(result["runtimeReady"])

    def test_partial_cannot_hide_gap(self):
        self.omit("payload")
        self.manifest.update(mode="partial", gaps=[])
        self.reject("gaps must name")

    def test_omitting_manifest_entry_cannot_shrink_scope(self):
        self.manifest["artifacts"].remove(self.artifact("receipt"))
        self.reject("artifact IDs")

    def test_dependency_break_rejected(self):
        self.artifact("receipt")["dependsOn"] = ["missing-intent"]
        self.reject("unknown dependency")

    def test_dependency_cycle_rejected(self):
        self.artifact("bootstrap")["dependsOn"] = ["payload"]
        self.reject("cyclic dependency")

    def test_pending_cannot_be_marked_safe(self):
        self.artifact("bootstrap")["review"]["status"] = "pending"
        self.reject("safety label contradicts")

    def test_secret_cannot_be_marked_safe(self):
        self.artifact("intent")["review"]["status"] = "secret"
        self.reject("safety label contradicts")

    def test_unresolved_findings_rejected(self):
        self.artifact("receipt")["review"]["findings"] = ["SYNTHETIC test finding; no actual secret"]
        self.reject("unresolved findings")

    def test_review_hash_binding_rejected(self):
        self.artifact("payload")["review"]["sha256"] = "0" * 64
        self.reject("review is not bound")

    def test_chunk_count_rejected(self):
        self.manifest["transfers"][0]["chunkCount"] = 3
        self.reject("chunk count")

    def test_chunk_hash_rejected(self):
        item = self.artifact("chunk-000")
        (self.root / item["bodyPath"]).write_bytes(b"SYNTHETIC corrupted bytes")
        self.reject("body hash mismatch")

    def test_chunk_order_rejected(self):
        self.manifest["transfers"][0]["chunkIds"].reverse()
        self.reject("ordered chunks do not reassemble")

    def test_hashes_consistent_but_reassembly_wrong_rejected(self):
        # Each body/hash/review/scope matches, but the transfer relation is false.
        item = self.artifact("chunk-000")
        body = b"SYNTHETIC unrelated chunk"
        (self.root / item["bodyPath"]).write_bytes(body)
        item.update(sha256=digest(body), size=len(body))
        item["review"]["sha256"] = digest(body)
        next(a for a in self.scope["requiredArtifacts"] if a["id"] == "chunk-000")["sha256"] = digest(body)
        self.reject("ordered chunks do not reassemble")

    def test_history_archive_only_passes(self):
        for key in ("intent", "receipt"):
            self.assertEqual(self.artifact(key)["restoreDisposition"], "archive-only")
        self.assertTrue(self.result()["valid"])

    def test_history_cannot_restore_live_state_or_replay(self):
        for key, field, value, expected in [
            ("intent", "replayAuthority", "historical-approval", "replay authority"),
            ("receipt", "liveStateEligible", True, "live-state"),
            ("intent", "automaticActivation", True, "automatic activation"),
            ("receipt", "restoreDisposition", "inert-material", "restore disposition"),
        ]:
            with self.subTest(key=key, field=field):
                item = self.artifact(key)
                old = item[field]
                item[field] = value
                self.reject(expected)
                item[field] = old

    def test_partial_cannot_claim_runtime_ready(self):
        self.manifest.update(mode="partial", runtimeReady=True)
        self.reject("runtimeReady must be false")

    def test_path_escape_rejected_without_reading_target(self):
        self.artifact("bootstrap")["bodyPath"] = "../not-read.txt"
        self.reject("path traversal")

    def test_symlink_rejected(self):
        item = self.artifact("bootstrap")
        path = self.root / item["bodyPath"]
        path.unlink()
        path.symlink_to(self.root / self.artifact("payload")["bodyPath"])
        self.reject("symlinked")

    def test_unlisted_body_rejected(self):
        (self.root / "unlisted.txt").write_text("SYNTHETIC unlisted bytes")
        self.reject("unlisted")

    def test_historical_body_must_remain_archive_only(self):
        item = self.artifact("intent")
        new_rel = "materials/intent.txt"
        (self.root / item["bodyPath"]).rename(self.root / new_rel)
        item["bodyPath"] = new_rel
        self.reject("must remain under archive-only")

    def test_executable_permission_rejected(self):
        (self.root / self.artifact("bootstrap")["bodyPath"]).chmod(0o755)
        self.reject("executable permissions")

    def test_duplicate_json_key_rejected(self):
        path = Path(self.temp.name) / "duplicate.json"
        path.write_text('{"mode":"complete","mode":"partial"}')
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            read_json(path)

    def assert_root_rejected_before_access(self, root, stop_path):
        calls = []
        real_lstat = Path.lstat

        def record_lstat(path, *args, **kwargs):
            calls.append(path)
            return real_lstat(path, *args, **kwargs)

        # Spies fail immediately if validation reads a body or enumerates a
        # directory at all. The exact lstat sequence must stop at the link.
        with mock.patch.object(Path, "lstat", record_lstat), \
                mock.patch.object(Path, "read_bytes", side_effect=AssertionError("body read before root gate")) as read, \
                mock.patch("os.scandir", side_effect=AssertionError("enumeration before root gate")) as scan:
            result = validate(self.manifest, self.scope, root)
        self.assertFalse(result["valid"], result)
        self.assertTrue(any("root or ancestor" in error for error in result["errors"]), result)
        read.assert_not_called()
        scan.assert_not_called()
        self.assertEqual(calls, list(reversed(stop_path.parents)) + [stop_path])

    def test_root_ancestor_symlink_stops_before_access(self):
        alias = Path(self.temp.name) / "alias"
        alias.symlink_to(Path(self.temp.name), target_is_directory=True)
        self.assert_root_rejected_before_access(alias / "bodies", alias)

    def test_partial_all_bodies_missing_ancestor_symlink_stops_before_access(self):
        for item in self.manifest["artifacts"]:
            self.omit(item["id"])
        self.manifest["mode"] = "partial"
        self.assertTrue(self.result()["valid"])
        alias = Path(self.temp.name) / "alias"
        alias.symlink_to(Path(self.temp.name), target_is_directory=True)
        self.assert_root_rejected_before_access(alias / "bodies", alias)

    def test_root_itself_symlink_stops_before_access(self):
        alias = Path(self.temp.name) / "body-link"
        alias.symlink_to(self.root, target_is_directory=True)
        self.assert_root_rejected_before_access(alias, alias)

    def assert_special_node_rejected_before_body_reads(self, rel):
        with mock.patch.object(Path, "read_bytes", side_effect=AssertionError("body read before special-node gate")) as read:
            result = self.result()
        self.assertFalse(result["valid"], result)
        self.assertTrue(any("special archive node" in error and rel in error for error in result["errors"]), result)
        read.assert_not_called()

    def test_unlisted_fifo_rejected_without_opening(self):
        os.mkfifo(self.root / "unlisted.fifo")
        self.assert_special_node_rejected_before_body_reads("unlisted.fifo")

    def test_unlisted_unix_socket_rejected_without_opening(self):
        # A real socket inode is sufficient for this static lstat boundary.
        # No socket(), bind(), listener or communication endpoint is created.
        path = self.root / "unlisted.sock"
        os.mknod(path, stat.S_IFSOCK | 0o600)
        self.assertTrue(stat.S_ISSOCK(path.lstat().st_mode))
        self.assert_special_node_rejected_before_body_reads("unlisted.sock")

    def test_nested_symlink_is_not_enumerated(self):
        target = Path(self.temp.name) / "target"
        target.mkdir()
        (target / "never-read.txt").write_text("SYNTHETIC link target")
        (self.root / "nested-link").symlink_to(target, target_is_directory=True)
        real_scan, scanned = os.scandir, []

        def guarded_scan(path):
            scanned.append(Path(path))
            self.assertNotIn("nested-link", Path(path).parts)
            self.assertNotEqual(Path(path), target)
            return real_scan(path)

        with mock.patch("os.scandir", side_effect=guarded_scan), \
                mock.patch.object(Path, "read_bytes", side_effect=AssertionError("body read with nested link")) as read:
            self.reject("symlinked")
        self.assertTrue(scanned)
        read.assert_not_called()

    def test_other_special_lstat_modes_rejected_without_body_reads(self):
        # Classification-only coverage; no character/block devices are made.
        for mode in (stat.S_IFSOCK, stat.S_IFCHR, stat.S_IFBLK):
            with self.subTest(file_type=mode):
                entry = mock.Mock(path=str(self.root / "synthetic-special"))
                entry.stat.return_value = SimpleNamespace(st_mode=mode | 0o600)
                scan_context = mock.MagicMock()
                scan_context.__enter__.return_value = iter([entry])
                with mock.patch("os.scandir", return_value=scan_context), \
                        mock.patch.object(Path, "read_bytes", side_effect=AssertionError("body read before node classification")) as read:
                    self.reject("special archive node")
                entry.stat.assert_called_once_with(follow_symlinks=False)
                read.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
