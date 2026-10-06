#!/usr/bin/env python3
"""Static, read-only deployment archive checks. Standard library only."""
import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

CONTRACT = "nonsecret-deployment-backup/v1"
HISTORY = {"historical-intent", "historical-receipt"}
ROLES = HISTORY | {"payload", "chunk", "bootstrap", "configuration", "support"}
SHA = re.compile(r"^[0-9a-f]{64}$")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def validate(manifest, scope, body_root):
    """Scope/review authenticity is a caller prerequisite, not proven here."""
    errors, gaps, bodies = [], [], {}
    root = Path(body_root)

    def need(condition, message):
        if not condition:
            errors.append(message)

    def index(records, label):
        result = {}
        if not isinstance(records, list):
            errors.append(label + " must be a list")
            return result
        for item in records:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                errors.append(label + " contains an invalid ID")
                continue
            need(item["id"] not in result, label + " duplicate ID: " + item["id"])
            result[item["id"]] = item
        return result

    need(manifest.get("contractId") == CONTRACT == scope.get("contractId"), "contractId mismatch")
    need(scope.get("frozen") is True, "expected scope must be independently frozen")
    need(manifest.get("mode") in {"complete", "partial"}, "mode must be complete or partial")
    need(manifest.get("runtimeReady") is False, "runtimeReady must be false for static archives")
    need(manifest.get("launchAuthorized") is False, "launchAuthorized must be false")
    need(manifest.get("restoreLiveState") is False, "restoreLiveState must be false")
    need(manifest.get("replayAuthority") == "none", "archive must have no replay authority")
    need(manifest.get("restoreMode") == "offline-inert", "restoreMode must be offline-inert")
    expected = index(scope.get("requiredArtifacts"), "requiredArtifacts")
    artifacts = index(manifest.get("artifacts"), "artifacts")
    need(bool(expected), "frozen scope cannot be empty")
    need(set(artifacts) == set(expected), "artifact IDs must exactly match frozen scope")
    used_paths = set()

    for key, item in artifacts.items():
        requirement = expected.get(key, {})
        role, sha = item.get("role"), item.get("sha256")
        need(role in ROLES and role == requirement.get("role"), key + ": role mismatch")
        need(isinstance(sha, str) and bool(SHA.fullmatch(sha)), key + ": invalid SHA-256")
        need(sha == requirement.get("sha256"), key + ": frozen original hash mismatch")
        deps = item.get("dependsOn")
        need(isinstance(deps, list) and all(isinstance(d, str) for d in deps), key + ": invalid dependencies")
        if not isinstance(deps, list) or any(not isinstance(d, str) for d in deps):
            deps = []
        need(len(deps) == len(set(deps)), key + ": duplicate dependencies")
        need(deps == requirement.get("dependsOn"), key + ": dependencies differ from frozen scope")
        need(all(d in artifacts for d in deps), key + ": unknown dependency")
        need(item.get("replayAuthority") == "none", key + ": replay authority forbidden")
        need(item.get("liveStateEligible") is False, key + ": live-state restoration forbidden")
        need(item.get("automaticActivation") is False, key + ": automatic activation forbidden")
        disposition = "archive-only" if role in HISTORY else "inert-material"
        need(item.get("restoreDisposition") == disposition, key + ": invalid restore disposition")
        review = item.get("review", {})
        if not isinstance(review, dict):
            review = {}
        status = review.get("status")
        need(status in {"approved-nonsecret", "pending", "secret"}, key + ": invalid review status")
        included = item.get("bodyPath") is not None
        need(item.get("markedSafe") is (status == "approved-nonsecret"), key + ": safety label contradicts review")
        provenance = item.get("provenance")
        need(provenance in {"original", "reconstructed", "template", "unavailable", "excluded"}, key + ": invalid provenance")
        original = included and provenance == "original"
        need(item.get("originalBodyIncluded") is original, key + ": originalBodyIncluded contradicts body/provenance")
        if not original:
            gaps.append(key)
        if not included:
            need(isinstance(item.get("omissionReason"), str) and bool(item["omissionReason"].strip()), key + ": omission needs a reason")
            need(status != "approved-nonsecret", key + ": absent body cannot be marked safe")
            continue
        need(provenance == "original", key + ": this original-byte contract requires separately identified replacements")
        need(status == "approved-nonsecret", key + ": included body lacks non-secret approval")
        need(review.get("sha256") == sha, key + ": review is not bound to body hash")
        need(isinstance(review.get("reviewer"), str) and bool(review["reviewer"].strip()), key + ": reviewer missing")
        need(isinstance(review.get("reviewedAt"), str) and bool(review["reviewedAt"].strip()), key + ": review time missing")
        need(review.get("findings") == [], key + ": secret or unresolved findings cannot be included")
        if status != "approved-nonsecret" or review.get("findings") != [] or review.get("sha256") != sha:
            # Reject before opening an unreviewed or known-sensitive body.
            continue
        rel = item.get("bodyPath")
        if not isinstance(rel, str) or not rel or "\\" in rel:
            errors.append(key + ": invalid body path")
            continue
        parts = PurePosixPath(rel).parts
        if PurePosixPath(rel).is_absolute() or ".." in parts or str(PurePosixPath(rel)) != rel:
            errors.append(key + ": path traversal or noncanonical path forbidden")
            continue
        required_directory = "archive-only" if role in HISTORY else "materials"
        if len(parts) < 2 or parts[0] != required_directory:
            errors.append(key + ": body must remain under " + required_directory)
            continue
        need(rel not in used_paths, key + ": duplicate body path")
        used_paths.add(rel)
        path = root / rel
        # Check every path component before opening. Do not follow symlinks.
        chain = list(root.absolute().parents) + [root] + [root.joinpath(*parts[:n]) for n in range(1, len(parts) + 1)]
        if any(p.is_symlink() for p in chain) or not path.is_file():
            errors.append(key + ": body missing, nonregular, or symlinked")
            continue
        need(path.stat().st_mode & 0o111 == 0, key + ": executable permissions forbidden")
        body = path.read_bytes()
        bodies[key] = body
        need(type(item.get("size")) is int and item["size"] == len(body), key + ": byte size mismatch")
        need(digest(body) == sha, key + ": body hash mismatch")

    def visit(key, active, done):
        if key in active:
            errors.append(key + ": cyclic dependency")
            return
        if key in done or key not in artifacts:
            return
        deps = artifacts[key].get("dependsOn", [])
        for dep in deps if isinstance(deps, list) else []:
            if isinstance(dep, str):
                visit(dep, active | {key}, done)
        done.add(key)

    done = set()
    for key in artifacts:
        visit(key, set(), done)
    if root.is_dir() and not root.is_symlink():
        for path in root.rglob("*"):
            rel = path.relative_to(root).as_posix()
            if path.is_symlink() or (path.is_file() and rel not in used_paths):
                errors.append("unlisted or symlinked archive body: " + rel)
    else:
        errors.append("body root must be an existing nonsymlink directory")

    transfers = index(manifest.get("transfers"), "transfers")
    expected_transfers = index(scope.get("transfers"), "scope transfers")
    need(bool(expected_transfers), "frozen scope must declare a transfer")
    need(set(transfers) == set(expected_transfers), "transfer IDs must match frozen scope")
    for key, transfer in transfers.items():
        frozen = expected_transfers.get(key, {})
        for field in ("payloadId", "bootstrapId", "chunkIds"):
            need(transfer.get(field) == frozen.get(field), key + ": " + field + " differs from frozen scope")
        chunks = transfer.get("chunkIds", [])
        if not isinstance(chunks, list) or not chunks or any(not isinstance(c, str) for c in chunks):
            errors.append(key + ": ordered chunk IDs must be a nonempty list")
            continue
        need(len(chunks) == len(set(chunks)), key + ": duplicate chunks")
        need(type(transfer.get("chunkCount")) is int and transfer["chunkCount"] == len(chunks), key + ": chunk count mismatch")
        payload, bootstrap = transfer.get("payloadId"), transfer.get("bootstrapId")
        references = [(payload, "payload"), (bootstrap, "bootstrap")] + [(c, "chunk") for c in chunks]
        for ref, role in references:
            need(isinstance(ref, str) and ref in artifacts and artifacts[ref].get("role") == role, key + ": broken " + role + " reference")
        if isinstance(payload, str) and payload in bodies and all(c in bodies for c in chunks):
            need(b"".join(bodies[c] for c in chunks) == bodies[payload], key + ": ordered chunks do not reassemble payload")

    declared_gaps = index(manifest.get("gaps"), "gaps")
    need(set(declared_gaps) == set(gaps), "gaps must name exactly the missing required original bodies")
    for key, gap in declared_gaps.items():
        need(isinstance(gap.get("reason"), str) and bool(gap["reason"].strip()), key + ": gap reason missing")
    if manifest.get("mode") == "complete":
        need(not gaps, "complete recovery requires every required original body; hashes alone are insufficient")
    return {
        "valid": not errors,
        "recoveryComplete": not errors and not gaps and manifest.get("mode") == "complete",
        "runtimeReady": False,
        "launchAuthorized": False,
        "restoreLiveState": False,
        "gaps": sorted(gaps),
        "errors": errors,
        "scope": "deployment-materials-only",
    }


def read_json(path):
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate JSON key: " + key)
            value[key] = item
        return value
    result = json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=unique_pairs)
    if not isinstance(result, dict):
        raise ValueError("JSON root must be an object")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("scope", help="independently frozen expected-scope.json")
    parser.add_argument("bodies", help="archive body directory, never a live deployment directory")
    args = parser.parse_args()
    try:
        result = validate(read_json(args.manifest), read_json(args.scope), args.bodies)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        result = {"valid": False, "recoveryComplete": False, "runtimeReady": False,
                  "launchAuthorized": False, "restoreLiveState": False, "errors": [str(exc)]}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
