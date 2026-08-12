# Production security gate

`npm run security:production-gate` evaluates only the shipped image and production lock closure. The production-image workflow supplies the exact local image ID, a Trivy JSON image scan, and `npm audit --omit=dev` JSON. The resulting receipt binds SHA-256 hashes for the image, lockfile, raw scanner reports, and policy files.

High and critical findings default to runtime-reachable when no decision exists. A finding passes only when one of these time-bounded, machine-readable records applies:

- `security/production-reachability.json`: an `UNREACHABLE` decision with package name, reason, evidence path, owner, and expiry.
- `security/production-vulnerability-exceptions.json`: a temporary exception with advisory ID, package name, optional installed version, reason, owner, and expiry.

Expired or malformed records fail the gate. Prefer upgrading the affected package; exceptions are not a substitute for an available fix. The authoritative output is `.runtime/security/production-security-receipt.json` in CI. Do not hand-edit receipts.
