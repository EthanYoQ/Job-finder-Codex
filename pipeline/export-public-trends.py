#!/usr/bin/env python3
"""Export archived public job observations as CSV, one chosen snapshot per Beijing date.

Use --snapshot DATE PATH for each date. Give the date of the 00:01 Beijing
collection window, including when its receipt reused older snapshot bytes.
Use snapshots from a trusted archive. Categories and cities come from the
stored job rows. A blank category or city identifies a subtotal. A multi-city
job counts once in each of its city rows. A blank count means the source had
no verified projection.
"""

import argparse
from collections import Counter
import csv
from datetime import date, datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import zlib


BEIJING = timezone(timedelta(hours=8))
SNAPSHOT_NAME = re.compile(r"public-([a-f0-9]{64})\.json(?:\.gz)?")
HEADER = (
    "date", "snapshot_sha256", "snapshot_generated_at", "company_id", "company_name",
    "source_id", "current_source_config_sha256", "source_result_id", "source_state",
    "source_freshness", "last_source_observed_at",
    "source_observation", "job_observation", "category", "city", "job_count",
)


def slot_date(value):
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError(f"Timestamp requires a UTC offset: {value}")
    return (timestamp.astimezone(BEIJING) - timedelta(minutes=1)).date()


def read_snapshot(path):
    match = SNAPSHOT_NAME.fullmatch(path.name)
    if not match:
        raise ValueError(f"Expected public-<sha256>.json or .json.gz: {path}")
    with (gzip.open(path, "rb") if path.suffix == ".gz" else path.open("rb")) as handle:
        body = handle.read()
    sha = hashlib.sha256(body).hexdigest()
    if sha != match[1]:
        raise ValueError(f"Snapshot SHA-256 mismatch: {path}")
    snapshot = json.loads(body.decode("utf-8"))
    if snapshot["schemaVersion"] != "portable-public-snapshot-v1":
        raise ValueError(f"Unsupported snapshot schema: {path}")
    return sha, snapshot


def export_rows(day, path):
    sha, snapshot = read_snapshot(path)
    generated_at = snapshot["generatedAt"]
    if slot_date(generated_at) > day:
        raise ValueError(f"Snapshot was generated after the reporting date: {path}")
    companies = {company["id"]: company["companyName"] for company in snapshot["companies"]}
    source_ids = set()
    job_ids = set()
    for source in sorted(snapshot["sources"], key=lambda item: item["sourceId"]):
        source_id, company_id = source["sourceId"], source["companyId"]
        state, result_id = source["state"], source["selectedSourceResultId"]
        jobs, visible_count = source["jobs"], source["visibleJobCount"]
        if source_id in source_ids:
            raise ValueError(f"Duplicate source: {source_id}")
        source_ids.add(source_id)
        observed_at = source["lastSuccessAt"]
        observation = "UNKNOWN"
        if state == "PUBLISHING" and observed_at:
            observed_day = slot_date(observed_at)
            if observed_day > day:
                raise ValueError(f"Source observation follows the reporting date: {source_id}")
            observation = "CURRENT" if observed_day == day else "CARRIED"
        prefix = (day, sha, generated_at, company_id, companies[company_id], source_id,
                  source["currentConfigSha256"], result_id, state, source["freshness"],
                  observed_at, observation)
        if not isinstance(jobs, list):
            raise ValueError(f"Expected a source job list: {source_id}")
        if state in {"HOLD", "EXCLUDED"} and not jobs and visible_count is None:
            yield (*prefix, "UNKNOWN", "", "", None)
            continue
        if state != "PUBLISHING" or not result_id or type(visible_count) is not int or visible_count != len(jobs):
            raise ValueError(f"Inconsistent public projection: {source_id}")
        if not jobs:
            yield (*prefix, observation, "", "", 0)
            continue

        counts = Counter()
        for job in jobs:
            job_id = job["id"]
            if (job["companyId"], job["sourceId"], job["sourceResultId"]) != (company_id, source_id, result_id):
                raise ValueError(f"Job does not belong to the selected source result: {job_id}")
            if job_id in job_ids:
                raise ValueError(f"Duplicate public job: {job_id}")
            job_ids.add(job_id)
            grace = job.get("inGrace")
            if grace is not None and type(grace) is not bool:
                raise ValueError(f"Invalid grace status: {job_id}")
            job_observation = observation
            if grace is None:
                job_observation = "UNKNOWN"
            elif grace:
                job_observation = "GRACE"
            category = job["category"].strip() or "未知"
            if not isinstance(job["cities"], list):
                raise ValueError(f"Expected a job city list: {job_id}")
            cities = {city.strip() for city in job["cities"] if city.strip()}
            if job.get("cityPending") or "城市待核" in cities:
                cities = {"城市待核"}
            if not cities:
                cities = {job["city"].strip() or "城市待核"}
            counts[job_observation, "", ""] += 1
            counts[job_observation, category, ""] += 1
            for city in cities:
                counts[job_observation, "", city] += 1
                counts[job_observation, category, city] += 1
        for (status, category, city), count in sorted(counts.items()):
            yield (*prefix, status, category, city, count)
    if len(job_ids) != snapshot["totalJobs"]:
        raise ValueError(f"Snapshot total does not match distinct source jobs: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", action="append", nargs=2, required=True, metavar=("DATE", "PATH"))
    args = parser.parse_args()
    try:
        inputs = [(date.fromisoformat(day), Path(path)) for day, path in args.snapshot]
        if len({day for day, _ in inputs}) != len(inputs):
            raise ValueError("Specify one snapshot per reporting date")
        rows = [row for day, path in sorted(inputs) for row in export_rows(day, path)]
    except (KeyError, TypeError, ValueError, OSError, EOFError, zlib.error) as error:
        print(f"Public trends export failed: {error}", file=sys.stderr)
        return 1

    sys.stdout.reconfigure(encoding="utf-8", newline="")
    writer = csv.writer(sys.stdout)
    writer.writerow(HEADER)
    writer.writerows(rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
