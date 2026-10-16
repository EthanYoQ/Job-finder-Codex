#!/usr/bin/env python3
"""Deterministically adapt pinned canonical connector-gate cores for fixed host.

The existing state machines remain the source of truth. Only the narrowly scoped
composition-root port gates, mode diagnostics, and terminal-integrity diagnostics
are transformed. This module performs no I/O on import or in render_shared_cores.
Its optional CLI reads canonical inputs and checks output hashes; it never writes
an artifact, launches a process, or selects a runtime deployment destination.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

INPUT_SHA256 = {
    "functions-bundle.js": "515672557c463d4a1ca0b96f4f911a843def575beb3846cd54dde3a518e91382",
    "dispatch-observer.functions.js": "5b1c87bdfc1d70a886bc3c0cab106270b44068b26fa7f852e98bd5a491c96f71",
}
OUTPUT_SHA256 = {
    "pipe-core.functions.js": "b061591fdc88a9211b35884e2e2bf55c636ddbf6ef5410668ec3b8c5f55dde6b",
    "observer-core.functions.js": "3c6d04db391ac05d4de3f15d9dcc59196d4a3985bbb80d67b34e850c7012f2d3",
}


class SharedCoreSourceError(ValueError):
    """An unreviewed input, transform shape, or generated result was rejected."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pinned_text(value: str | bytes, name: str) -> str:
    if isinstance(value, str):
        raw = value.encode("utf-8")
    elif isinstance(value, bytes):
        raw = value
    else:
        raise TypeError(f"SHARED_CORE_SOURCE_TYPE:{name}")
    if _sha256(raw) != INPUT_SHA256[name]:
        raise SharedCoreSourceError(f"SHARED_CORE_INPUT_SHA256:{name}")
    return raw.decode("utf-8", errors="strict")


def _replace_exact(source: str, old: str, new: str, *, count: int = 1) -> str:
    actual = source.count(old)
    if actual != count:
        raise SharedCoreSourceError(f"SHARED_CORE_TRANSFORM_COUNT:{count}:{actual}:{old}")
    return source.replace(old, new)


def _remove_suffix(source: str, suffix: str) -> str:
    if not source.endswith(suffix) or source.count(suffix) != 1:
        raise SharedCoreSourceError("SHARED_CORE_EXPORT_SUFFIX")
    return source[:-len(suffix)]


def _render_observer(source: str) -> str:
    source = _remove_suffix(source, "\nreturn Object.freeze({createDispatchObserver,restoreDispatchObserver,cloneEvidenceData,equalEvidenceData});\n")
    changes = (
        ("function createDispatchObserver({", "function createDispatchObserverCore({"),
        ("} = {}) {\n  const fixedRequest = copy(request);", "} = {}, internalLive = null) {\n  const fixedRequest = copy(request);"),
        ("const enabled = mode === 'TEST_ONLY' && !restored;", "const live = mode === 'LIVE' && internalLive?.key === PRIVATE_LIVE_CORE_KEY;\n  const selectedPort = live ? internalLive.port : testOnlyPort;\n  const enabled = (mode === 'TEST_ONLY' || live) && !restored;"),
        ("if (!['DISABLED', 'TEST_ONLY'].includes(mode))", "if (!['DISABLED', 'TEST_ONLY'].includes(mode) && !live)"),
        ("testOnlyPort?.kind !== TEST_PORT", "selectedPort?.kind !== (live ? 'CAPTURED_OFFICIAL_PORT' : TEST_PORT)"),
        ("typeof testOnlyPort[key]", "typeof selectedPort[key]"),
        ("completionVerified ? 'TEST_ONLY_VERIFIED' : stage", "completionVerified ? (live ? 'LIVE_VERIFIED' : 'TEST_ONLY_VERIFIED') : stage"),
        ("testOnlyCompletionVerified: completionVerified,", "testOnlyCompletionVerified: !live && completionVerified, liveCompletionVerified: live && completionVerified,"),
        ("stage = 'TEST_ONLY_VERIFIED';", "stage = live ? 'LIVE_VERIFIED' : 'TEST_ONLY_VERIFIED';"),
        ("grant.mode !== 'OFFLINE_REVIEW_ONLY'", "grant.mode !== (live ? 'OWNED_LIVE_REVIEW' : 'OFFLINE_REVIEW_ONLY')"),
        ("expected, testOnly: true", "expected, testOnly: !live"),
    )
    for old, new in changes:
        source = _replace_exact(source, old, new)
    for name in ("markIntent", "publish", "writeResponseOnce"):
        source = _replace_exact(source, f"const {name} = testOnlyPort?.{name};", f"const {name} = selectedPort?.{name};")
    return source + """
// Public legacy TEST API remains unable to choose LIVE, even with callbacks.
function createDispatchObserver(options={}) {
 if(options.mode!==undefined&&!['DISABLED','TEST_ONLY'].includes(options.mode))throw Error('PUBLIC_TEST_FACTORY_CANNOT_LIVE');
 return createDispatchObserverCore(options,null);
}
return Object.freeze({core:createDispatchObserverCore,publicTest:Object.freeze({createDispatchObserver,restoreDispatchObserver,cloneEvidenceData,equalEvidenceData})});
"""


