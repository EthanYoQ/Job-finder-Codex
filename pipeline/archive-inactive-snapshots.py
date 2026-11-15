#!/usr/bin/env python3
"""Cold-archive collector snapshots while publisher maintenance coordination is held.

Dry-run by default. Before --apply, the operator must coordinate the publisher
and any direct collectors. This script only acquires the collector's round.lock;
it cannot acquire or verify the publisher lock on another machine. Recover a
cold snapshot with: gzip -dk public-<sha256>.json.gz
"""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys


SNAPSHOT = re.compile(r"public-([a-f0-9]{64})\.json(?:\.gz(?:\.tmp)?)?")


def regular_file(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Not a regular file: {path}")


def digest(path, compressed=False):
    regular_file(path)
    total = 0
    sha = hashlib.sha256()
    with (gzip.open(path, "rb") if compressed else path.open("rb")) as source:
        while chunk := source.read(1024 * 1024):
            sha.update(chunk)
            total += len(chunk)
    return sha.hexdigest(), total


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def archive(state_root, apply=False):
    root = Path(os.path.abspath(state_root))
    directory = root / "snapshots"
    for path in [root, *root.parents, directory]:
        if path.is_symlink() or not path.is_dir():
            raise ValueError(f"Not a real directory: {path}")
    lock = root / "round.lock"
    regular_file(lock)
    with lock.open("rb") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        files = list(directory.iterdir())
        for path in files:
            if path.is_symlink():
                raise ValueError(f"Symlink refused: {path}")
            if SNAPSHOT.fullmatch(path.name):
                regular_file(path)

        receipt_file = directory / "latest.json"
        regular_file(receipt_file)
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        sha = receipt.get("sha256") if isinstance(receipt, dict) else None
        if (not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha)
                or receipt.get("status") != "SNAPSHOT_SAVED"
                or type(receipt.get("bytes")) is not int
                or type(receipt.get("complete")) is not bool):
            raise ValueError("Invalid latest.json receipt")
        current = directory / f"public-{sha}.json"
        if receipt.get("snapshotFile") != str(current) or digest(current) != (sha, receipt["bytes"]):
            raise ValueError("Latest snapshot does not match its receipt")

        raw = [path for path in files if SNAPSHOT.fullmatch(path.name) and path.suffix == ".json"]
        newest = sorted((path for path in raw if path != current),
                        key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)
        retained = [current, *newest[:4]]
        candidates = newest[4:]
        sizes = {}
        for path in candidates:
            expected = SNAPSHOT.fullmatch(path.name).group(1)
            actual, sizes[path] = digest(path)
            if actual != expected:
                raise ValueError(f"Snapshot filename SHA mismatch: {path}")
            cold = path.with_suffix(".json.gz")
            if cold.exists() and digest(cold, compressed=True) != (expected, sizes[path]):
                raise ValueError(f"Conflicting gzip companion: {cold}")

        report = {"mode": "apply" if apply else "dry-run", "current": current.name,
                  "retained": [path.name for path in retained],
                  "candidates": [{"file": path.name, "bytes": sizes[path]} for path in candidates],
                  "candidateBytes": sum(sizes.values()), "rawBytesRemoved": 0, "gzipBytesAdded": 0}
        if not apply:
            return report

        for path in candidates:
            expected = SNAPSHOT.fullmatch(path.name).group(1)
            cold = path.with_suffix(".json.gz")
            temporary = path.with_suffix(".json.gz.tmp")
            if not cold.exists():
                if temporary.exists():
                    regular_file(temporary)
                    temporary.unlink()
                with temporary.open("xb") as target:
                    os.chmod(temporary, 0o600)
                    with path.open("rb") as source, gzip.GzipFile(fileobj=target, mode="wb", filename="", mtime=0) as zipped:
                        shutil.copyfileobj(source, zipped, length=1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                if digest(temporary, compressed=True) != (expected, sizes[path]):
                    raise ValueError(f"Compressed snapshot SHA mismatch: {path}")
                os.link(temporary, cold, follow_symlinks=False)
                report["gzipBytesAdded"] += cold.stat().st_size
            if digest(cold, compressed=True) != (expected, sizes[path]) or digest(path) != (expected, sizes[path]):
                raise ValueError(f"Snapshot changed before removal: {path}")
            with cold.open("rb") as saved:
                os.fsync(saved.fileno())
            sync_directory(directory)
            if temporary.exists():
                regular_file(temporary)
                temporary.unlink()
            path.unlink()
            sync_directory(directory)
            report["rawBytesRemoved"] += sizes[path]
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-root", default="/data/job-finder")
    parser.add_argument("--apply", action="store_true",
                        help="Apply only while external publisher/collector maintenance coordination is held")
    args = parser.parse_args()
    try:
        print(json.dumps(archive(args.state_root, args.apply), indent=2))
    except BlockingIOError:
        print("ROUND_LOCK_BUSY", file=sys.stderr)
        return 75
    except (OSError, ValueError, EOFError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
