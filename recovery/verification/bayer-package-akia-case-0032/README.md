# Bayer backup scanner correction (inactive)
Parent: 843fc9995815a6e70975d6eee89e29aac94c2e1b (0007), includes 0004 command pairing and terminal receipt persistence.
One runtime file: package-success-evidence.py. Only AKIA pattern is explicitly case-sensitive inside the existing otherwise case-insensitive scanner. Other branches and raw archive checks unchanged.
Actual source: original official public Moka job response HTTP200, body JSON data field (encoded public job payload), not request credentials, headers, token field or authentication context. No matched value is reproduced here.
Old original package failed SECRET_IN_EVIDENCE. Same four request IDs and exact original files pass with corrected scanner; 196 members,167 raw files,160 verified web jobs. Local verify passes. check.py uses actual scanner expression and rejects a synthetic all-uppercase format marker.
Production unchanged; no upload yet. Real package and diagnostic response remain local, never include in GitHub. Backup whitelist: after/package-success-evidence.py, check.py, README.md only. This fixes packaging, not source publication; old committed SQL must never be replayed.