def _render_pipe(source: str) -> str:
    source = _remove_suffix(source, "\nreturn {createOwnedSessionConsumer,validateLaunchSeed,validateLaunch,validateBinding,launchFromBinding,seedFromLaunch,gateMessage,validateGateMessage,validateOutcomeMessage,makeFrame,PREFIX};\n")
    changes = (
        ("function createOwnedSessionConsumer({launch,toolsPort,mode='DISABLED',clock=Date.now}){", "function createOwnedSessionConsumerCore({launch,toolsPort,mode='DISABLED',clock=Date.now},internalLive=null){\n const live=mode==='LIVE'&&internalLive?.key===PRIVATE_LIVE_CORE_KEY;\n const selectedPort=live?internalLive.port:toolsPort;"),
        ("launchTool=toolsPort?.launch,pollTool=toolsPort?.poll", "launchTool=selectedPort?.launch,pollTool=selectedPort?.poll"),
        ("held,sequence,dispatchAllowed:ready()", "held,sequence,pendingFrame:buffer.length>0,dispatchAllowed:ready()"),
        ("mode==='TEST_ONLY'&&toolsPort?.kind==='TRUSTED_SYNTHETIC_TOOL_PORT'", "(mode==='TEST_ONLY'&&selectedPort?.kind==='TRUSTED_SYNTHETIC_TOOL_PORT')||(live&&selectedPort?.kind==='CAPTURED_OFFICIAL_TOOL_PORT')"),
        ("toolExit=null,held=false,last=-Infinity;", "toolExit=null,held=false,integrityHeld=false,last=-Infinity;"),
        ("const now=()=>{const n=clock();require(Number.isSafeInteger(n)&&n>=last,'PIPE_CLOCK');last=n;return n;};", "const now=()=>{try{const n=clock();require(Number.isSafeInteger(n)&&n>=last,'PIPE_CLOCK');last=n;return n;}catch(e){integrityHeld=true;throw e;}};"),
        ("const fail=code=>{held=true;status='HOLD';throw Error(code);};", "const fail=code=>{held=true;integrityHeld=true;status='HOLD';throw Error(code);};"),
        ("const ready=()=>!!review&&!!expected&&buffer.length===0&&!consumed&&!held&&!childEnded&&!toolEnded&&now()<review.dispatchBefore;", "const ready=()=>{if(!review||!expected||buffer.length!==0||consumed||held||childEnded||toolEnded)return false;const before=now()<review.dispatchBefore;if(!before)integrityHeld=true;return before;};"),
        ("const snapshot=()=>Object.freeze({status,outerDeadline:l?.outerDeadline??null,reviewSeen:!!review,requestMatched:!!expected,outcomeSeen:!!outcome,outcomeMatched:!!expectedOutcome,outcomeConsumed,consumed,childEnded,toolEnded,childExit,childSignal,toolExit,held,sequence,pendingFrame:buffer.length>0,dispatchAllowed:ready()});", "// Diagnostic only: original held/dispatch gates remain authoritative.\n const snapshot=()=>{const dispatchAllowed=ready();return Object.freeze({status,outerDeadline:l?.outerDeadline??null,reviewSeen:!!review,requestMatched:!!expected,outcomeSeen:!!outcome,outcomeMatched:!!expectedOutcome,outcomeConsumed,consumed,childEnded,toolEnded,childExit,childSignal,toolExit,held,integrityHeld,sequence,pendingFrame:buffer.length>0,exactNaturalTerminal:childEnded&&toolEnded&&Number.isInteger(childExit)&&childExit>=0&&childExit===toolExit&&childSignal===null&&buffer.length===0&&!integrityHeld,dispatchAllowed});};"),
        ("require(l&&same(f.binding,l),'PIPE_LAUNCH_BINDING');held=true;status='HOLD';", "require(l&&same(f.binding,l),'PIPE_LAUNCH_BINDING');held=true;integrityHeld=true;status='HOLD';"),
        ("if(childExit!==0||childSignal!==null)held=true;", "if(childExit!==0||childSignal!==null)held=true;if(childSignal!==null||!Number.isInteger(childExit)||childExit<0)integrityHeld=true;"),
        ("if(!childEnded||buffer.length||toolExit!==0)held=true;", "if(!childEnded||buffer.length||toolExit!==0)held=true;if(!childEnded||buffer.length||toolExit<0||toolExit!==childExit)integrityHeld=true;"),
        ("if(l&&now()>=l.outerDeadline){held=true;status='HOLD';}", "if(l&&now()>=l.outerDeadline){held=true;integrityHeld=true;status='HOLD';}"),
    )
    for old, new in changes:
        source = _replace_exact(source, old, new)
    source = _replace_exact(source, "catch(e){held=true;status='HOLD';throw e;}", "catch(e){held=true;integrityHeld=true;status='HOLD';throw e;}", count=4)
    return source + """
function createOwnedSessionConsumer(options){
 if(options?.mode!==undefined&&!['DISABLED','TEST_ONLY'].includes(options.mode))throw Error('PUBLIC_TEST_FACTORY_CANNOT_LIVE');
 return createOwnedSessionConsumerCore(options,null);
}
return Object.freeze({core:createOwnedSessionConsumerCore,publicTest:Object.freeze({createOwnedSessionConsumer,validateLaunchSeed,validateLaunch,validateBinding,launchFromBinding,seedFromLaunch,gateMessage,validateGateMessage,validateOutcomeMessage,makeFrame,PREFIX})});
"""


