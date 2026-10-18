Recovered success-evidence packager

Origin: the executed 2026-10-18 04:43 Grifols/GSK temporary script. The fixed source list/output directory were replaced with CLI arguments; manifest verification is exposed for remote downloads. No uploader, credential handling, scheduler or afterSource integration is included.

Usage: python package-success-evidence.py --run /exact/source/batch --relay /exact/relay --output /new/package.tar.gz
Download check: python package-success-evidence.py --verify /downloaded/package.tar.gz

Keep exact batch paths, full raw bytes and official receipts. The original bounded last-100-request lookup fails if required receipts are missing. The helper removes known metadata secrets, checks high-confidence raw credential patterns and requires COMMITTED_EXACT, publication acknowledgement and full web equality. It is not a comprehensive secret scanner; do not use it for credential or internal-session archives. Manual recovery or non-success evidence needs its own truthful classification, not forced success.

Focused validation: prior remote Grifols/GSK 25-member archive restored; synthetic pack/verify and check/session redaction passed; Python syntax passed. Original evidence was not uploaded to GitHub.
