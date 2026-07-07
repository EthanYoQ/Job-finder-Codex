# Design QA

source visual truth:
- layout target: `docs/design/references/search-workbench-layout-reference.png`
- color/modal target: `docs/design/references/blue-consent-palette-reference.png`

implementation screenshot:
- pending consent modal, 426 CSS px at 2x: `docs/design/qa/task4-polish/pending-modal-2x.png`
- accepted workbench, 426 CSS px at 2x: `docs/design/qa/task4-polish/accepted-workbench-2x.png`
- pending consent modal, 390 x 844: `docs/design/qa/task4-polish/pending-modal.png`
- accepted workbench, 390 x 844: `docs/design/qa/task4-polish/accepted-workbench.png`

viewport:
- primary QA viewport: 426 x 800, deviceScaleFactor 2, matching the 852 px wide reference images
- fallback mobile viewport: 390 x 844, deviceScaleFactor 1

state:
- mobile, first-visit consent modal
- mobile, accepted workbench after checking consent and clicking enter

full-view comparison evidence:
- accepted workbench: `docs/design/qa/task4-polish/comparison-accepted-2x.png`
- consent modal: `docs/design/qa/task4-polish/comparison-modal-2x.png`

focused region comparison evidence:
- search and summary typography: `docs/design/qa/task4-polish/focus-search-summary-2x.png`
- company and job typography: `docs/design/qa/task4-polish/focus-job-list-2x.png`

findings:
- No remaining P0/P1/P2 findings.
- Fonts and typography: implementation now uses the 426 px mobile width baseline, `system-ui` first in the font stack, root antialiasing, reduced optical weights, balanced headings, pretty body wrapping, and tabular numerals for dynamic counts/timestamps. Residual P3: rendered browser text remains crisper and slightly heavier than the generated visual reference.
- Spacing and layout rhythm: the workbench max width now matches the 852 px reference image at 2x. Search controls, chip row, summary card, company list, and expanded job rows align to the selected layout structure. Residual P3: the accepted-state comparison excludes the reference image's bottom privacy sheet because the implementation moves privacy confirmation into the separate modal state requested later.
- Colors and tokens: green visual affordances from the layout target are intentionally mapped to the blue palette from the color/modal target. Amber `新增` badges remain as the new-job marker.
- Surfaces and polish: cards and bordered controls now use layered shadow-border treatment instead of hard container borders, while row dividers remain real borders for list separation. Interactive controls use explicit transitions and `scale(0.96)` press feedback.
- Image quality and assets: no product imagery is required. All visible icons are `lucide-react` line icons; no emoji, Unicode pseudo-icons, handcrafted SVG paths, CSS-art icons, or placeholder drawings were introduced.
- Copy and content: visible UI remains Chinese except `Job-search` and official English job titles. The page only shows the global crawl timestamp and does not show company-level crawl times or extra operational fields.
- Accessibility and interactions: the first visit shows a centered confirmation modal; closing the modal keeps the app locked; users can reopen and accept. Search, chips, accordion, official links, and controls remain interactive after consent.

patches made since previous QA:
- Applied the `make-interfaces-feel-better` typography pass: root font smoothing, system UI font priority, text-wrap rules, tabular numerals, and lower optical weights for company/job/modal text.
- Applied the `make-interfaces-feel-better` surface pass: shadow-border variables for cards and controls, retained list dividers, and explicit transition properties instead of `transition: all`.
- Added `scale(0.96)` active feedback for buttons and official links.
- Changed the mobile workbench max width from 390 px to 426 px so the 852 px reference image compares at the correct 2x baseline.
- Regenerated full-view and focused QA screenshots under `docs/design/qa/task4-polish/`.

verification:
- `npm test` passed: 6 test files, 38 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run prisma:validate` passed.

final result: passed
