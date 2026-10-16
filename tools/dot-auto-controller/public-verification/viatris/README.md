# Viatris fixed public UI verifier (SOURCE_ONLY)

All real tools are disabled by default. No live Viatris AX/DOM capture, browser session, collection, database, native compiler, installation, upload or production qualification is included.

## Scope and original contracts

- Website: `https://job.orz.md/`
- Source/company: `source-viatris-social` / `company-viatris`
- Company/filter: `晖致中国` / `晖致`
- Coordinate: `B6`. Independently derived from both pinned readers' frozen 41-company roster, original registry Chinese names, original `zh-CN` sorting and eight-column coordinate function. Source tests recompute this and verify registry hashes against `config/reader-pins.json`.
- Directory official entry: `https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT`. Both original registries retain this entry and `https://viatris.cn/careers` as official chain evidence. The original profile uses html-table and raw `positionId`; it remains byte-for-byte unchanged.

## Initial inherited-assumption inventory

Before implementation, the preceding source was audited as a whole. Its source/company/name, official entry, fixed coordinate, native ID representation, URL identity assumptions, expected mapping admission, zero-row behavior, title extraction, separated anchor/title collections, DOM selectors, tab/packet names, default flags and generated-bundle imports were enumerated.

Viatris does not use Phenom IDs, URL-derived IDs, the preceding source's E6 coordinate, missing-card-as-zero or verified-zero acceptance. The general bounded consent/fresh-index/deadline/observation protocol is retained. The original reader's `aria-label` contains the potentially translated `job.title`; it is never the original-title source.

## Receipt authority and public observation

The seven-field expected interface is unchanged. The fixed host must first verify the committed READ_OUTCOME row's original receipt hash, receipt tuple, observedAt, VISIBLE membership and every full `job-persisted-projection-v1` hash. It also checks each projection's source and company. No replacement receipt protocol or summary hash is introduced. `test/receipt-adapter.test.mjs` executes only that actual host adapter against synthetic data and checks rejection before any UI creation on binding/hash failures.

Only after that admission, `createCuaBrowserPort({enabled:true,expected,toolCall})` validates expected data, copies and freezes it, and builds an unambiguous exact public href → original raw positionId map. The machine checks that its expected batch/source/company/time/evidence hash/jobs/removals match that frozen admission. Mutating caller data cannot retarget the map. The public verifier cannot itself establish receipt authenticity; direct synthetic invocation is not publication evidence.

Each observed record comes from one visible `#jobs-company-viatris .job`, containing exactly one visible `a` and one visible `p.en`. It reads `a.href` and `p.en.innerText` in the same DOM callback and preserves text exactly. It never reads title from aria-label, trims titles, extracts IDs from URLs or fills observed fields from expected data. Missing/duplicate elements, hidden/inert ancestors, unknown/duplicate/ambiguous URLs and wrong associations hold.

A complete expanded company, matching displayed count, exact full job set and matching company directory's visible UTC minute are required. Missing company, zero expected rows, changed/unrecognized consent, incomplete expansion, count mismatch and wrong/unknown source time hold. Zero rows are not a successful Viatris source result; the public layer returns `HOLD` with `VIATRIS_ZERO_ROWS_FAILED` before browser work. No directory time can upgrade this to verified zero.

One ordinary reload remains available only for the original known-stale-removals protocol. Unknown URLs conservatively hold before any reload. Tool timeouts invalidate the port, retain original pending promises, do not repeat actions and do not continue on late results. Non-timeout exceptions retain their identity.

## Tests and generated source

Use only the separately approved pinned Node. No dependency install is needed:

```
NODE_DISABLE_COMPILE_CACHE=1 TMPDIR=<approved-evidence>/ui-tmp <approved-node> tools/dot-auto-controller/public-verification/viatris/scripts/build-functions-bundle.mjs
NODE_DISABLE_COMPILE_CACHE=1 TMPDIR=<approved-evidence>/ui-tmp <approved-node> --require ./tools/dot-auto-controller/public-verification/viatris/test/no-network.cjs --test tools/dot-auto-controller/public-verification/viatris/test/*.test.mjs
```

Tests execute the fixed DOM code in a local synthetic VM with deliberately different translated aria labels, replay the shared preexisting AX grammar with synthetic Viatris labels, exercise the unchanged generic bounded protocol, recompute pinned reader coordinates, and verify bundle reproducibility and disabled defaults. They do not create original AX/DOM evidence or establish real UI correctness. All pass results remain list/minute-only; details are `UNKNOWN`, applications are `NOT_TESTED`, release eligibility/new batches/production qualification are false.

Review clarification: the original html-table adapter accepts safe absolute HTTP(S) URLs without a source-specific path or host constraint, and its normalized raw IDs may contain internal spaces. The verifier preserves those receipt-proven values exactly. It applies bounded public-envelope and original sensitive-assignment checks; it does not replace the original adapter's URL parser or infer a `/detail` requirement. Tests execute the unchanged small native URL-safety predicate for positive alternate-path/host examples. The source-card DOM read uses the same ancestor visibility checks as job rows and requires exactly one visible official-entry anchor.
