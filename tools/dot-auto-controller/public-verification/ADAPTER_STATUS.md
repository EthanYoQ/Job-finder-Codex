# Fixed CUA adapter: implementation and remaining qualification

Implemented in cua-port.mjs and actual-ax.mjs:
- Closed operation-to-code builder for ordinary createBrowserTab, getAXState,
  fresh numeric click, the two actually used role locators, read-only function-
  object evaluate, and ordinary reload. No caller-supplied code/URL/selector.
- First create call contains exactly the one supported entry call. Its real
  native result is recognized from observed isError:false, one text block,
  documentation prefix plus actual browser-state grammar. It is not a fabricated
  success packet. Later JSON packets are emitted by nodeRepl.write(JSON.stringify).
- Actual getAXState returns a string. Full-state {emit:false,disableDiffing:true}
  was sampled to avoid diff/reused-index ambiguity and duplicate auto-output.
- Actual AX decoding covers the observed consent, jobs loading/ready/expanded,
  and directory loading/filtered/ready grammar, including search text field,
  checkbox Description/Value, disabled, collapsed/expanded, and definition list.
  Unknown role, line, root, view, target, or output envelope holds.
- A fresh full AX state is fetched before each control decision. Exactly one
  matching enabled control is required; indices are never reused after another
  observation. Checkbox state, entry enablement, and previously authorized legal
  paths are checked. The complete observed 19-node visible consent wording/order/hierarchy is
  allowlisted. Only the already observed checkbox 0→1 and entry disabled→enabled
  transition is allowed. Added/replaced/reordered surface prompts hold regardless
  of language or keywords. This is not a full legal-document hash requirement.
- Separate rendered anchor and p-title collections are joined bijectively, with
  duplicate/orphan/missing nodes rejected. Source-card time requires the same
  company, official entry, exact source label and visible UTC minute. A fresh
  AX check after each DOM read guards state changes during the read.
- Core passes its original absolute per-step deadline. The adapter uses that
  same deadline before and after every internal tool call, with a 160-call cap.
  Outer timeout also poisons the adapter locally. A late tool settlement cannot
  schedule even a subsequent observation, including after a clock rewind.
- The original hosted tool Promise is retained as originalToolOperation;
  toolOperationPending indicates liveness only. Per-call safe timestamp/outcome
  receipts omit raw responses, DOM, AX, control indices, tab/session IDs and URLs.

Default activation remains false:

    const port = publicVerification.createCuaBrowserPort({
      enabled: false,
      toolCall: args => tools.mcp__cua_repl__js(args)
    });

After independent review, the same host can choose enabled:true and invoke the
existing controller. The bound call is still in the original functions host;
no shell, local computer, direct database connection, new credential, hidden API,
or replacement environment is introduced. Synthetic tests inject their own
explicitly synthetic decoder/transport; they are not actual CUA return samples.

Actual evidence:
OBSERVED_AX_GRAMMAR.json records the source and precise permitted sampling scope.
The full original strings stayed only in the CUA session. The saved grammar omits
tab/focus metadata, renumbers indices, and removes unrelated public rows. The
implementation was additionally replayed against all seven complete in-memory
actual strings: ACTUAL_AX_DECODER_CHECK.json reports all decoded, without further
browser requests. Initial failure on the actual definition-list role and the
subsequent correction are retained separately. This avoids claiming that passing
reduced fixtures alone proves whole actual snapshots are supported.

Remaining qualification:
- Parent independent review of final adapter/source/hash.
- The actual adapter was not enabled and no full autonomous website run occurred.
  Fresh AX grammar and envelope parsing were sampled, not a new publication or
  website acceptance. No reload, View all, official recrawl, DB operation,
  detail/application visit, or new legal agreement occurred in the sampling.
- A live single invocation must still be qualified under the original approved
  host, retaining real tool/process outcomes and recovery evidence. This package
  does not establish durable scheduling or multi-day unattended execution.
