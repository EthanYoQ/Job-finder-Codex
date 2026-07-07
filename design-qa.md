# Design QA

source visual truth:
- layout: `docs/design/references/search-workbench-layout-reference.png`
- color/modal: `docs/design/references/blue-consent-palette-reference.png`

implementation screenshot:
- pending consent: `docs/design/qa/task4/pending-consent.png`
- accepted workbench: `docs/design/qa/task4/accepted-workbench.png`
- closed locked state: `docs/design/qa/task4/closed-locked.png`

viewport: 390 x 844

state: mobile, first-visit consent, accepted workbench, closed consent locked state

full-view comparison evidence:
- pending consent: `docs/design/qa/task4/comparison-pending.png`
- accepted workbench: `docs/design/qa/task4/comparison-accepted.png`
- closed locked state: `docs/design/qa/task4/comparison-closed.png`

focused region comparison evidence:
- modal detail: `docs/design/qa/task4/focus-modal.png`
- expanded job detail: `docs/design/qa/task4/focus-expanded-job.png`

findings:
- No remaining P0/P1/P2 findings.
- Typography: hierarchy is clear at 390px, with stable Chinese font fallbacks and no negative letter spacing. Modal copy wraps more than the reference, but remains readable and is a P3 polish item rather than a blocking mismatch.
- Spacing/layout rhythm: mobile layout follows the selected workbench direction with search controls, selected chips, summary, grouped companies, one expanded company, and fixed bottom navigation. The accepted state intentionally reports filtered sample results (`2 个职位`, `2 家公司`) because visible default chips are active.
- Colors/tokens: page, modal, borders, primary blue, muted surfaces, and amber `新增` badge align with the blue reference palette.
- Image quality/assets: no raster product imagery is required by this app screen. Icons are from `lucide-react`; no emoji, Unicode pseudo-icons, handcrafted SVG, CSS art, or placeholder artwork was used.
- Copy/content: UI is Chinese except `Job-search` and official English job titles. Only the global crawl timestamp is shown; company crawl times and extra complexity are not shown.
- Accessibility/interactions: consent modal locks the app until accepted; closing the modal keeps the app unusable and allows reopening. Search, chips, accordion, official links, and bottom navigation are disabled or blocked while locked.

patches made since previous QA:
- Default expanded company set to `辉瑞` so the accepted workbench matches the selected design's expanded-company presentation.
- Visible default chips (`销售`, `只看新增`) now participate in filtering and summary counts.
- Job rows use a text/action two-column layout so `查看官方职位` is visible on mobile.
- Bottom navigation is fixed with reserved page bottom space to avoid covering primary job actions.

verification:
- `npm test` passed: 6 files, 38 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run prisma:validate` passed.
- Post-QA focused verification passed: `npm test -- tests/app/App.test.tsx`, `npm run typecheck`, `npm run build`.

final result: passed
