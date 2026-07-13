# Four-source official HTML adapter design

Status: read-only design; no crawl, migration, seed, registry sync, database write, deployment, or RC evidence mutation was performed.

Baseline inspected: Git `652c8c38b59ac7c7dfce0808523f666fdaa4a4b2`. Existing unrelated dirt (`.superpowers/sdd/progress.md`, `outputs/`) was not touched.

## Decision

Use one narrow generic extension to the existing `html-table` path, then configure the four companies. Do not add four bespoke fetchers and do not treat a current row count as a permanent expected total.

- Apeloa, Huahai, and Grand Pharma can be promoted to executable `VERIFIED_SCRAPABLE` staged sources after the RED tests below pass. Their current public social lists contain 19, 2, and 2 rows respectively.
- Otsuka's group careers page can be promoted as a second executable source with 2 rows. Preserve the existing source identity for the China Otsuka hot-jobs page as source 1; add the group page as source 2.
- Otsuka as a whole is **not yet safe to count as stable/completeness-qualified**. The official China subsidiary hot-jobs page currently contains an empty `.positionBox`, but it exposes no official `0` total and no explicit “暂无岗位” marker. Absence of rendered rows is not an official zero under the current evidence contract. Keep that source `ENTRY_FOUND_PENDING_ADAPTER` and show Otsuka as `核验中`/official-entry-only until an explicit zero marker, official endpoint, or positive public rows are available.
- This does not block site release under the updated Goal. It does block any claim that Otsuka's official-linked public social openings are completely auto-updated.

The public claim is limited to social jobs reachable from the official links described below. It excludes campus rows, authenticated views, hidden tenants, and third-party job boards.

## Fresh official-byte observations

Direct HTTPS GETs were captured between `2026-07-13T17:55:07Z` and `2026-07-13T17:55:15Z`. Every response was HTTP 200 and ended at the requested URL without a cross-URL final redirect.

| Official page | Bytes | SHA-256 | Public observation |
|---|---:|---|---|
| `https://www.apeloa.com/join.html` | 185804 | `e885c02b61498579788a9976d887b55ddbaeb7be2aa7f818b606d6b8d6efd2c4` | first tab/list has 19 social `.ev` rows; second has 12 campus rows |
| `https://www.huahaipharm.com/zpgw.html` | 22711 | `9b0a718db14901534756d32970102871ed4bc59496f35e28f9406b79e21e33c6` | 2 `tr.tr_title` social rows |
| `https://www.otsuka.com.cn/` | 31665 | `1e72944eaad594360b6e297ebc96b0182a4cbedbcde256aa5d7e85ea5dfeb08a` | official group root |
| `https://www.otsuka.com.cn/join-us/index.html` | 20799 | `fcdd871bba7290bc34c5b4d3f403c9d9434c2143d6bd02b97ecfa2ac84ebec6e` | 2 `.join-list > .join-item` roles |
| `https://chinaotsuka.com.cn/class/26` | 39132 | `324e9a5716d3e440e87e72ab51c7b1a7ffeb733f3a1385469fc4ea58ebb393e4` | official hot-jobs page; `.positionBox` empty, no explicit zero declaration |
| `https://job.grandpharma.cn/` | 31136 | `c921be1b5520a1c797cfa8238d11f289a52c10f345dc6c5b53cfc165d2f69f7d` | 3 cards: 2 social cards link `#login`; 1 campus card links `schooldetail.html` |

Otsuka provenance is public and official: `https://www.otsuka.com.cn/otsuka-in-china/index.html` links to `http://www.chinaotsuka.cn`, which currently redirects to `https://www.chinaotsuka.com.cn/`; that site's navigation links to `/class/26`. Archive that link and redirect trace during independent verification. Do not infer any unlinked Otsuka tenant.

## Required generic contract change

Current constraints found in `src/crawler/adapters/types.ts`, `src/crawler/adapters/htmlTable.ts`, and `src/crawler/httpHtmlSourceFetch.ts`:

1. `sourceJobId` can read only one field, so title-only identity can collapse two positions with the same title in different locations.
2. zero HTML rows always fail the adapter.
3. ordinary HTML is always returned as `NEEDS_MANUAL_COMPLETENESS_REVIEW`; the persistent evidence has no completeness declaration, even when one exact static page is exhausted.

Add these generic, source-agnostic fields:

