# Hansoh fresh DOM grace protection

This producer-only change preserves the registered `PostDate:[180]` main list,
its request fields, counts, canonical current/output set and source configuration
hash. It adds no source, DB column, lifecycle value or receipt field. A detail
observation does not add a CURRENT job and does not prove complete recruitment
coverage. Do not deploy this checkout's old web reader; use the separately
verified compatible a775/db56 reader pair.

## Eligible state and failure behavior

The target set is recomputed from the current native list and the DB's previous
snapshots: same Hansoh source/company, ACTIVE, missing count exactly 1, absent
from the native list, and lastSeen at or after the verified current-policy floor.
The official URL's GUID must produce the stored official-json ID. No job ID is
hard-coded. Missing0, suspected/offline and pre-policy rows receive no exception.

Every eligible target requires a fresh same-run cloud-browser full DOM capture.
With valid substantial duties and qualifications, exact native title (including
its requisition code), location and tenant identity, and no closure conflict, the
previous row remains ACTIVE/missing1/GRACE with its complete previous record,
firstSeen and lastSeen intact and isNew false. The main result stays unchanged.
The next run requires a new observation; a repeated list row returns normally to
CURRENT. Unknown detail availability is not a closure assertion.

Missing evidence, failed list acquisition, unproved details, closed/expired
messages, disabled Apply controls, wrong source/company/ID/URL, changed context,
old/future/cross-request/cross-batch captures, unknown extra artifacts and altered
hashes stop the dependent publication. They do not advance misses for that run.
The native success alone cannot freeze an eligible grace row: the publication
boundary independently demands its proof.

## Producer integration

`runCloudPortableSourcePilot` obtains the existing read-only pre-capture context
and builds the real pending tuple before fetching. On Hansoh it passes the verified
floor and previous snapshots to `createOwnedSourceQualityFetch`'s source-local
`hansohGraceDom` option. Other sources keep their existing route. No caller can
supply `protectedIds`, a presence boolean, arbitrary HTTP transport, or a ready-made
accepted admission.

The owned acquisition clock starts before the unchanged HTTP list and ends after
the DOM response. After independently replaying the list, the producer writes:

`<artifact-workspace>/hansoh-grace-dom/<random-nonce>.request.json`

The strict request contains schemaVersion=1, kind=HANSOH_GRACE_FRESH_DOM_REQUEST,
nonce, full binding (releaseCandidateId, batchId, sourceResultId, sourceId,
sourceConfigSha256, adapterVersion), companyId, contextSha256,
listEvidenceSha256, actual requestedAt/deadlineAt, and the ordered dynamic targets
(dedupeKey, sourceJobId, officialUrl, officialTitle, locationRaw). The context hash
covers every previous snapshot and the visibility floor. The deadline is at most
20 minutes from acquisition start; the existing 30-minute admission window and
lease/publication budget are unchanged. No request is needed for an empty target
set. The producer supports its existing AbortSignal cancellation while waiting.

## Dot cloud browser completion

A coordinator must watch that directory and use its existing authorized dot cloud
browser to open each exact requested official URL after the request is written.
This stage does not launch a new browser or fall back to another source/API.
If the browser cannot retrieve a full public detail, abort the producer. Do not
click Apply, bypass login, convert an ordinary HTTP 200 shell into a DOM capture,
or reuse a saved diagnostic. Do not rewrite capture timestamps.

Collect one actual read-only browser observation per target, in request order:

```json
[
  {
    "requestedUrl": "https://hspharm.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000002",
    "finalUrl": "https://hspharm.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000002",
    "capturedAt": "<actual ISO instant from this browser observation>",
    "documentHtml": "<actual complete document.documentElement.outerHTML>"
  }
]
```

Read the final URL, DOM and timestamp together after the detail has rendered. Save
the original full DOM, including the native BSGlobal tenant declaration, title,
location and duty sections; do not construct HTML from a UI summary. Save the
array privately as `actual-browser-observations.json`, then run:

```sh
node --import tsx scripts/p0-hansoh-grace-dom-response.ts \
  /absolute/path/to/nonce.request.json \
  /absolute/path/to/actual-browser-observations.json
```

The helper verifies every observation, computes hashes, and atomically publishes
a non-overwriting `<nonce>.response.json`. It performs no fetch. Its response has
schemaVersion=1, kind=BROWSER_UI_DOM_OBSERVATION_NOT_HTTP,
captureTool={name:dot-cloud-browser-dom,version:1}, canonical requestSha256 and
captures with original URLs/time/DOM plus documentHtmlSha256. There is no HTTP
status. Response bytes are bounded at 16 MiB; each DOM at 4 million characters.
The helper and the producer both fail closed on invalid inputs. Approval or a
successful helper exit does not authorize publishing.

The DOM artifact is an exact COMMAND_OUTPUT with locator
`hansoh-grace-dom-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP`. The original HTTP list's
collector metadata and pagination are preserved; the auxiliary envelope explicitly
identifies its browser tool. No HTTP network fields are supplied for the DOM.
The archived body contains the full request and response. Only original page
artifacts plus this one fully replayed auxiliary artifact are permitted.

The same live owned acquisition is bound once to the actual tuple. Admission
replays its content and checks every capture against the owned interval. Before
publication, the latest DB context and dynamic absent set must exactly match the
request commitments. The actual persistence route rereads and verifies archived
bytes and the auxiliary proof. This relies on the trusted local producer/browser
collector; the file exchange and hashes are integrity checks, not remote browser
attestation.

## Review and regression

`tests/crawler/hansohGraceDom.test.ts` contains synthetic fixtures only and exercises
owned fetch, the response helper, archive, admission, atomic builder and persistence
checks. Optional `HANSOH_GRACE_COMPAT_FIXTURE=/absolute/path.json` writes a synthetic
commit for testing external archived reader closures. Do not commit real captures
or private diagnostic originals. Registration, fresh browser acquisition, DB writes,
publication and paired web deployment belong to the separately authorized operator.
