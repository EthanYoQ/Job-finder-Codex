#!/usr/bin/env python3
"""Observe an existing PID and descendants without signalling or changing them.

Must be launched in the SAME exec session/PID namespace as the target. No
network, credentials, product-file writes, process injection, or target signals.
Command lines are checked only for the explicitly supplied root PID, never saved.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import signal
import time


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def stat(pid):
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        end = raw.rfind(")")
        fields = raw[end + 2:].split()
        return {"pid": pid, "comm": raw[raw.find("(") + 1:end],
                "state": fields[0], "ppid": int(fields[1]),
                "startTicks": int(fields[19])}
    except (OSError, ValueError, IndexError):
        return None


def kv(path, wanted):
    values = {}
    for line in Path(path).read_text().splitlines():
        key, _, val = line.partition(":")
        if key in wanted:
            values[key] = int(val.strip().split()[0])
    return values


def atomic(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def next_deadline(previous_deadline, now, interval):
    """Skip missed slots rather than burst-read /proc to catch up after a pause."""
    planned = previous_deadline + interval
    return now + interval if planned <= now else planned


def verify_startup_identity(pid, expected_arg):
    """Allow only a bounded exec transition of the supplied, unchanged PID."""
    root = stat(pid)
    if root is None or root["state"] == "Z":
        raise RuntimeError("Root PID is absent or already exited in this PID namespace")
    root_key = (root["pid"], root["startTicks"])
    deadline = time.monotonic() + 1.0
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Root argv identity check timed out; refusing to sample unrelated PID")
        before = stat(pid)
        if before is None or before["state"] == "Z" or (before["pid"], before["startTicks"]) != root_key:
            raise RuntimeError("Root identity changed before exact argv verification")
        try:
            argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        except OSError as e:
            raise RuntimeError(f"Cannot verify root identity: {type(e).__name__}") from e
        after = stat(pid)
        if after is None or after["state"] == "Z" or (after["pid"], after["startTicks"]) != root_key:
            raise RuntimeError("Root identity changed during exact argv verification")
        if time.monotonic() >= deadline:
            raise RuntimeError("Root argv identity check timed out; refusing to sample unrelated PID")
        if os.fsencode(expected_arg) in argv:
            return after
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("Root argv identity check failed within 1 second; refusing to sample unrelated PID")
        time.sleep(min(0.025, remaining))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root-pid", type=int, required=True)
    p.add_argument("--expected-arg", required=True,
                   help="Exact argv token of expected root wrapper script; not logged")
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--interval", type=float, default=1.0)
    p.add_argument("--pss-interval", type=float, default=5.0)
    a = p.parse_args()
    if a.interval < 0.2 or a.pss_interval < a.interval:
        p.error("Use interval >= 0.2 seconds and PSS interval >= RSS interval")
    a.output_dir.mkdir(parents=True, exist_ok=True)
    sample_path = a.output_dir / "samples.jsonl"
    if sample_path.exists():
        p.error("Refusing to overwrite prior samples; use a unique output directory")
    try:
        root = verify_startup_identity(a.root_pid, a.expected_arg)
    except RuntimeError as e:
        p.error(str(e))
    root_key = (root["pid"], root["startTicks"])
    started_at, started = utc(), time.monotonic()
    interrupted = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda n, _: interrupted.append(n))
    tracked = {}
    peak_rss = None
    peak_pss = None
    host_peak = None
    sample_count = pss_complete_count = 0
    previous_sample = None
    max_gap = max_span = 0.0
    observer_peak = 0
    next_pss = next_summary = started
    next_sample = started
    cgroup_same = None
    try:
        cgroup_same = Path(f"/proc/{a.root_pid}/cgroup").read_text() == Path("/proc/self/cgroup").read_text()
    except OSError:
        pass
    base = {"schemaVersion": 1, "label": a.label, "startedAt": started_at,
            "root": root, "samplerPid": os.getpid(), "rssIntervalSeconds": a.interval,
            "pssIntervalSeconds": a.pss_interval,
            "rootIdentityVerifiedByExactArg": True,
            "rootAndSamplerCgroupTextEqual": cgroup_same,
            "sysCgroupExposed": Path("/sys/fs/cgroup").exists(),
            "scope": "Verified root PID and observed descendants, retaining known live orphans; sampler excluded",
            "limitations": ["Sampled peak is a lower bound; intervals may miss short spikes and processes",
                            "No coverage before the first sample or after process disappearance",
                            "RSS tree sum can double-count shared pages; PSS is sampled separately",
                            "Sequential process reads are near-simultaneous, not an atomic snapshot",
                            "VmHWM is per-process lifetime high-water; never summed across processes",
                            "Independent browser/services outside the PID tree are not attributed",
                            "Visible meminfo is shared-environment reference, not Jb usage"]}
    atomic(a.output_dir / "metadata.json", base)

    def summary(status):
        return {**base, "status": status, "updatedAt": utc(),
                "elapsedSeconds": round(time.monotonic() - started, 3),
                "sampleCount": sample_count, "completePssSampleCount": pss_complete_count,
                "maxActualSampleGapSeconds": round(max_gap, 6),
                "maxSampleSpanMilliseconds": round(max_span * 1000, 3),
                "treeRssPeak": peak_rss, "treePssPeak": peak_pss,
                "sharedEnvironmentUsedEstimatePeak": host_peak,
                "samplerOwnPeakRssKiB": observer_peak,
                "processLifetimes": list(tracked.values()),
                "interruptSignalsReceivedBySamplerOnly": interrupted}

    with sample_path.open("x", buffering=1) as out:
        while not interrupted:
            now, sampled_at = time.monotonic(), utc()
            if previous_sample is not None:
                max_gap = max(max_gap, now - previous_sample)
            previous_sample = now
            proc = {}
            for entry in Path("/proc").iterdir():
                if entry.name.isdigit():
                    s = stat(int(entry.name))
                    if s is not None:
                        proc[s["pid"]] = s
            alive = {pid for (pid, tick), info in tracked.items()
                     if pid in proc and proc[pid]["startTicks"] == tick and proc[pid]["state"] != "Z"}
            if a.root_pid in proc and (a.root_pid, proc[a.root_pid]["startTicks"]) == root_key and proc[a.root_pid]["state"] != "Z":
                alive.add(a.root_pid)
            changed = True
            while changed:
                children = {pid for pid, s in proc.items() if s["ppid"] in alive and s["state"] != "Z"}
                new = children - alive
                alive.update(new)
                changed = bool(new)
            alive.discard(os.getpid())
            do_pss = now >= next_pss
            if do_pss:
                next_pss = now + a.pss_interval
            rows = []
            errors = []
            for pid in sorted(alive):
                s = proc[pid]
                key = (pid, s["startTicks"])
                info = tracked.setdefault(key, {**s, "firstObservedAt": sampled_at,
                    "lastObservedAt": sampled_at, "exitDetectedAt": None,
                    "maxObservedVmHWMKiB": None, "maxSampledRssKiB": None})
                info["lastObservedAt"] = sampled_at
                row = {**s}
                try:
                    values = kv(f"/proc/{pid}/status", {"VmRSS", "VmHWM", "RssAnon", "RssFile", "RssShmem", "VmSwap"})
                    # Verify PID/start time again to avoid mixing a reused PID.
                    s2 = stat(pid)
                    if s2 is None or s2["startTicks"] != s["startTicks"]:
                        raise ProcessLookupError()
                    row.update({k + "KiB": v for k, v in values.items()})
                    for field, source in [("maxObservedVmHWMKiB", "VmHWM"), ("maxSampledRssKiB", "VmRSS")]:
                        if source in values:
                            info[field] = max(info[field] or 0, values[source])
                except (OSError, ValueError) as e:
                    errors.append({"pid": pid, "read": "status", "error": type(e).__name__})
                if do_pss:
                    try:
                        values = kv(f"/proc/{pid}/smaps_rollup", {"Pss", "Private_Clean", "Private_Dirty", "SwapPss"})
                        s2 = stat(pid)
                        if s2 is None or s2["startTicks"] != s["startTicks"]:
                            raise ProcessLookupError()
                        row.update({k + "KiB": v for k, v in values.items()})
                    except (OSError, ValueError) as e:
                        errors.append({"pid": pid, "read": "smaps_rollup", "error": type(e).__name__})
                rows.append(row)
            for (pid, tick), info in tracked.items():
                if (pid not in proc or proc[pid]["startTicks"] != tick or proc[pid]["state"] == "Z") and info["exitDetectedAt"] is None:
                    info["exitDetectedAt"] = sampled_at
            rss_complete = bool(rows) and all("VmRSSKiB" in x for x in rows)
            pss_complete = do_pss and bool(rows) and all("PssKiB" in x for x in rows)
            rss_total = sum(x.get("VmRSSKiB", 0) for x in rows)
            pss_total = sum(x.get("PssKiB", 0) for x in rows) if do_pss else None
            peak_base = {"sampledAt": sampled_at, "pids": sorted(alive), "processCount": len(rows)}
            if rss_complete and (peak_rss is None or rss_total > peak_rss["KiB"]):
                peak_rss = {**peak_base, "KiB": rss_total}
            if pss_complete:
                pss_complete_count += 1
                if peak_pss is None or pss_total > peak_pss["KiB"]:
                    peak_pss = {**peak_base, "KiB": pss_total}
            host = None
            if do_pss:
                try:
                    host = kv("/proc/meminfo", {"MemTotal", "MemAvailable", "MemFree", "Cached", "Buffers", "SwapTotal", "SwapFree"})
                    used = host["MemTotal"] - host["MemAvailable"]
                    host["UsedEstimateKiB"] = used
                    if host_peak is None or used > host_peak["KiB"]:
                        host_peak = {"sampledAt": sampled_at, "KiB": used, "MemTotalKiB": host["MemTotal"]}
                except (OSError, ValueError, KeyError) as e:
                    errors.append({"read": "meminfo", "error": type(e).__name__})
            try:
                observer_rss = kv("/proc/self/status", {"VmRSS"}).get("VmRSS")
                observer_peak = max(observer_peak, observer_rss or 0)
            except (OSError, ValueError):
                observer_rss = None
            span = time.monotonic() - now
            max_span = max(max_span, span)
            sample_count += 1
            out.write(json.dumps({"sampledAt": sampled_at, "elapsedSeconds": round(now-started, 6),
                "sampleSpanMilliseconds": round(span*1000, 3), "processes": rows,
                "treeRssKiB": rss_total, "rssCompleteForObservedTree": rss_complete,
                "treePssKiB": pss_total, "pssCompleteForObservedTree": pss_complete,
                "sharedEnvironmentMeminfoKiB": host, "samplerOwnRssKiB": observer_rss,
                "errors": errors}, ensure_ascii=False) + "\n")
            if not alive:
                atomic(a.output_dir / "summary.json", summary("TARGET_TREE_EXITED"))
                return
            if now >= next_summary:
                atomic(a.output_dir / "summary.json", summary("RUNNING"))
                next_summary = now + 10
            next_sample = next_deadline(next_sample, time.monotonic(), a.interval)
            time.sleep(max(0, next_sample-time.monotonic()))
        atomic(a.output_dir / "summary.json", summary("SAMPLER_INTERRUPTED_TARGET_UNCHANGED"))


if __name__ == "__main__":
    main()
