# Previously successful public UI binding contract

Source: the author of the 2026-10-11 15:34–15:37 UTC verification, reporting the
operations actually performed. The handoff was a human-readable retrospective,
not an original execution script or raw log. V1 used no browser calls. V2 later received explicit authorization for one bounded
public UI shape sample; its precise scope is recorded in OBSERVED_AX_GRAMMAR.json. No session/tab ID is copied. The safe facts manifest is separately
hash-checked in SOURCE_EVIDENCE.json.

## Actual interfaces and selectors

- First ordinary open: `cua.createBrowserTab("cdp", "https://job.orz.md")` in dot's
  cloud browser. First CUA initialization must contain only this supported entry
  call; read its returned documentation/state before further calls. An actual
  binder must be reviewed against current returned tool documentation.
- Fresh state: `tab.getAXState()`; actual actions include `tab.click(freshIndex)`.
  Never reuse an index from before an action, wait, reload, or changed snapshot.
- Consent: visible “使用前确认”, checkbox “我已阅读并同意 隐私政策 和 服务条款”,
  then a newly observed enabled “进入 Job-search”. Both first open and the single
  reload showed it in the successful run. Existing original privacy/terms were
  previously authorized; no new permission is inferred. Today's safe artifacts
  do not contain legal-link hrefs or document versions. In a subsequent read-only
  retrospective handoff, the original author confirmed that both consent AX
  states showed privacy Value `job.orz.md/privacy` and terms Value
  `job.orz.md/terms`, under the page `https://job.orz.md/`, with the same quoted
  checkbox/entry wording and no new-agreement notice. No extra href attribute
  read, full legal text, or version was recorded. The binder can recognize these
  already-authorized visible paths and wording, but cannot claim full-text or
  version equality from that evidence. Unknown/different structure or substantive
  new-terms notice holds. There is no mandatory full-document hash each run.
- Company expansion: the latest AX exposed “E5 武田中国 119 个职位” before reload,
  and “E5 武田中国 116 个职位” afterward. The actual implementation used the latest
  AX index, **not a tested getByRole locator**. The binder must resolve exactly
  one visible control for the fixed company from fresh AX, validate its count,
  then click that snapshot's index. V2 implements the numeric AX parser from that subsequent actual shape sample.
- View all: the actual control was “查看全部 119 个职位” / “查看全部 116 个职位”,
  clicked by the then-current AX index. The count must agree with the expanded
  target company. No pagination was used.
- Public rendered anchors were read by `tab.playwright.evaluate(() => ...)`, with no second argument/options/timeout, and
  `nodeRepl.write(JSON.stringify(...))` serialization, using this
  actually used read-only public DOM expression:

    Array.from(document.querySelectorAll('a'))
      .filter(a => a.href.startsWith('https://jobs.takeda.com/job/') && a.getClientRects().length)
      .map(a => ({
        officialUrl: a.href,
        officialTitle: (a.getAttribute('aria-label') || a.textContent || '')
          .replace(/^查看官方职位\s*/, '').trim(),
        sourceJobId: a.href.split('/').filter(Boolean).pop()
      }))

- Separately observed rendered original paragraphs used `tab.playwright.evaluate(() => ...)` with no second argument:

    Array.from(document.querySelectorAll('#jobs-company-takeda-china .job'))
      .filter(e => e.getClientRects().length)
      .map(e => ({
        sourceJobId: e.querySelector('a').href.split('/').filter(Boolean).pop(),
        renderedOriginalTitle: e.querySelector('p').innerText,
        renderedHeading: e.querySelector('h3').innerText
      }))

  `getClientRects` proves rendered layout, not simultaneous viewport visibility.
  The binder must require a bijection between these independent ID collections,
  detect duplicates/missing/orphan paragraphs before merging renderedOriginalTitle
  into each job, and retain literal original p text. It must not use a lossy map,
  hidden framework store, network response, title attribute, or aria label in
  place of the rendered paragraph. The h3 can include “官方城市尚未核实”; it is
  not itself the exact original title.
- Directory navigation was actually:
  `tab.playwright.getByRole('button',{name:'官方招聘目录',exact:true}).click()`.
  Observe after click and after bounded loading.
- Company filtering was actually:
  `tab.playwright.getByRole('searchbox',{name:'搜索已覆盖公司'}).fill('武田')`.
  Observe fresh visible state; a second normal state observation was needed in
  the successful post-reload path. Require the unique matching company card.
- The source card read also used `tab.playwright.evaluate(() => ...)`, with no second argument/options/timeout, and
  `nodeRepl.write(JSON.stringify(...))` serialization, using this expression:

    const e = document.getElementById('row-company-takeda-china');
    ({ company:'武田中国', text:e.innerText, officialEntry:e.querySelector('a').href })

  It contained “最近成功更新 2026-10-11 15:23 UTC” and the exact official entry
  in TARGET. The binder must verify rendered card presence, company identity,
  entry URL, and the source label before emitting sourceTime. It must extract
  the literal visible UTC minute; no <time datetime> was observed. Runtime TZ,
  browser locale, global last-update text, or another company's card is not
  evidence. Missing/unknown precision or timezone holds.
- The only refresh was `tab.reload()`. Read fresh state, repeat the existing
  consent flow, and re-expand. Do not pass cache flags or request a hidden API.

## Action to operation responsibilities

OPEN_HOME creates the normal fixed-origin tab. CHECK_EXISTING_CONSENT clicks only
its freshly observed existing checkbox. ENTER_EXISTING_CONSENT clicks only its
freshly observed enabled entry. WAIT_VISIBLE calls fresh visible-state observation
only. EXPAND_COMPANY and VIEW_ALL resolve current AX controls as above.
READ_LIST reads only the two approved rendered DOM collections and performs the
strict one-to-one merge. OPEN_DIRECTORY/FILTER_COMPANY use the tested role locators.
READ_SOURCE_TIME reads the shown card. RELOAD calls ordinary tab.reload once.
Every action returns a fresh validated observation, never inferred success.

## Actual chronology that the synthetic regression preserves

Initial expanded list: 119 including all three expected removals. The directory
**already** showed source minute 15:23 before reload. One reload then list 116;
all 116 IDs/anchor titles/visible original paragraphs/URLs matched; the removed
IDs were absent. The directory again showed 15:23. No old source-level minute was
observed. The old global 12:10 time is unrelated to this source-level comparison.
Neither cause of update nor cache behavior was diagnosed.
