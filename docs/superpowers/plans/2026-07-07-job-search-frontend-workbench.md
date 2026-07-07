# Job-search Frontend Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first responsive frontend for `Job-search`: a mobile-first pharma official-job search workbench matching the selected visual direction.

**Architecture:** Add a React/Vite frontend inside the existing TypeScript project, keeping domain contracts separate from UI components. The app uses static realistic sample data for P0 frontend behavior, no backend API, no public data export, and no crawler/admin implementation in this phase.

**Tech Stack:** React, Vite, TypeScript, Vitest, Testing Library, CSS modules/plain CSS, lucide-react icons.

## Global Constraints

- Visual target uses `docs/design/references/search-workbench-layout-reference.png` for structure and `docs/design/references/blue-consent-palette-reference.png` for color/modal style.
- Layout follows the first design batch's second direction: search-workbench with keyword search, city selector, filter button, selected chips, summary card, company grouped result list, and one expanded company.
- Color system follows the blue version: cool white / pale blue-gray background, deep ink text, medical blue primary, blue-gray borders, amber `新增` badges.
- The privacy declaration is a first-visit overlay modal, not a page section.
- Privacy modal has a close button. Closing it must keep the page locked and unusable until the user reopens/accepts consent.
- Users who do not consent cannot use search, filters, company expansion, official-link clicks, or bottom navigation.
- P0 frontend displays social recruitment jobs only.
- City is required; job category, keyword, company filter, sort, and new-job filter are optional.
- Only show one global freshness timestamp: `全站最后抓取 2026-07-07 08:00`.
- Company results are grouped by official Chinese company name and default sorted by pinyin A-Z.
- Company expansion uses controlled visible rows; no deep pagination, no public API, no export affordance.
- Do not show salary, education, experience, job summaries, company type labels, source technical details, or crawl status details.
- UI copy is Chinese except the product name `Job-search` and official English job titles shown as secondary text.
- UI icons must come from a traceable icon library. Use `lucide-react` line icons; do not handwrite SVG paths, emoji, Unicode pseudo-icons, or CSS art icons.
- No marketing landing page, hero illustration, decorative blobs, or large gradient art.

---

## File Structure

- `package.json`: add frontend scripts and dependencies.
- `tsconfig.json`: enable DOM and JSX compilation.
- `vite.config.ts`: Vite React build and Vitest config.
- `index.html`: frontend mount shell.
- `src/main.tsx`: React entrypoint.
- `src/app/App.tsx`: app composition, state, consent lock, filters, company accordion.
- `src/app/App.css`: visual implementation for the selected mobile-first design.
- `src/app/jobData.ts`: static realistic sample companies/jobs for the frontend prototype.
- `src/app/jobSearch.ts`: pure search/filter/sort helpers.
- `tests/app/jobSearch.test.ts`: pure helper tests.
- `tests/app/App.test.tsx`: UI behavior tests.
- `test.setup.ts`: Testing Library matcher setup.
- `design-qa.md`: Product Design QA report produced after screenshot comparison.

---

### Task 1: Frontend Harness And Test Setup

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Replace: `vitest.config.ts`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `test.setup.ts`
- Test: existing `tests/domain/*.test.ts`, `tests/prisma/schema.test.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, React/Vite entrypoint, jsdom-enabled UI tests.
- Later tasks consume the frontend harness to add components and tests.

- [ ] **Step 1: Install frontend dependencies**

Run:

```bash
npm install react react-dom lucide-react
npm install -D @vitejs/plugin-react @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Expected: package files update and install exits 0.

- [ ] **Step 2: Update scripts and test dependencies**

Update `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prisma:validate": "node ./scripts/prisma-validate.mjs"
  }
}
```

Expected dependencies:

```json
{
  "dependencies": {
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.25.0"
  }
}
```

Expected dev dependencies include:

```json
{
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "prisma": "^6.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Update TypeScript config**

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx", "vite.config.ts", "vitest.config.ts", "test.setup.ts"]
}
```

- [ ] **Step 4: Replace Vitest config with Vite config re-export**

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./test.setup.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
```

Replace `vitest.config.ts`:

```ts
export { default } from "./vite.config";
```

- [ ] **Step 5: Add test setup**

Create `test.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Add initial React mount files**

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="Job-search，中国医药官方职位聚合。按城市查看官方招聘信息。"
    />
    <title>Job-search | 中国医药官方职位聚合</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function PlaceholderApp() {
  return <main>Job-search</main>;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <PlaceholderApp />
  </StrictMode>
);
```

- [ ] **Step 7: Run baseline verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts test.setup.ts index.html src/main.tsx
git commit -m "chore: add frontend app harness"
```

