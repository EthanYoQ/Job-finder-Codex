# Public UI verification: inactive offline candidate

This directory is an independent, additive candidate against actual repository HEAD
`d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f`. It was not applied to that checkout,
connected to production, uploaded, or published. A fixed CUA port and actual AX decoder are included but disabled by default.
There is no database, credential, scheduler, hidden reader, or detail/application implementation.
The default browser port is unbound. Parent independent review is required before
binding any real tool. This candidate is not end-to-end or unattended qualification.

## Scope

One fixed mapping is supported: `source-takeda-china-social` →
`company-takeda-china` / 武田中国 on `https://job.orz.md/`, with the observed official
entry `https://jobs.takeda.com/location/china-jobs/1113/1814991/2`. The mapping is
in source, not caller-selected arbitrary URLs. More sources require separately
reviewed mappings and flows. Source IDs are routing identity, not a claim that the
UI visibly prints that database identifier. The binder must substantiate the
company with the observed company control/container or directory card.

The only passing assertion is `PASS_LIST_AND_SOURCE_TIME_ONLY`: every public ID,
anchor-derived original title, actual rendered original-title paragraph, and
original official URL matches bidirectionally; expected removals are absent;
the same company's own directory card shows the expected UTC minute. There is
no normalization of titles/URLs to make mismatches disappear. Order is irrelevant.
The rendered original title is required separately from the anchor's accessible
label, which can differ from the visible heading's auxiliary city label.

`detailVerification` is always `UNKNOWN`; application is `NOT_TESTED`; other
sources, multiday stability, native transaction, process termination, recovery,
and publication qualification are not asserted. `releaseEligible` and
`newBatchAllowed` remain false even on a UI pass.

## Fixed state machine

1. Normally open the fixed home URL.
2. If needed, reuse the previously authorized existing consent flow. Observe the
   checkbox, click it once, freshly observe the enabled entry button, enter, and
   observe again. Already accepted is a separate normal case. Material new terms,
   denial, unrecognized flow, changed visible wording/version/links, or unknown
   structure stop the run. No cookie injection, invisible acceptance, or new
   blanket consent is supported. Existing authorization does not require a new
   full legal-document hash or a new user confirmation on every normal run.
3. Expand the visible Takeda company control. Use the observed normal View all
   control only when visible; observe all jobs, then extract the approved public
   fields from the rendered list. No pagination or detail navigation is inferred.
4. Open the actual Official Recruitment Directory control, apply its existing
   company search, and read the one matching company's source-level time.
5. If, and only if, all current rows already match and the extras are exactly the
   known expected removed IDs, one ordinary reload is permitted. The old set is
   never a pass. Repeat the same approved consent/list/directory flow, then require
   an exact list. Any other mismatch stops without speculative reload/clicks.

The source minute must match before and after that reload. A stale/missing/unknown
source minute stops; there is no invented retry to fix it. The history explicitly
retains the directory's already-current time before reload. It never attributes
that time to reload, or diagnoses a cache layer. A visible UTC label is required;
server/runtime timezone is not browser timezone evidence. The comparison proves
only the displayed minute, never database seconds/milliseconds.

Each tool step has a 15-second budget, the full run 120 seconds, at most 40 steps,
at most 2 observation-only loading waits per stage and 8 total, and at most one
reload. The host must honor the same or tighter deadline without hidden retries.
Each step also checks its absolute deadline after settlement; a delayed timer
cannot allow a 15-second-or-later result to advance the state machine.
`WAIT_VISIBLE` is only a bounded fresh visible-state observation; it cannot click,
reload, navigate, call an API, or re-enter consent. Empty READY data never passes.
Unexpected conditions fail closed. Non-timeout exceptions propagate unchanged.

## Browser port and actual functions host

Core and adapter modules use ordinary JavaScript only. `functions-bundle.js` is deterministically
generated from them, with no imports. The actual functions isolate was checked:
URL, performance, and structuredClone globals are absent. The bundle uses fixed
URL grammar, JSON-safe public facts, and real Date timestamps. A backwards clock
jump or impossible observation interval holds; deadlines are never extended.

