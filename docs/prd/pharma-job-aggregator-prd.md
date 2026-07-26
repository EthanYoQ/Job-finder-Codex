# 医药招聘聚合网页应用 PRD

## Product Goal

上线 Job Finder 一期：完整展示固定 30 家外资药企和 30 家国内药企的官方招聘入口；只展示来源可验证的官方职位；每天北京时间 00:01 更新一次；首次对外上线前至少 55 家达到稳定自动更新并通过上线门禁。不足 55 家时只允许受限的内部候选预览。

## Problem Statement

国内医药行业职位信息分散在各公司官网和官方招聘系统中。求职者想找某个城市的医药岗位时，需要逐家公司打开官网、定位招聘入口、区分社会招聘和校园招聘、筛选城市和岗位方向，流程低效且容易遗漏。

通用招聘平台存在更新滞后、虚假职位、官方性弱和覆盖不完整的问题。目标用户真正需要的是一个聚合页：先按城市和职位类别查看哪些公司正在招聘，再展开公司查看对应岗位，并跳转到官方招聘链接。

本产品不解决站内投递、简历管理、申请进度管理或招聘决策，只解决“官方职位发现与跳转”。

## Solution

建设一个移动端优先、兼容桌面的网页应用。首页即搜索聚合页，不做营销 landing page。首页是城市必选的职位发现工作台，首屏只承担一个核心任务：选择目标城市并查看该城市下有哪些公司正在招聘。未选择城市时，不展示空结果列表，只展示城市选择控件、覆盖说明、全站最后更新时间和简短数据说明。选择城市后，默认展示按公司聚合的结果。

用户进入网站前必须勾选同意《个人隐私政策》和《服务条款》。弹窗必须极简，只放一句说明、勾选框、政策/条款链接和进入按钮。进入后，用户必须选择城市，可选职位类别、关键词、公司筛选。搜索结果默认按公司聚合，并按公司中文名拼音 A-Z 排序。每家公司卡片显示匹配岗位数量；展开公司后直接展示极简岗位列表。岗位点击后跳转到官方岗位详情页；如果无法稳定拿到岗位详情页，则跳转到官方社招列表页或官方招聘入口页。

P0 公司范围固定为恰好 30 家外资药企和 30 家国内药企，不允许因抓取困难替换名单成员。60 家公司必须全部出现在公司目录中；职位发布始终按公司独立判定，单家公司的验证失败或待处理状态不阻断其他已验证公司的职位。首次对外上线仍须满足至少 55 家总门槛；首次上线完成后，日常更新不再设置全站最低公司数，确认抓全一家就更新一家。`company-humanwell` 与 `company-north-china-pharma` 仍是名单成员，并标记为用户授权的一期排除项；不得声称这两家公司的职位完整。

“稳定自动更新”不能只表示能打开招聘页。公司只有在其公开可访问、由官网可追溯或明确背书的官方社招范围连续两次成功稳定抓取后，才有资格自动发布职位；字段至少包含公司、岗位标题、官方来源链接、城市或地点信息。如果来源只提供列表页链接，也必须能保存官方入口和岗位标题作为可审计证据。资格数量、完成阈值和状态必须从当前记录动态计算，不得硬编码为通过结果。

已发布职位只能来自公司官方网站、官方招聘页面，或由上述网站明确背书的招聘系统。允许跟随官方链路进入 Moka、北森/Zhiye、Workday、SuccessFactors、Redsea 等 ATS。非官方招聘站只能作为发现线索，不能向前台供应职位。

抓取策略为确定性抓取优先。AI 分类、英文标题中文辅助翻译、异常判断和辅助清洗属于可选增强；增强不可用时回退到官方原始标题和基础类别，不得阻断已验证职位的资格计算或达到 55 家后的对外上线。不开公开 API，不提供全量导出。

