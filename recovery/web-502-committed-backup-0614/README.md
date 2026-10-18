# Inactive: bounded web recovery and committed evidence
Parent module 0557 / 777ca0535d4c8ce71240ac4bd6a9386542e38294. Only four runtime paths in changes.json. No native identity change.

Existing single refresh retry now handles actual HTTP502 as well as JSON FAILED, including coverage GET; same total120s polling deadline, two attempts maximum, no retry403 or assertion mismatch. No new publication retry.

Once producer terminal COMMITTED_EXACT, readback exception returns HELD/WEB_READBACK_FAILED with committedExact true. Existing afterSource packages that outcome even if website pending. Package still requires official PUBLISH+READ_OUTCOME, terminalexit0,COMMITTED_EXACT/acktrue and raw verification. WEB_PENDING is explicit; no web success invented. UNKNOWN retains stop behavior.

Checks: python3 check.py; original Node check.mjs. Existing one recovery502/FAILED, repeated502 stop,403 no retry; committed failure reaches afterSource; unknown stops; single dispatch. Actual061101 Hengrui package purelocal diagnostic:21raw,12members,WEB_PENDING; archive byte restoration PASS. local-only/ and LOCAL_ONLY_PACKAGE_CHECK.json contain real evidence, DO NOT upload to GitHub. No live HTTP/SQL, current165 files unchanged.