```ts
interface HtmlTableFieldMap {
  sourceJobId?: HtmlFieldSelector;
  sourceJobIdParts?: readonly HtmlFieldSelector[]; // mutually exclusive with sourceJobId
  // existing fields unchanged
}

interface HtmlTableConfig {
  // existing fields unchanged
  staticPublicList?: {
    containerSelector: string;       // must match exactly one element
    nextControlSelector: string;     // must match zero elements for static exhaustion
    excludedPartitionSelectors?: readonly string[]; // must not overlap rowSelector
    explicitEmptyState?: {
      selector: string;
      pattern: string;               // must explicitly declare zero/empty in official bytes
    };
  };
}
```

`sourceJobIdParts` behavior must be deterministic: normalize each part exactly as existing fields are normalized, require every part non-empty, join with U+001F, and emit `html:sha256:<sha256-utf8>`. Reject simultaneous `sourceJobId` and `sourceJobIdParts`. This avoids title-only collisions without using mutable descriptions as identity.

`staticPublicList` behavior:

- Require an exact, non-redacted official HTML artifact, one container, every selected row inside that container, no selected row inside an excluded partition, and zero matching next controls.
- For a non-empty list, emit one page terminating `NEXT_ABSENT` and a `COMPLETE_PAGE_TRAVERSAL` declaration with value `1`, scope `SOURCE`, and the exact artifact/row selector. The expected job count remains unset because none of these official pages declares a total; the current capture count is evidence, not configuration.
- For an empty list, certify `OFFICIAL_TOTAL_COUNT = 0` only when `explicitEmptyState.selector` matches and its official text matches `pattern`. Then the HTML adapter may return a successful zero with zero reconciliation loss. Never treat an empty container alone as official zero.
- Any matching next control, row outside the declared container, overlap with an excluded partition, missing identity part, parse loss, validation loss, or dedupe collision makes completeness non-verifying/fail-closed.

This reuses existing `COMPLETE_PAGE_TRAVERSAL`, `OFFICIAL_TOTAL_COUNT`, page evidence, and strict reconciliation. No schema migration or new evidence enum is required.

## Exact registry, surface, and adapter changes

### 1. Apeloa (`company-apeloa`)

Registry seed:

```ts
status: "VERIFIED_SCRAPABLE",
atsKind: "OFFICIAL_HTML",
socialEntryUrl: "https://www.apeloa.com/join.html",
officialChainEvidenceUrl: "https://www.apeloa.com/join.html",
campusEntryUrl: "https://www.apeloa.com/join.html"
```

Keep generated source/surface identity `source-apeloa-social` / `surface-apeloa-social`. The same URL's campus partition must remain a separate blocked campus surface; it is not ingested. Remove the orphan config key `source-puluo-social` and configure the canonical ID:

```ts
"source-apeloa-social": {
  adapterId: "html-table",
  table: {
    rowSelector: ".join2 .tab-content > .main:first-child > .ev",
    fields: {
      sourceJobIdParts: [
        { selector: ".table99.name > div:nth-child(1) > p" },
        { selector: ".table99.name > div:nth-child(4) > p" },
        { selector: ".down .mailto:first-of-type p" }
      ],
      officialTitle: { selector: ".table99.name > div:nth-child(1) > p" },
      officialUrl: { value: "https://www.apeloa.com/join.html" },
      locationRaw: { selector: ".table99.name > div:nth-child(4) > p" }
    },
    staticPublicList: {
      containerSelector: ".join2 .tab-content > .main:first-child",
      nextControlSelector: ".join2 .pagination, .join2 a[rel='next'], .join2 [data-page]",
      excludedPartitionSelectors: [".join2 .tab-content > .main:nth-child(2)"]
    }
  }
}
```

Current evidence: exactly 19 selected social rows; 12 second-list campus rows must never enter raw or normalized social counts. No pagination declaration or next control is present. Official URL stays the careers page because application is by `mailto:` and there is no per-job HTTPS detail URL.

Eligible for stable automatic update after two fresh, lossless, independently checked static-list observations.

### 2. Huahai (`company-huahai`)

Registry URLs and source ID already match. Change only status to `VERIFIED_SCRAPABLE`; keep `OFFICIAL_HTML`, `source-huahai-social`, and `surface-huahai-social`.

