import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("export-public-trends.py")
CACHE = SCRIPT.parent.parent / ".runtime" / ".cache"


class PublicTrendsTest(unittest.TestCase):
    def snapshots(self, root):
        def source(source_id, state, observed_at, job_fields):
            result = f"result-{source_id}" if state == "PUBLISHING" else None
            jobs = [{"id": f"{source_id}-{index}", "sourceId": source_id,
                     "companyId": "company", "sourceResultId": result,
                     "category": "销售", "city": "北京", "cities": ["北京"], **fields}
                    for index, fields in enumerate(job_fields)]
            return {"sourceId": source_id, "companyId": "company", "state": state,
                    "currentConfigSha256": "a" * 64, "selectedSourceResultId": result,
                    "lastSuccessAt": observed_at, "freshness": "FRESH" if observed_at else "UNKNOWN",
                    "visibleJobCount": len(jobs) if result else None, "jobs": jobs}

        captured_at = "2026-11-14T16:01:00Z"
        snapshot = {
            "schemaVersion": "portable-public-snapshot-v1", "generatedAt": captured_at,
            "totalJobs": 4, "companies": [{"id": "company", "companyName": "示例药企"}],
            "sources": [
                source("current", "PUBLISHING", captured_at, [
                    {"inGrace": False, "cities": ["北京", "上海", "上海"]},
                    {"inGrace": True, "cities": ["城市待核", "北京"]},
                    {"inGrace": False, "city": "全国", "cities": ["全国"]},
                ]),
                source("carried", "PUBLISHING", "2026-11-14T16:00:59Z", [{"inGrace": False}]),
                source("zero", "PUBLISHING", captured_at, []),
                source("hold", "HOLD", None, []),
            ],
        }
        data = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
        sha = hashlib.sha256(data).hexdigest()
        raw = root / f"public-{sha}.json"
        compressed = raw.with_suffix(".json.gz")
        raw.write_bytes(data)
        compressed.write_bytes(gzip.compress(data))
        return raw, compressed, sha

    def command(self, *inputs):
        args = [sys.executable, str(SCRIPT)]
        for day, path in inputs:
            args.extend(["--snapshot", day, str(path)])
        return subprocess.run(args, capture_output=True, encoding="utf-8", check=False)

    def test_dated_plain_and_gzip_observations(self):
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=CACHE, prefix="public-trends-") as temporary:
            raw, compressed, sha = self.snapshots(Path(temporary))
            result = self.command(("2026-11-16", compressed), ("2026-11-15", raw))
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = list(csv.DictReader(io.StringIO(result.stdout)))
        self.assertEqual({row["snapshot_sha256"] for row in rows}, {sha})
        self.assertEqual({row["company_name"] for row in rows}, {"示例药企"})
        counts = {(r["date"], r["source_id"], r["job_observation"], r["category"], r["city"]): r["job_count"]
                  for r in rows}
        self.assertEqual(counts["2026-11-15", "current", "CURRENT", "", ""], "2")
        self.assertEqual(counts["2026-11-15", "current", "CURRENT", "销售", "上海"], "1")
        self.assertEqual(counts["2026-11-15", "current", "CURRENT", "销售", "全国"], "1")
        self.assertEqual(counts["2026-11-15", "current", "GRACE", "销售", "城市待核"], "1")
        self.assertNotIn(("2026-11-15", "current", "GRACE", "销售", "北京"), counts)
        self.assertEqual(counts["2026-11-15", "carried", "CARRIED", "", ""], "1")
        self.assertEqual(counts["2026-11-15", "zero", "CURRENT", "", ""], "0")
        self.assertEqual(counts["2026-11-15", "hold", "UNKNOWN", "", ""], "")
        self.assertEqual(counts["2026-11-16", "current", "CARRIED", "", ""], "2")
        self.assertEqual(counts["2026-11-16", "current", "GRACE", "", ""], "1")

    def test_wrong_uncompressed_hash_yields_no_partial_csv(self):
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=CACHE, prefix="public-trends-") as temporary:
            raw, compressed, _ = self.snapshots(Path(temporary))
            compressed.write_bytes(gzip.compress(b'{"changed": true}'))
            result = self.command(("2026-11-15", raw), ("2026-11-16", compressed))
        self.assertEqual(result.returncode, 1)
        self.assertIn("Snapshot SHA-256 mismatch", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
