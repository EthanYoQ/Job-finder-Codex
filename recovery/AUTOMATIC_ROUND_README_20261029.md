# Automatic round recovery wiring

Restore external parent 052de78eabc846cc4d518bd09dd0e989f3241921 and its parent chain, then overlay this delta. The 64-file manifest records the exact runtime combination. Native120 is unchanged. This is not a standalone project. Existing support/ mapping remains unchanged; copy recovery/round-isolation.test.mjs to the restored layout root for focused testing.

Normal original Functions entry now automatically allocates a native supported round queue. It checks pending requests in the original queue and all prior rounds before launching. Only the two exact expired CTTQ request files, matched by whole-file SHA256, are isolated; any other unresolved request still blocks. CTTQ remains explicitly HOLD in code, not dependent on a temporary store setting and not overridable by it. The old batch remains UNKNOWN/read-only and its bytes are preserved. Its SQL expiry and the actual read-only reconciliation evidence are described in the parent package.

No database lock, official connector, current source/build binding, dedup or publication check is removed. No old request is resubmitted or marked canceled/successful. All 36 sources remain enumerated, with CTTQ reported as held, not complete. Production acceptance has not yet been established. LATEST is unchanged.

The three original/focused Node22 tests passed again. Automatic round creation, other unresolved queues, altered old request rejection, old/new checkpoint paths and non-overridable CTTQ hold are covered. This package contains code and recovery metadata only, no credentials or original capture/session material.
