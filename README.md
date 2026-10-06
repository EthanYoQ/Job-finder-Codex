# Agent log reader Python compatibility source

This snapshot preserves four fixed source files. The reader parses its supported timestamp forms with datetime.strptime, without requiring datetime.fromisoformat. The shell wrapper embeds the exact same Python source. The test inputs are synthetic.

Dependencies: Python 3.6+ standard library and a POSIX shell. Operational use of the controller additionally requires the referenced official Aliyun CLI 3.5.1, an existing external profile, and a separately reviewed fresh intent. Profile contents and actual intent/submission/query files are not included. Preserve the relative file layout and keep Python assertion checks enabled.

The source retains non-secret instance/path/window, known invocation IDs and payload hash constants. These are source bindings, not a credential or fresh execution authorization. Review them before any future diagnostic use.

The reader inspects a bounded set of official Agent log paths and returns selected metadata and hashes. eventTags are word matches, not authoritative task terminal states. Empty, missing, truncated or inconclusive log output cannot prove that a command was never submitted or executed. The source is a fixed diagnostic window, not a general-purpose log monitor. Time and byte thresholds are soft loop checks, not strict end-to-end resource limits; text-extracted exitCode is not an authoritative API status.

The controller queries the InvokeId saved by its original submission. An UNKNOWN submission must not be automatically sent again. The source requests a 60-second API command timeout and separately limits local CLI communication to 75 seconds; these do not make the reader loop thresholds hard bounds. The query JSON fallback is for this fixed diagnostic script, not a general log sanitizer. Restoring these files does not restore an intent, establish an invocation result or authorize a new server call.

Actual Agent logs, command bodies, API results, invocation receipts, environment/profile data, support drafts and execution reports are excluded. This backup verifies source hashes, embedding and remote bytes; it does not run the reader, controller or tests, contact a server, merge a branch or deploy code.