```ts
"source-huahai-social": {
  adapterId: "html-table",
  table: {
    rowSelector: "tr.tr_title",
    fields: {
      sourceJobIdParts: [
        { selector: "td:nth-child(1)" },
        { selector: "td:nth-child(2)" },
        { selector: "td:nth-child(5)" }
      ],
      officialTitle: { selector: "td:nth-child(1)" },
      officialUrl: { value: "https://www.huahaipharm.com/zpgw.html" },
      locationRaw: { selector: "td:nth-child(2)" }
    },
    staticPublicList: {
      containerSelector: "table:has(tr.tr_title)",
      nextControlSelector: "table:has(tr.tr_title) .pagination, table:has(tr.tr_title) a[rel='next'], table:has(tr.tr_title) [data-page]"
    }
  }
}
```

Current evidence: exactly 2 rows (`外贸业务员`, `国际业务经理`). The adjacent “我要应聘” links point to Liepin and must not be emitted as official job URLs or treated as source authority. `#page1` is a same-page back-to-top anchor, not pagination.

Eligible for stable automatic update after two fresh, lossless, independently checked observations. Its low count is acceptable only with strong static-list traversal evidence; never inflate it.

### 3. Otsuka (`company-otsuka-china`)

Remove `targetStatus: "BLOCKED_EVIDENCE_GAP"` so the company is active and replace legacy single-source fields with `socialSources`. Preserve the existing source identity for the previously registered subsidiary page:

```ts
socialSources: [
  {
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "OFFICIAL_HTML",
    socialEntryUrl: "https://chinaotsuka.com.cn/class/26",
    officialChainEvidenceUrl: "https://www.otsuka.com.cn/otsuka-in-china/index.html"
  },
  {
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    socialEntryUrl: "https://www.otsuka.com.cn/join-us/index.html",
    officialChainEvidenceUrl: "https://www.otsuka.com.cn/join-us/index.html"
  }
]
```

This yields:

- `source-otsuka-china-social` / `surface-otsuka-china-social`: subsidiary page, still pending/noncertifying.
- `source-otsuka-china-social-2` / `surface-otsuka-china-social-2`: group page, executable.

Do not swap these IDs: reassigning the existing source ID from the subsidiary page to the group page would corrupt source history.

Group config:

```ts
"source-otsuka-china-social-2": {
  adapterId: "html-table",
  table: {
    rowSelector: ".join-list > .join-item",
    fields: {
      sourceJobIdParts: [
        { selector: ".table-td .career-title" },
        { selector: ".table-td .col2" }
      ],
      officialTitle: { selector: ".table-td .career-title" },
      officialUrl: { value: "https://www.otsuka.com.cn/join-us/index.html" },
      locationRaw: { selector: ".table-td .col2" }
    },
    staticPublicList: {
      containerSelector: ".join-list",
      nextControlSelector: ".join-list .pagination, .join-list a[rel='next'], .join-list [data-page]"
    }
  }
}
```

Current group evidence: 2 roles (`SSC IT高级经理`, `SSC运营经理`), both `中国上海`, no pagination controls.

For the subsidiary source, a future zero-safe config may use row selector `.positionBox > <verified-job-row-selector>`, but **must not** set `explicitEmptyState` to `.positionBox:empty`. Empty markup is not an explicit official zero. Until a real row schema or explicit zero text/API is found, omit its executable config and keep the source pending.

Result: group source auto-updates, company remains `核验中` and is not counted toward the stable-complete company threshold. Next easiest safe unblock is to inspect a future positive version of `/class/26` for its row schema or obtain an official endpoint/explicit empty declaration; do not drop the subsidiary surface and do not claim the group page covers it.

### 4. Grand Pharma (`company-grand-pharma`)

Correct the registry from the campus detail page to the public recruitment landing:

```ts
status: "VERIFIED_SCRAPABLE",
atsKind: "OFFICIAL_HTML",
socialEntryUrl: "https://job.grandpharma.cn/",
officialChainEvidenceUrl: "https://job.grandpharma.cn/",
campusEntryUrl: "https://job.grandpharma.cn/schooldetail.html"
```

Keep canonical identity `source-grand-pharma-social` / `surface-grand-pharma-social`. Delete the orphan config key `source-grand-pharma-china-social` and replace it with:

