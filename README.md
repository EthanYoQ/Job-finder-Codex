# Kelun detail-context repair snapshot

This frozen two-file candidate is an uncommitted delta on source commit 6c6f4e3f4f2d80bbcc8639df5016aad102844be4. It preserves an exact detail URL context for later pages and recognises the explicitly listed Chengdu Shuangliu district. The complete source-only.patch and a pure synthetic regression test are included.

This is the historical intermediate candidate: nationwide location remains UNKNOWN, and unlisted districts can still remain UNKNOWN. It has no new producer Git or runtime identity. Later candidates and live outcomes do not change this snapshot's meaning.

Restore the exact eight-file Kelun baseline plus its ordered producer dependencies, matching lockfile and Node 22.23.3 before applying the patch. These files alone are not a buildable project. No real captured bodies, job rows, runtime controls, diagnostics, credentials or installed dependencies are included. Source identifiers and code pins are retained where necessary. This backup checks fixed bytes and the exact patch application; it does not execute tests, register, migrate or deploy.