首次上线前不足 55 家时，可用当前已验证子集做受限的内部候选预览，同时让未达到发布资格的公司继续以“验证中”“仅官方入口”“采集时未发现公开官方招聘入口”或“用户授权一期排除”等真实状态留在目录中。首次对外上线和正式完成一期需要至少 55 家公司达到稳定自动更新；其余公司不阻断达到门槛后的完成，并作为上线后持续工作。规则与公司配置冻结后只运行两轮最新验证；第二轮结束仍不足 55 家时暂停任务并通知用户，不启动第三轮，也不得降低首次上线门槛。首次上线后，即使某次日更的合格公司数降到 55 以下，仍继续发布本次成功且合格的公司；失败只影响对应公司，并触发运营告警和修复。

## User Stories

1. As a 医药行业求职者, I want to choose a city before searching, so that I only see jobs relevant to my target city.
2. As a 医药行业求职者, I want job category to be optional, so that I can browse all pharma jobs in a city when I am exploring broadly.
3. As a 医药行业求职者, I want to select multiple job categories, so that I can search adjacent functions such as 销售 and 市场 together.
4. As a 医药行业求职者, I want keyword search, so that I can search terms such as MSL, CRA, 肿瘤, 疫苗, KA, 市场准入.
5. As a 医药行业求职者, I want search results grouped by company, so that I can quickly see which companies are hiring.
6. As a 医药行业求职者, I want company groups sorted by Chinese pinyin A-Z by default, so that browsing feels predictable.
7. As a 医药行业求职者, I want optional sorting by latest posting or job count, so that I can switch to efficiency modes when needed.
8. As a 医药行业求职者, I want each company card to show the number of matching jobs, so that I can decide which companies to expand.
9. As a 医药行业求职者, I want company cards to expand into a simple job list, so that I can inspect openings without navigating away.
10. As a 医药行业求职者, I want job rows to stay minimal, so that the page remains easy to scan on mobile.
11. As a 医药行业求职者, I want job rows to show only job title, company, city/location, main category, posting/new marker, and official link, so that I can go to the official source for details.
12. As a 医药行业求职者, I want English job titles to use a Chinese auxiliary title when available, so that I can understand foreign-company roles more easily without hiding the official wording.
13. As a 医药行业求职者, I want the official title preserved and used as the fallback, so that unavailable translation never hides a verified job.
14. As a 医药行业求职者, I want company names shown in official Chinese names, so that I do not need to interpret English parent-company names.
15. As a 医药行业求职者, I want official links only, so that I can apply or verify on the company’s official recruitment page.
16. As a 医药行业求职者, I want multi-city jobs that include my city to appear, so that I do not miss regional or national roles.
17. As a 医药行业求职者, I want nationwide/China jobs to be included with a clear location marker, so that I can judge whether they may apply to me.
18. As a 医药行业求职者, I want location conflicts to be handled cautiously, so that a title containing 北京 but a source location saying 上海 does not mislead me.
19. As a 医药行业求职者, I want near-7-day new jobs to be marked after the baseline crawl, so that I can focus on new opportunities.
20. As a 医药行业求职者, I want a filter for near-7-day new jobs, so that repeat visits are efficient.
21. As a 医药行业求职者, I want the first baseline crawl not to mark everything as new, so that historical jobs are not mislabeled.
22. As a 医药行业求职者, I want the page to show one global last update time, so that I understand freshness without parsing multiple timestamps.
23. As a 医药行业求职者, I want a simple company coverage page, so that I can see which companies are covered.
24. As a 医药行业求职者, I want the company coverage page to list all fixed 60 companies, their official links, and a truthful publishing state, so that pending companies remain visible without implying job completeness.
25. As a 医药行业求职者, I want company search on the coverage page, so that I can quickly find 信达、诺华、辉瑞.
26. As a 医药行业求职者, I want to submit feedback anonymously, so that I can report wrong links, missing companies, category errors, or stale jobs.
27. As a 医药行业求职者, I want to recommend a company, so that the coverage list can improve over time.
28. As a site operator, I want a company source table with official chain evidence, so that every source can be audited.
29. As a site operator, I want social recruitment and campus recruitment separated, so that P0 only shows social jobs while still recording campus entry points.
30. As a site operator, I want every fixed-roster company to have an inclusion reason and evidence source, so that the list is maintainable.
31. As a site operator, I want an internal candidate preview of the verified subset while Phase 1 remains closed until at least 55 companies are stably auto-updating, so that individual failures are isolated without weakening the external launch threshold.
32. As a site operator, I want crawl status per company, so that I can identify sources that need adaptation.
33. As a site operator, I want manual re-crawl per company, so that I can recover from source changes.
34. As a site operator, I want crawl failures grouped by reason, so that debugging is actionable.
35. As a site operator, I want jobs missing from two consecutive successful crawls hidden from the front end, so that users do not waste time on stale openings.
36. As a site operator, I want missing-count logic to ignore failed crawls, so that transient source failures do not incorrectly remove jobs.
37. As a site operator, I want AI classification confidence and rationale saved when AI enrichment runs, so that low-confidence cases can be reviewed without making AI a publishing dependency.
38. As a site operator, I want low-confidence or unavailable enrichment to fall back to a basic category such as 其他, so that verified jobs are not hidden.
39. As a site operator, I want human corrections stored, so that category quality improves over time.
40. As a site operator, I want available translation results cached and editable, so that the front end does not translate at request time and can fall back safely when translation is unavailable.
41. As a site operator, I want an admin login, so that source data and manual corrections are protected.
42. As a site operator, I want user feedback stored with abuse signals, so that feedback remains useful without inviting spam.
43. As a site operator, I want privacy consent required before use, so that data collection is explicit.
44. As a site operator, I want service terms to prohibit crawling and commercial reuse, so that usage boundaries are clear.
45. As a site operator, I want anti-scraping controls, so that others cannot easily copy the aggregated dataset.
46. As a site operator, I want minimal static SEO for the homepage and company coverage entry, so that the product can be discovered without exposing searchable job-result data before consent.
47. As a site operator, I want API, deep pagination, admin, and batch endpoints excluded from indexing, so that SEO does not expose bulk data paths.
48. As a developer, I want normalized job records from all adapters, so that the search page does not depend on source-specific logic.
49. As a developer, I want source adapters tested at the contract level, so that each official source proves it can produce normalized jobs.
50. As a developer, I want one scheduled crawl at 00:01 China time each day, so that the site stays fresh without overloading sources.
51. As a developer, I want Docker Compose deployment, so that the stack is portable across Aliyun Korea or another VPS.
52. As a developer, I want PostgreSQL as the P0 database, so that source state, jobs, logs, and search indexes stay in one reliable store.
53. As a developer, I want PostgreSQL full-text search first, so that P0 avoids premature Elasticsearch/Meilisearch complexity.
54. As a developer, I want daily encrypted or restricted backups, so that company/source data and corrections can be restored.
55. As a developer, I want lightweight monitoring and alerts, so that crawl failures, backup failures, downtime, and abuse are visible.