A future parent-reviewed single functions invocation can include the verified bundle
expression in its source, define a fixed `port.execute(request)` adapter closing
over its existing tool capability, and do:

    const controller = publicVerification.createPublicVerifier({ expected, port });
    const outcome = await controller.run();

The host must retain `controller`, `controller.pendingOperation`, and port.originalToolOperation, port.toolReceipts, and its original
invocation until any in-flight tool settlement is accounted for. Keep the original
Promise identity. A timeout is UNKNOWN, not cancellation: no second call, reload,
resume, or replacement tab is authorized after it. The journal records late public
observations or late exceptions without resuming. `controller.lateError` preserves
the original late error; regular errors reject run unchanged. The result
reports a protocol timeout as UNKNOWN even if the port's own
Promise already rejected; absence of a pending Promise is not a known UI outcome.
The convenience `runPublicVerification` rejects real-port use to prevent discarding that observer.

The actual available tool boundary is `tools.mcp__cua_repl__js({code, timeout_ms,
title})`, called from functions. Its `code` must be selected by a closed switch on
the fixed action enum. The already approved CUA methods are listed in
`UI_BINDING.md`. The fixed tool-call builder, strict one-text JSON envelope parser, fresh AX
resolver, actual observed AX grammar decoder, rendered-title bijection, and source
card parser are implemented in cua-port.mjs and actual-ax.mjs. A separately
authorized bounded public shape sample established their grammar; the adapter
itself has not been run end-to-end against production. Unknown wrappers/roles/
views hold; there is no generic string/URL execution parameter. See ADAPTER_STATUS.md. No step needs the language model to pick a page when that adapter is
implemented and independently reviewed. A Node child cannot import this hosted
tool capability. This is a single-invocation contract, not a persistent service or
cron registration contract.

The port descriptor must be `{enabled:true, kind:'REVIEWED_PUBLIC_UI',
targetKey:'takeda-china', execute}`. `execute` returns a Promise of the strict
public observation in `contract.mjs`, after the actual action. Missing/extra fields
are rejected. Do not copy request constants into observed UI evidence. A fresh
observedAt is measured at observation, distinct from each host start/finish time
and from the displayed source minute. No fabricated browser timestamps, raw DOM,
screenshots, tab/session locator, credential, full tool response, or error body is
allowed in the journal. Rejected inputs retain only bounded allowlisted facts.

## Expected input

The host should receive the already reviewed public expectation from the same
publication gate. Project only batchId, sourceId, fixed companyId, observedAt,
the hash of the exact expectation artifact, jobs (sourceJobId/officialTitle/
officialUrl), and removedIds. Copy currentJobs to jobs and removedFromVisible IDs
to removedIds. Authenticate this association and hash at the host boundary before
running. The UI comparator itself does not claim the database has committed merely
because an expected artifact exists, and it does not grant publication authority.

The historical actual expected artifact hash is
`99c6255eedec310d6bf58e0d62122b0bfcb2ec58d54d7272904e25e0e3171939`.
All executable test UI states are synthetic; this digest is provenance, not a
reusable production batch or a way to accept synthetic observations as live.

## Offline validation

No dependencies/install required. With the reviewed Node 22.23.3:

    node scripts/build-functions-bundle.mjs
    node --require ./test/no-network.cjs --test --test-concurrency=1 test/*.test.mjs

The network-denial preload was copied from the existing runtime validation guard.
Tests call no tool, browser, network, or database module. They include current,
119→116 with directory already current, stale after reload, duplicate/missing/extra
IDs, title/URL/rendered-title mismatch, wrong source/domain/company, source/global
time separation, UTC/precision failures, loading/empty/errors/denials, same consent/
changed consent/unknown consent, clock jumps, pending timeout, late response/error,
no second reload, and default disabled. The actual functions isolate smoke is also
synthetic, with zero browser tool calls. These checks do not substitute for independent adapter review or future end-to-end live qualification.
The final package also includes sanitized recorded AX grammar tests; all full UI
state-machine and tool-execution scenarios remain synthetic. The separately
authorized grammar sample did not reload or conduct a full website acceptance.