Expected: commit created.

---

### Task 2: Search Workbench Data And Pure Behavior

**Files:**
- Create: `src/app/jobData.ts`
- Create: `src/app/jobSearch.ts`
- Create: `tests/app/jobSearch.test.ts`

**Interfaces:**
- Produces: `companies`, `filterJobs(request)`, `sortCompanies(companies, sortMode)`, `SearchFilters`, `CompanyResult`, `JobResult`.
- Later UI consumes these helpers without embedding filtering logic in React components.

- [ ] **Step 1: Write failing pure tests**

Create `tests/app/jobSearch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterJobs, sortCompanies } from "../../src/app/jobSearch";

describe("frontend job search helpers", () => {
  it("requires a city before returning company results", () => {
    expect(filterJobs({ city: "", keyword: "", categories: [], onlyNew: false })).toEqual([]);
  });

  it("returns Beijing jobs grouped by company with category and keyword filters", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "MSL",
      categories: ["医学事务"],
      onlyNew: false
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.companyName).toBe("辉瑞");
    expect(results[0]?.jobs.map((job) => job.title)).toContain("MSL 医学科学联络官");
  });

  it("filters near-seven-day new jobs without treating all baseline jobs as new", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: true
    });

    expect(results.flatMap((company) => company.jobs).every((job) => job.isNew)).toBe(true);
    expect(results.flatMap((company) => company.jobs)).not.toHaveLength(0);
  });

  it("sorts companies by pinyin A-Z by default", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: false
    });

    expect(sortCompanies(results, "PINYIN_ASC").map((company) => company.companyName)).toEqual([
      "阿斯利康",
      "百济神州",
      "辉瑞",
      "诺华",
      "信达生物"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/app/jobSearch.test.ts
```

Expected: FAIL because `src/app/jobSearch.ts` does not exist.

- [ ] **Step 3: Implement sample data**

Create `src/app/jobData.ts`:

```ts
export interface JobResult {
  id: string;
  title: string;
  officialTitle?: string;
  city: string;
  category: string;
  isNew: boolean;
  officialUrl: string;
}

export interface CompanyResult {
  id: string;
  companyName: string;
  pinyin: string;
  jobs: JobResult[];
}

export const companies: CompanyResult[] = [
  {
    id: "astrazeneca",
    companyName: "阿斯利康",
    pinyin: "a si li kang",
    jobs: [
      {
        id: "az-sales-beijing",
        title: "区域销售经理（北京）",
        officialTitle: "Regional Sales Manager (Beijing)",
        city: "北京",
        category: "销售",
        isNew: true,
        officialUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c"
      }
    ]
  },
  {
    id: "beigene",
    companyName: "百济神州",
    pinyin: "bai ji shen zhou",
    jobs: [
      {
        id: "beigene-clinical",
        title: "临床研究监察员（CRA）",
        officialTitle: "Clinical Research Associate (CRA)",
        city: "北京",
        category: "临床运营",
        isNew: true,
        officialUrl: "https://app.mokahr.com/social-recruitment/BeiGene"
      }
    ]
  },
  {
    id: "pfizer",
    companyName: "辉瑞",
    pinyin: "hui rui",
    jobs: [
      {
        id: "pfizer-medical-info",
        title: "医学信息沟通专员（呼吸领域）",
        officialTitle: "Medical Information Associate (Respiratory)",
        city: "北京",
        category: "销售",
        isNew: true,
        officialUrl: "https://www.pfizer.com.cn/careers"
      },
      {
        id: "pfizer-msl",
        title: "MSL 医学科学联络官",
        officialTitle: "Medical Science Liaison (Oncology)",
        city: "北京",
        category: "医学事务",
        isNew: false,
        officialUrl: "https://www.pfizer.com.cn/careers"
      },
      {
        id: "pfizer-market-access",
        title: "市场准入专员",
        officialTitle: "Market Access Specialist",
        city: "北京",
        category: "市场准入",
        isNew: false,
        officialUrl: "https://www.pfizer.com.cn/careers"
      }
    ]
  },
  {
    id: "novartis",
    companyName: "诺华",
    pinyin: "nuo hua",
    jobs: [
      {
        id: "novartis-product",
        title: "肿瘤产品医药代表",
        officialTitle: "Oncology Product Representative",
        city: "北京",
        category: "销售",
        isNew: false,
        officialUrl: "https://www.novartis.com.cn/careers/career-search/tag/LOC_CN?page=0"
      }
    ]
  },
  {
    id: "innovent",
    companyName: "信达生物",
    pinyin: "xin da sheng wu",
    jobs: [
      {
        id: "innovent-sales",
        title: "高级医学信息沟通经理",
        officialTitle: "Senior Medical Information Manager",
        city: "北京",
        category: "销售",
        isNew: false,
        officialUrl: "https://cn.innoventbio.com/"
      }
    ]
  }
];
```

