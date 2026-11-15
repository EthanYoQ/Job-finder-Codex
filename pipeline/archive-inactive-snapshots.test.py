import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("archive-inactive-snapshots.py")
CACHE = SCRIPT.parent.parent / ".runtime" / ".cache"


class ArchiveSnapshotsTest(unittest.TestCase):
    def fixture(self, root):
        directory = root / "snapshots"
        directory.mkdir()
        (root / "round.lock").touch()
        originals = {}
        for index in range(9):
            data = json.dumps({"index": index, "jobs": "synthetic job " * 1000}).encode()
            sha = hashlib.sha256(data).hexdigest()
            path = directory / f"public-{sha}.json"
            path.write_bytes(data)
            os.utime(path, (100 + index, 100 + index))
            originals[path] = data
        current = next(iter(originals))
        receipt = {"status": "SNAPSHOT_SAVED", "complete": True, "snapshotFile": str(current),
                   "sha256": hashlib.sha256(originals[current]).hexdigest(), "bytes": len(originals[current])}
        (directory / "latest.json").write_text(json.dumps(receipt))
        return directory, originals

    def command(self, root, apply=False):
        return subprocess.run([sys.executable, str(SCRIPT), "--state-root", str(root),
                               *(["--apply"] if apply else [])], capture_output=True, text=True)

    def test_current_old_locked_and_interrupted_archives(self):
        with tempfile.TemporaryDirectory(dir=CACHE, prefix="snapshot-archive-") as temporary:
            root = Path(temporary)
            directory, originals = self.fixture(root)
            paths = list(originals)
            receipt = (directory / "latest.json").read_bytes()
            evidence = root / "source-evidence.json"
            evidence.write_bytes(b"original source evidence")
            paths[1].with_suffix(".json.gz").write_bytes(gzip.compress(originals[paths[1]]))
            paths[2].with_suffix(".json.gz.tmp").write_bytes(b"interrupted compression")
            paths[3].with_suffix(".json.gz.tmp").write_bytes(gzip.compress(originals[paths[3]]))
            dry = self.command(root)
            self.assertEqual(dry.returncode, 0, dry.stderr)
            plan = json.loads(dry.stdout)
            self.assertEqual(plan["mode"], "dry-run")
            self.assertEqual(plan["candidateBytes"], sum(len(originals[path]) for path in paths[1:5]))
            self.assertEqual(set(plan["retained"]), {paths[0].name, *(path.name for path in paths[5:])})
            self.assertTrue(all(path.exists() for path in paths))
            with (root / "round.lock").open("rb") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                blocked = self.command(root, apply=True)
                self.assertEqual(blocked.returncode, 75, blocked.stderr)
                self.assertTrue(all(path.exists() for path in paths))
            applied = self.command(root, apply=True)
            self.assertEqual(applied.returncode, 0, applied.stderr)
            report = json.loads(applied.stdout)
            self.assertEqual(report["rawBytesRemoved"], plan["candidateBytes"])
            self.assertGreater(report["rawBytesRemoved"], report["gzipBytesAdded"])
            self.assertEqual(set(directory.glob("public-*.json")), {paths[0], *paths[5:]})
            for path in paths[1:5]:
                with gzip.open(path.with_suffix(".json.gz"), "rb") as source:
                    recovered = source.read()
                self.assertEqual(recovered, originals[path])
                self.assertEqual(hashlib.sha256(recovered).hexdigest(), path.stem.removeprefix("public-"))
            self.assertFalse(list(directory.glob("*.tmp")))
            self.assertEqual((directory / "latest.json").read_bytes(), receipt)
            self.assertEqual(evidence.read_bytes(), b"original source evidence")
            repeated = self.command(root, apply=True)
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            self.assertEqual(json.loads(repeated.stdout)["candidateBytes"], 0)
            self.assertEqual(json.loads(repeated.stdout)["rawBytesRemoved"], 0)

    def test_corruption_invalid_receipt_and_symlinks_preserve_raw_files(self):
        for mode in ["raw-sha", "gzip-sha", "gzip-truncated", "receipt-path", "receipt-sha", "receipt-bytes", "symlink"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(dir=CACHE, prefix="snapshot-archive-") as temporary:
                root = Path(temporary)
                directory, originals = self.fixture(root)
                paths = list(originals)
                if mode == "raw-sha":
                    paths[1].write_bytes(b"corrupt source")
                    os.utime(paths[1], (101, 101))
                elif mode == "gzip-sha":
                    paths[1].with_suffix(".json.gz").write_bytes(gzip.compress(b"conflicting snapshot"))
                elif mode == "gzip-truncated":
                    paths[1].with_suffix(".json.gz").write_bytes(gzip.compress(originals[paths[1]])[:12])
                elif mode == "symlink":
                    paths[1].with_suffix(".json.gz").symlink_to(paths[0])
                else:
                    receipt_file = directory / "latest.json"
                    receipt = json.loads(receipt_file.read_text())
                    if mode == "receipt-path":
                        receipt["snapshotFile"] = str(root / paths[0].name)
                    elif mode == "receipt-sha":
                        paths[0].write_bytes(b"corrupt current snapshot")
                    else:
                        receipt["bytes"] += 1
                    receipt_file.write_text(json.dumps(receipt))
                before = {path: path.read_bytes() for path in paths}
                result = self.command(root, apply=True)
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertEqual({path: path.read_bytes() for path in paths}, before)
                self.assertFalse(list(directory.glob("*.tmp")))


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    unittest.main()
