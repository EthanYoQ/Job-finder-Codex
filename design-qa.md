# Design QA

source visual truth:
- layout target: `docs/design/references/search-workbench-layout-reference.png`
- color/modal target: `docs/design/references/blue-consent-palette-reference.png`

implementation screenshot:
- pending consent: `docs/design/qa/task4-replica/pending-consent.png`
- accepted workbench: `docs/design/qa/task4-replica/accepted-workbench.png`
- closed locked state: `docs/design/qa/task4-replica/closed-locked.png`

viewport: 390 x 844

state: mobile, first-visit consent modal, accepted workbench, closed consent locked state

full-view comparison evidence:
- pending consent: `docs/design/qa/task4-replica/comparison-pending.png`
- accepted workbench: `docs/design/qa/task4-replica/comparison-accepted.png`
- closed locked state: `docs/design/qa/task4-replica/comparison-closed.png`

focused region comparison evidence:
- search and summary: `docs/design/qa/task4-replica/focus-search-summary.png`
- expanded job list: `docs/design/qa/task4-replica/focus-expanded-job.png`

findings:
- No remaining P0/P1/P2 findings.
- Fonts and typography: the implementation now uses the same compact hierarchy as the layout reference: inline product name and subtitle, small search controls, compact company rows, dense job titles, smaller English secondary titles, and no negative letter spacing. Residual P3: the generated source image has slightly lighter font rendering than Chromium text.
- Spacing and layout rhythm: the accepted state matches the target workbench structure: one-line header, single-row search/city/filter controls, chip row with `销售` / `MSL` / `只看新增`, summary card, pinyin sort, one rounded company list, `辉瑞` expanded by default, and `诺华` / `信达生物` visible near the bottom at 390 x 844.
- Colors and tokens: green visual affordances from the layout target were intentionally mapped to the blue palette from the color reference. Amber `新增` badges remain because both references use amber for new-job status.
- Image quality and assets: no product imagery is required. All icons are `lucide-react` line icons; there are no emoji, Unicode pseudo-icons, handcrafted SVG paths, CSS art icons, or placeholder drawings.
- Copy and content: visible UI is Chinese except `Job-search` and official English job titles. The page only shows the global crawl timestamp and does not show company-level crawl times or extra fields.
- Accessibility and interactions: first visit shows a centered modal, not a page section; closing the modal locks the app; users can reopen and accept. Search, chips, accordion, official links, and controls remain interactive after consent.

patches made since previous QA:
- Rebuilt the accepted workbench to match the layout reference instead of the earlier simplified blue-card layout.
- Removed the bottom navigation from this screen because it is not part of the selected layout reference.
- Restored the design-reference summary and list density: `128 个职位`, `5 家公司`, five company rows, and `辉瑞` expanded with five job rows.
- Added the visible `MSL` chip and MSL search alias while keeping the displayed job title aligned with the reference.
- Compressed typography, control widths, row heights, and official-link buttons to remove wrapping and match the reference density.

verification:
- `npm test -- tests/app/App.test.tsx` passed: 6 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

final result: passed