## Implementation Decisions

- P0 is a public web application, mobile-first and desktop-compatible.
- The company roster is immutable and contains exactly 30 foreign pharmaceutical companies plus exactly 30 domestic pharmaceutical companies; no company may be substituted to make readiness pass.
- Every roster company appears in the directory. Automatic job publishing eligibility is evaluated per company, so a failed or pending company does not suppress another company's verified jobs or internal preview; external launch still requires at least 55 stable companies.
- `company-humanwell` and `company-north-china-pharma` remain roster members with `USER_AUTHORIZED_PHASE1_EXCLUSION`; no job-completeness claim is made for either company.
- Homepage is the job aggregation search page.
- Homepage is a city-required job discovery workspace. Before city selection, the page must not show an empty result list.
- Mobile information priority is: city selection, result summary, company-grouped results, optional filters.
- On mobile, job category, keyword, company filter, sorting, and new-job filter default into a filter entry rather than being fully expanded on first screen.
- Job category filtering uses a collapsed filter panel with searchable multi-select. The 17 categories must not be fully spread across the first mobile screen.
- Selected non-city filters appear as compact chips and can be cleared without resetting the city.
- Sorting appears only after results exist and must not be a primary first-screen action.
- City is required. Job category, keyword, and company are optional filters.
- Job category supports multi-select.
- P0 categories are: 销售, 市场, 商务, 渠道, KA, 医学事务, 临床运营, 注册, 药物警戒/安全, 研发/科学, 生产/工程, 质量, 市场准入/政府事务, 数据/IT, 供应链/采购, 职能, 其他.
- 商务、渠道、KA are separate categories and must not be merged into 销售.
- 市场 category excludes “商业化” wording in the UI.
- Compliance and Legal are grouped into 职能.
- PV/Drug Safety/Patient Safety are 药物警戒/安全. EHS is not.
- 医学信息沟通专员、医学信息沟通经理、医学信息沟通大区经理、医药代表、学术代表 are 销售.
- MSL, Medical Advisor, 医学经理 are 医学事务.
- CRA, CRC, CTA, Clinical Trial, Study Manager, Clinical Project Manager are 临床运营.
- Registration, RA, Regulatory Affairs, 注册申报, CMC 注册 are 注册.
- Product/Brand/Marketing Manager/Director roles are 市场 unless they are technical/data product roles.
- AI classification is optional enrichment, not a launch or publishing dependency. When it runs, only a small set of high-risk hard rules is allowed and its output stores main category, optional secondary category, confidence, rationale, model version, hard-rule hit, and human correction fields.
- Low-confidence or unavailable classification falls back to a basic category such as 其他; it must not hide an otherwise verified official job.
- Cached Chinese auxiliary translation may be shown when available and sufficiently reliable. The official title is always preserved and becomes the primary fallback when translation is unavailable.
- Terms clarify that auxiliary Chinese titles are for reference and the official source prevails.
- Front end displays official Chinese company name only.
- Company aggregation is by official Chinese company name, not by parent company, brand, or business unit.
- Company cards default sort by pinyin A-Z. Optional sort modes are latest posting and job count.
- Company card collapsed state shows only company Chinese name, matching job count, optional new-job hint, and expand control.
- Company card expanded state shows the minimal job list only.
- For companies with many matching jobs, the expanded state initially shows a limited number of rows and provides a “查看更多本公司岗位” control. The first implementation should default to a small mobile-friendly page size and enforce a hard server-side cap per company expansion request.
- “查看更多本公司岗位” must be controlled loading, not infinite deep pagination. It must not expose bulk enumeration, stable export paths, or a public API-like contract.
- Jobs inside a company are sorted by official publish date descending, then title pinyin when publish date is missing.
- Company expansion directly lists jobs. P0 does not do company-internal search or complex second-level grouping.
- P0 does not show salary, education, experience, job summary, raw department, source category, confidence, or source technical details on job rows.
- Official link priority: official job detail page, then official social recruitment list with instruction to search title, then official recruitment entry page.
- Company coverage page shows all fixed 60 company names, official website or official recruitment links, and a truthful company state, sorted by pinyin A-Z, with simple company-name search. Allowed states include verifying, official-link-only, no public official careers link at capture time, and user-authorized exclusion.
- Company coverage page, feedback entry, privacy policy, service terms, and company recommendation are supporting flows. They must not interrupt the main city-to-company-to-job discovery flow.
- Coverage page entry belongs in global navigation or footer, not in the primary search controls.
- Feedback is primarily contextual: report a problem from a company card or job row, automatically carrying company and job context when available. Global feedback remains secondary and belongs in footer or auxiliary navigation.
- Company recommendation does not enter the homepage main path and submitted companies stay in admin review; recommendations cannot alter the fixed P0 roster without separate scope authorization.
- P0 does not show company type labels on the front end.
- P0 does not provide saved jobs, subscriptions, email alerts, maps, multilingual UI, or public APIs.
- Baseline crawl is not considered “new.” New-job labels start after the baseline.
- Jobs missing from two consecutive successful source crawls are hidden from front end and marked suspected offline in admin. Three consecutive successful misses mark them offline. Failed crawls do not increment missing count.
- Crawl schedule is once daily at 00:01 China time, with manual per-company crawl from admin.
- A company becomes eligible for automatic job publishing only after two consecutive successful, stable crawls of its publicly reachable official social-recruitment scope. Eligibility, stable-company counts, and the at-least-55 threshold are calculated from records rather than hard-coded pass totals.
- A published company becomes stale 30 hours after its last complete successful scheduled crawl. Explicit failure hides its jobs immediately; staleness or failure preserves the stored records but returns the company to a verifying state.
- Deployment target is portable Docker Compose: web app, PostgreSQL, worker, reverse proxy.
- P0 server sizing target is stable operation on 4 vCPU / 8 GB RAM. Current 2 vCPU / 2 GB server is suitable only for prototype validation.
- Database is PostgreSQL. Search uses PostgreSQL indexes and full-text search for P0.
- Backups run daily, retain 7-14 days, and support one-command restore.
- Monitoring covers uptime, CPU, memory, disk, PostgreSQL health, backups, crawl success rate, per-company failures, certificate expiry, and abnormal traffic.
- Alerts: website down and backup failure alert immediately; per-company crawl failure alerts after three consecutive failures; global crawl success below 80% alerts.
- Security posture is strong protection without breaking normal use: no public API, no bulk export, paginated internal APIs, request throttling, bot/challenge handling for suspicious behavior.
- SEO exposure is intentionally minimal for P0. Search-result pages, city/category result pages, deep pagination, combined filter pages, internal query APIs, admin routes, batch paths, and raw data endpoints must not be indexed.
- Before privacy consent, the site may expose only privacy policy, service terms, and a static homepage shell that does not load job-result data or operational analytics. Company coverage and job search require consent.
- SEO pages must not provide full datasets, stable query contracts, bulk navigation, or official job result lists.
- Internal APIs are implementation details, not public product capabilities.
- Recommended protection path is Cloudflare or equivalent WAF/CDN/rate-limiting in front of a locked-down origin. Aliyun Korea can remain origin if domestic access is acceptable.
- The deployment should not rely on Aliyun-specific services as core dependencies.
- First-visit modal is minimal: one sentence, a checkbox agreeing to privacy policy and service terms, and an enter button.
- Users who do not agree cannot use the website.
- Privacy policy and service terms links must be accessible before consent and must not load job-result data.
- Privacy policy must state data retention periods, deletion/export contact or process, backend access controls, data categories, data purposes, and anti-scraping/security logging.
- Service terms explicitly prohibit crawling, bulk copying, resale, and commercial reuse of site data.
- Front-end job CTAs must use “查看官方职位” or “去官方招聘页.” The site must not use “立即投递” or “申请职位,” because those imply in-site application.
- Data collection is split into necessary security data and operational analytics data.
- The product records IP, User-Agent, request path, timestamps, throttling/anti-scraping events, search city, category, keyword, company expansion, official link clicks, sorting mode, and referral page subject to policy disclosure.
- The Korean-server cross-border compliance question remains unverified and must be reviewed separately before public launch.
- Before the first external launch, a verified subset below 55 companies may be used only for a restricted internal candidate preview. Initial external launch and formal Phase 1 completion require at least 55 companies to be stably auto-updating. After initial release, daily publication remains per-company and does not shut down successful companies when the current total drops below 55.
- Daily 00:01 China-time scheduling, last-success timestamps, failed-crawl non-deletion, search, official outbound links, basic security/privacy, backup/restore, monitoring, deployment, and final independent read-only QA remain release requirements.
- `job.orz.md`, AI classification, auxiliary translation, advanced manual operations, cryptographic oracle/signature work, independent QA after every stage, and rebuilding all evidence after every change are not internal-preview or Phase 1 launch blockers. Existing implementations may remain, and change impact determines which evidence must be refreshed.