- [ ] **Step 4: Implement helpers**

Create `src/app/jobSearch.ts`:

```ts
import { companies, type CompanyResult } from "./jobData";

export interface SearchFilters {
  city: string;
  keyword: string;
  categories: string[];
  onlyNew: boolean;
}

export type SortMode = "PINYIN_ASC" | "LATEST" | "JOB_COUNT_DESC";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function filterJobs(filters: SearchFilters): CompanyResult[] {
  const city = filters.city.trim();
  if (!city) return [];

  const keyword = normalized(filters.keyword);
  const categories = new Set(filters.categories);

  return companies
    .map((company) => ({
      ...company,
      jobs: company.jobs.filter((job) => {
        const cityMatches = job.city === city || job.city === "全国" || job.city === "中国";
        const keywordMatches =
          !keyword ||
          normalized(job.title).includes(keyword) ||
          normalized(job.officialTitle ?? "").includes(keyword) ||
          normalized(company.companyName).includes(keyword) ||
          normalized(job.category).includes(keyword);
        const categoryMatches = categories.size === 0 || categories.has(job.category);
        const newMatches = !filters.onlyNew || job.isNew;

        return cityMatches && keywordMatches && categoryMatches && newMatches;
      })
    }))
    .filter((company) => company.jobs.length > 0);
}

export function sortCompanies(
  companyResults: CompanyResult[],
  sortMode: SortMode
): CompanyResult[] {
  const sorted = [...companyResults];

  if (sortMode === "JOB_COUNT_DESC") {
    return sorted.sort((left, right) => right.jobs.length - left.jobs.length);
  }

  return sorted.sort((left, right) => left.pinyin.localeCompare(right.pinyin, "zh-CN"));
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- tests/app/jobSearch.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/app/jobData.ts src/app/jobSearch.ts tests/app/jobSearch.test.ts
git commit -m "feat: add frontend search helpers"
```

Expected: commit created.

---

### Task 3: Search Workbench UI And Consent Lock

**Files:**
- Replace: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/App.css`
- Create: `tests/app/App.test.tsx`

**Interfaces:**
- Consumes: `filterJobs`, `sortCompanies`, sample `CompanyResult`.
- Produces: interactive mobile search workbench with consent modal, locked state, filters, company accordion, and official links.

- [ ] **Step 1: Write failing UI tests**

Create `tests/app/App.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";