def render_shared_cores(pipe: str | bytes, observer: str | bytes) -> dict[str, str]:
    """Render exact reviewed UTF-8 outputs from exact canonical source bytes.

    Keys are output basenames only. The caller owns all output destinations.
    Both inputs are checked before either transform begins, and both outputs
    must match their reviewed hashes before any result is returned.
    """
    pipe_text = _pinned_text(pipe, "functions-bundle.js")
    observer_text = _pinned_text(observer, "dispatch-observer.functions.js")
    outputs = {
        "pipe-core.functions.js": _render_pipe(pipe_text),
        "observer-core.functions.js": _render_observer(observer_text),
    }
    for name, source in outputs.items():
        if _sha256(source.encode("utf-8")) != OUTPUT_SHA256[name]:
            raise SharedCoreSourceError(f"SHARED_CORE_OUTPUT_SHA256:{name}")
    return outputs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[4], help="Canonical repository root; inputs are read only")
    parser.add_argument("--check", action="store_true", help="Check deterministic output hashes without writing files (the only CLI mode)")
    args = parser.parse_args(argv)
    gate = args.repo_root / "tools" / "dot-auto-controller" / "connector-gate"
    outputs = render_shared_cores((gate / "viatris-functions-bundle.js").read_bytes(), (gate / "dispatch-observer.functions.js").read_bytes())
    print(json.dumps({"status": "SHARED_CORES_CHECKED", "writes": 0, "inputs": dict(INPUT_SHA256), "outputs": {name: {"sha256": _sha256(source.encode("utf-8")), "bytes": len(source.encode("utf-8"))} for name, source in outputs.items()}}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