The implementation must use record-derived staged readiness in `phase1` mode plus staged public-data quality as local evidence for per-company eligibility and the formal Phase 1 threshold. A company source status label alone is not enough: the checks must derive the fixed-roster denominator, authorized exclusions, configured crawl scope, two latest consecutive successful stable observations, and actual public job projection from current records. A company that fails remains in a truthful non-publishing state. The below-55 internal-only rule applies to first-launch qualification, not to routine per-company publication after release.

## Testing Decisions

- Primary test seam is the source adapter contract. Each supported source must prove it can return normalized job records from an official source URL, recorded payload, browser DOM, or API response.
- Adapter tests verify external behavior: company, title, canonical official URL, location, source job ID when available, publish date when available, source type, crawl status, and raw evidence.
- Tests should not assert parser implementation details.
- Source adapters are grouped by type: static HTML/table, official JSON/API, Moka, 北森/Zhiye, Workday, SuccessFactors, Redsea, and browser fallback.
- Browser-backed smoke tests are slower and should be used only where HTTP/API extraction is insufficient.
- When AI classification is available, classification tests use real pharma examples, especially high-risk cases: 医学信息沟通 vs 医学事务, PV vs EHS, Product Manager as market vs technical product, KA vs sales, channel vs business. Fallback tests verify unavailable or low-confidence enrichment does not hide verified jobs.
- Translation tests verify official-title preservation, cached Chinese auxiliary title behavior, and original-title fallback when translation is unavailable.
- Search tests verify city-required behavior, multi-category filtering, keyword all-match behavior, company filtering, pinyin company sorting, latest/job-count sorting, new-job filtering, and no-results relaxation prompts.
- Frontend tests verify mobile flows: consent modal, city selection, category filter, company-grouped results, company expansion, official link click, coverage page search, feedback submission.
- Frontend accessibility tests verify mobile touch target size, focus management in filter panels, keyboard dismissal for modal/drawer flows, and screen-reader-readable expanded/collapsed states.
- No-results tests verify that the page offers only concise relaxation actions: clear job category, clear keyword, or view all companies for the selected city.
- Offline lifecycle tests verify baseline behavior, new labels after baseline, two-successful-miss hiding, failed-crawl no-op, three-successful-miss offline, and reappearance recovery.
- Publishing-state tests verify all 60 companies remain visible, the two authorized exclusions are disclosed without completeness claims, and one company's failure cannot suppress another eligible company's jobs or qualification; external launch remains blocked below 55 stable companies.
- Security tests verify no public API exposure, controlled company expansion limits, pagination limits, rate limits, robots rules, challenge triggers for suspicious request patterns, and admin authentication.
- Backup tests verify scheduled backup creation and restore command on a test database.
- Monitoring tests verify alert triggers for website down, backup failure, global crawl success below threshold, and per-company repeated failures.