describe("Job-search frontend app", () => {
  it("shows a first-visit consent modal and locks the page until consent is accepted", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入 Job-search" })).toBeDisabled();
    expect(screen.getByRole("main")).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));

    expect(screen.queryByRole("dialog", { name: "使用前确认" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the page unusable when the consent modal is closed", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));

    expect(screen.queryByRole("dialog", { name: "使用前确认" })).not.toBeInTheDocument();
    expect(screen.getByText("使用前请先完成确认")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByRole("button", { name: "重新打开确认" }));
    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();
  });

  it("renders the selected search workbench content after consent", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));

    expect(screen.getByText("Job-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /北京/ })).toBeInTheDocument();
    expect(screen.getByText("全站最后抓取 2026-07-07 08:00")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("5 家公司")).toBeInTheDocument();
  });

  it("filters jobs by keyword and expands companies", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));
    await user.clear(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒"));
    await user.type(screen.getByPlaceholderText("职位关键词，如：医学代表、药物警戒"), "MSL");

    const pfizer = screen.getByRole("button", { name: /辉瑞/ });
    await user.click(pfizer);

    expect(screen.getByText("MSL 医学科学联络官")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看官方职位" })).toHaveAttribute(
      "href",
      expect.stringContaining("pfizer")
    );
  });

  it("clears selected filters without resetting the required city", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(screen.queryByText("MSL")).not.toBeInTheDocument();
    expect(screen.queryByText("只看新增")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /北京/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/app/App.test.tsx
```

Expected: FAIL because `src/app/App.tsx` does not exist.

- [ ] **Step 3: Implement React app**

Create `src/app/App.tsx` with these required state names and behaviors:

```tsx
type ConsentState = "pending" | "closed" | "accepted";
const [consentState, setConsentState] = useState<ConsentState>("pending");
const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
const isLocked = consentState !== "accepted";
```

The component must render:

- `main` with `aria-hidden={isLocked ? "true" : undefined}`.
- A modal `role="dialog"` and `aria-label="使用前确认"` when `consentState === "pending"`.
- A close button with accessible name `关闭确认弹窗`.
- A locked overlay message `使用前请先完成确认` and button `重新打开确认` when `consentState === "closed"`.
- Search controls matching the visual reference.
- Company accordion where `expandedCompanyId` toggles.
- Official job actions as `<a>` elements with `target="_blank"` and `rel="noreferrer"`.

Create `src/app/App.css` implementing:

- mobile-first `390px` target with responsive desktop max-width wrapper.
- color tokens:
  - `--color-page: #f4f7fb`
  - `--color-surface: #ffffff`
  - `--color-surface-muted: #eef3f8`
  - `--color-ink: #111827`
  - `--color-muted: #667085`
  - `--color-primary: #1f5fd1`
  - `--color-primary-dark: #174aa5`
  - `--color-border: #c9d4e5`
  - `--color-new: #d97706`
- modal center overlay, close button, disabled locked state.
- no border radius above `8px` except modal may use `10px` only if needed for visual fidelity.

- [ ] **Step 4: Wire the real app entrypoint**

Replace `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
npm test -- tests/app/App.test.tsx tests/app/jobSearch.test.ts
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main.tsx src/app/App.tsx src/app/App.css tests/app/App.test.tsx
git commit -m "feat: build search workbench UI"
```

Expected: commit created.

---

### Task 4: Local Preview And Product Design QA

**Files:**
- Create: `design-qa.md`
- Optional modify: `src/app/App.css`, `src/app/App.tsx` only for QA fixes.

**Interfaces:**
- Consumes: selected visual target references and built app.
- Produces: running local app and `design-qa.md` with `final result: passed`.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
```

Expected: all commands pass.

- [ ] **Step 2: Start local server**

Run:

```bash
npm run dev -- --port 5173
```

Expected: Vite serves the app at `http://127.0.0.1:5173/`.

- [ ] **Step 3: Capture app at selected state**

Use the Product Design browser order. Preferred browser tools are Browser plugin, then Chrome plugin. If neither is available, use Playwright only if the user has already allowed browser automation in this project thread.

Capture:

- `390 x 844` viewport.
- First-visit `pending` state showing the consent modal.
- Accepted state after checking consent and pressing `进入 Job-search`.
- Closed state after pressing close button, showing locked page.

- [ ] **Step 4: Write design QA report**

Create `design-qa.md` with:

```md
# Design QA

source visual truth:
- layout: docs/design/references/search-workbench-layout-reference.png
- color/modal: docs/design/references/blue-consent-palette-reference.png

implementation screenshot:
- pending consent:
- accepted workbench:
- closed locked state:

viewport: 390 x 844
state: mobile, first-visit consent and accepted workbench

full-view comparison evidence:

focused region comparison evidence:

findings:

patches made since previous QA:

final result: blocked
```

Update `final result` to `passed` only when no actionable P0/P1/P2 findings remain.

- [ ] **Step 5: Fix QA findings**

If QA reports P0/P1/P2 issues, patch the affected files, then run:

```bash
npm test -- tests/app/App.test.tsx
npm run typecheck
npm run build
```

Expected: all commands pass. Repeat capture and QA until `design-qa.md` says `final result: passed`.

- [ ] **Step 6: Commit QA result and fixes**

Run:

```bash
git add design-qa.md src/app/App.tsx src/app/App.css
git commit -m "test: pass frontend design qa"
```

Expected: commit created.

---

## Self-Review

Spec coverage:

- Covers selected layout, selected color direction, first-entry modal, close-lock behavior, mobile-first workbench, company grouping, required city, optional filters, official link actions, and one global crawl time.
- Does not implement backend APIs, crawling, admin, deployment, or real database reads.

Placeholder scan:

- No `TBD`, `TODO`, or placeholder feature gates are included.

Type consistency:

- `CompanyResult`, `JobResult`, `SearchFilters`, `SortMode`, `filterJobs`, and `sortCompanies` names match between tests and implementation tasks.

Execution choice:

- User already selected Subagent-Driven for development. Execute this plan with `superpowers:subagent-driven-development`.
