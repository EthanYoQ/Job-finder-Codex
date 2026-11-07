# Publication regression inputs

Run `npm run test:publication` from `runner-candidate`. CI runs the same offline command on Node 24, using `tsx` from the runner lockfile. A root `node_modules` link lets the sibling web reader use those same installed dependencies. It needs no browser, database service, source-site access or production credentials. This workflow does not deploy or add a publication gate.

| Behavior | Test | Input |
| --- | --- | --- |
| Unfamiliar China city remains eligible without an invented city | `abbvie-province-location.test.mjs` | Synthetic |
| One bad job does not reject all other jobs | `cspc-job-isolation.test.mjs` | Synthetic HTTP and DOM |
| Duplicate or missing pages cannot establish completeness | `cspc-job-isolation.test.mjs`, `novartis-native-title-sort.test.mjs` | Synthetic HTTP and evidence mutations |
| CSPC API success does not replace an empty independent DOM | `publication-boundaries.test.mjs` | Synthetic; no archived CSPC 31-job body is claimed |
| One source failure does not prevent another source's atomic commit | `publication-boundaries.test.mjs` | Synthetic HTTP, existing in-memory database and real archive/admission/commit paths |
| Explicit closure reaches lifecycle publication | `novartis-closed-lifecycle.test.mjs` | Synthetic three-round capture |
| An observed repeated Novartis REQ cannot count as a second job | `novartis-archived-duplicate.test.mjs` | Two real row projections in a synthetic page envelope |

`novartis-duplicate-rows.json` contains the two `REQ-10091713` occurrences from the archived November 6 batch `d279b680-5a9d-47c5-a1fc-ea0c2987884e`, site-ascending (`order=站点&sort=asc`) pages 20 and 21 (zero-based filenames 19 and 20). The archived request's order hash is `a59fe62777ff25aec42c337fccbf5929af9c9b45bc42ee17131f5900889f4534`, which matches `站点`, not `发布日期`. Original files were read locally from `diagnostics/nov06-1157-official-originals`; they were not fetched again. Each entry records the original file SHA-256 and the Cheerio-serialized row SHA-256. The filename prefix is an artifact ID, not the content hash.

The projection retains public title/link, country and primary-location cells. Other cells, nonessential attributes and whitespace are removed. No cookie, token, script or personal field is included. The test supplies synthetic totals, navigation controls and nine additional rows. It tests the observed repeated identity; it is not a replay of the full production batch and does not establish that every production duplicate represents a missing job.