## Out of Scope

- In-site job application.
- Resume management, resume parsing, resume matching, or application tracking.
- User accounts for job seekers.
- Job saving, favorites, subscriptions, or email alerts.
- Recruiter-side tools.
- Public data API or bulk export.
- Full job detail pages on this site.
- Salary, education, experience, job summary, or detailed responsibilities on front-end job rows.
- Medical device and medical aesthetics company coverage in P0.
- Regional small pharma companies in P0.
- Company type filtering or labels on the front end.
- Maps or city distribution visualization.
- Multilingual UI.
- Guaranteed coverage of every domestic pharma company.
- Legal determination of crawl rights for every source.
- Full compliance sign-off for personal information cross-border handling.

## Further Notes

Research input is captured in `docs/research/p0-company-and-reuse-research.md`. These research notes and prior RC artifacts remain historical evidence only; they do not prove current deployment or current job data.

Initial GitHub research found useful reusable modules for Crawlee/Playwright-style crawling, Workday-specific scraping, generic job scraping, rate limiting, and server protection. It did not find mature open-source adapters specifically for Moka, 北森/Zhiye, or Redsea official recruitment systems. The current candidate conclusion is that those ATS adapters likely need to be built, while queueing, Playwright crawling, rate limiting, and server security should reuse mature libraries or infrastructure.

Representative official source tests already performed:

- AstraZeneca China career search: readable result list and AJAX endpoint.
- Novartis China career search: readable table.
- HengRui Moka: browser and direct reader extraction worked; text cleaning required.
- BeiGene Moka: browser and direct reader extraction worked.
- Fosun Zhiye: structured table worked.
- CTTQ Zhiye: direct reader and browser scrolling worked.
- CSPC Redsea: page did not render job list, but network response returned structured job JSON.
- Junshi: official recruiting page found; current job rows not yet validated.
- Innovent: official homepage and user-provided path known; social/campus entry needs browser validation.

Issue tracker publishing was not performed because this workspace does not currently expose an issue tracker configuration or triage label vocabulary. This Markdown PRD is the local source of truth until issue integration is configured.