```ts
"source-grand-pharma-social": {
  adapterId: "html-table",
  table: {
    rowSelector: ".job-card:has(a[href='#login'])",
    fields: {
      sourceJobIdParts: [
        { selector: ".job-title" },
        { selector: ".job-meta span:nth-child(1)" }
      ],
      officialTitle: { selector: ".job-title" },
      officialUrl: { value: "https://job.grandpharma.cn/" },
      locationRaw: { selector: ".job-meta span:nth-child(1)" }
    },
    staticPublicList: {
      containerSelector: ".job-list",
      nextControlSelector: ".job-list .pagination, .job-list a[rel='next'], .job-list [data-page]",
      excludedPartitionSelectors: [".job-card:has(a[href='schooldetail.html'])"]
    }
  }
}
```

Current evidence: select exactly the 2 cards whose public action is `#login`; exclude the `管理培训生` campus card linked to `schooldetail.html`. The authenticated full portal behind login is outside the public completeness denominator. Do not navigate, authenticate, or claim it. Use the landing page as official URL because `#login` is not a job detail URL.

Eligible for stable automatic update only for the two publicly featured social cards, after two fresh lossless static-list observations. Release wording must disclose that the authenticated full portal and campus page are excluded.

## RED tests and verification order

Write failures first, then the minimum generic implementation, then configs/registry.

1. `tests/crawler/adapters.test.ts`
   - composite source IDs differ for same title/different location and are stable across whitespace/order-neutral fixture replay;
   - missing composite part and simultaneous single/composite ID fail closed;
   - certified explicit official zero succeeds with zero rows; unlabelled empty HTML still fails;
   - no parse loss, validation loss, or collision is accepted as completeness-qualified.
2. `tests/crawler/httpHtmlSourceFetch.test.ts`
   - exact one-page static list emits `COMPLETE_PAGE_TRAVERSAL=1`, `NEXT_ABSENT`, exact artifact hash, and verified-eligible pagination evidence;
   - matching next control, multiple/missing containers, row outside container, excluded-partition overlap, redacted body, or duplicate raw row fails closed;
   - empty container alone is noncertifying; explicit official zero text can emit `OFFICIAL_TOTAL_COUNT=0`/`EMPTY_PAGE`.
3. `tests/crawler/sourcePlan.test.ts` and `tests/crawler/sourcePlanChannels.test.ts`
   - canonical IDs replace both orphan keys;
   - exactly four executable positive source plans exist for this wave: Apeloa, Huahai, Otsuka group source 2, Grand;
   - Otsuka subsidiary source 1 has no staged plan;
   - each staged plan binds only `source:<sourceId>:default` as SOCIAL.
4. `tests/data/companyOfficialLinks.test.ts`, `tests/data/companyRegistry.test.ts`, and `tests/data/companyOracle.test.ts`
   - Otsuka has two sources/surfaces with preserved source-1 identity and official redirect-chain evidence;
   - Apeloa and Grand campus surfaces are recorded separately and cannot enter social plans;
   - current 30+30 roster and authorized exclusions remain unchanged.
5. Add four captured-byte fixture cases (sanitized exact HTML fragments, not live-network assertions) to `tests/crawler/adapters.test.ts` or a focused `tests/crawler/fourStaticOfficialSources.test.ts`:
   - counts 19/2/2/2;
   - Apeloa 12 campus rows excluded;
   - Grand campus card excluded;
   - Huahai third-party apply links never emitted;
   - Otsuka subsidiary empty container remains noncertifying.
6. Run the focused tests, then typecheck/lint/full test suite. Only after that run fresh staged source probes. Independent QA must fetch official bytes itself and compare selected titles/counts, page hashes, no-next evidence, and exclusions; the production adapter cannot self-certify.

## Allowed release wording

- Apeloa: “展示官网职业机会页当前公开的社会招聘列表；校园招聘分区不在本列表内。”
- Huahai: “展示官网招聘岗位页当前公开的岗位；第三方投递链接不作为职位来源。”
- Otsuka: “展示大冢中国集团官网当前公开的 2 个职位；中国大冢制药热招岗位入口仍在核验中，因此不声明大冢职位已抓全。”
- Grand Pharma: “展示官网招聘首页无需登录即可看到的社会招聘精选职位；登录后完整门户及校园招聘不在本期完整性范围内。”

Never say these sources cover hidden ATS tenants, authenticated jobs, third-party boards, campus recruitment, WeChat-only posts, or unlinked legal-entity channels.
