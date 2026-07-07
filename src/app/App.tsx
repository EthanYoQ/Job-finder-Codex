import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MapPin,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import "./App.css";

type ConsentState = "pending" | "closed" | "accepted";

interface VisualJob {
  id: string;
  title: string;
  officialTitle: string;
  city: string;
  category: string;
  isNew: boolean;
  officialUrl: string;
  searchTerms?: string[];
}

interface VisualCompany {
  id: string;
  companyName: string;
  countLabel: string;
  jobs: VisualJob[];
}

const GLOBAL_LAST_FETCHED = "2026-07-07 08:00";
const DEFAULT_CITY = "北京";
const DEFAULT_EXPANDED_COMPANY_ID = "pfizer";

const visualCompanies: VisualCompany[] = [
  {
    id: "astrazeneca",
    companyName: "阿斯利康",
    countLabel: "32 个职位",
    jobs: []
  },
  {
    id: "beigene",
    companyName: "百济神州",
    countLabel: "24 个职位",
    jobs: []
  },
  {
    id: "pfizer",
    companyName: "辉瑞",
    countLabel: "28 个职位",
    jobs: [
      {
        id: "pfizer-medical-info",
        title: "医学信息沟通专员（呼吸领域）",
        officialTitle: "Medical Information Associate (Respiratory)",
        city: "北京",
        category: "医学信息",
        isNew: true,
        officialUrl: "https://www.pfizer.com.cn/careers"
      },
      {
        id: "pfizer-msl",
        title: "医学科学联络官（肿瘤领域）",
        officialTitle: "Medical Science Liaison (Oncology)",
        city: "北京",
        category: "医学事务",
        isNew: true,
        officialUrl: "https://www.pfizer.com.cn/careers",
        searchTerms: ["MSL"]
      },
      {
        id: "pfizer-sales",
        title: "区域销售经理（北京）",
        officialTitle: "Regional Sales Manager (Beijing)",
        city: "北京",
        category: "销售",
        isNew: true,
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
      },
      {
        id: "pfizer-cra",
        title: "临床研究监察员（CRA）",
        officialTitle: "Clinical Research Associate (CRA)",
        city: "北京",
        category: "临床研究",
        isNew: true,
        officialUrl: "https://www.pfizer.com.cn/careers"
      }
    ]
  },
  {
    id: "novartis",
    companyName: "诺华",
    countLabel: "22 个职位",
    jobs: []
  },
  {
    id: "innovent",
    companyName: "信达生物",
    countLabel: "22 个职位",
    jobs: []
  }
];

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function countVisibleJobs(companies: VisualCompany[]): number {
  return companies.reduce((total, company) => total + company.jobs.length, 0);
}

export function App() {
  const [consentState, setConsentState] = useState<ConsentState>("pending");
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
  const isLocked = consentState !== "accepted";

  const [keyword, setKeyword] = useState("");
  const [showsSalesChip, setShowsSalesChip] = useState(true);
  const [showsMslChip, setShowsMslChip] = useState(true);
  const [showsOnlyNewChip, setShowsOnlyNewChip] = useState(true);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(
    DEFAULT_EXPANDED_COMPANY_ID
  );

  const companyResults = useMemo(() => {
    const query = normalized(keyword);

    if (!query) {
      return visualCompanies;
    }

    return visualCompanies
      .map((company) => {
        const companyMatches = normalized(company.companyName).includes(query);
        const jobs = company.jobs.filter((job) => {
          return (
            companyMatches ||
            normalized(job.title).includes(query) ||
            normalized(job.officialTitle).includes(query) ||
            normalized(job.category).includes(query) ||
            (job.searchTerms ?? []).some((term) => normalized(term).includes(query))
          );
        });

        return companyMatches && jobs.length === 0 ? { ...company, jobs: company.jobs } : { ...company, jobs };
      })
      .filter((company) => company.jobs.length > 0 || normalized(company.companyName).includes(query));
  }, [keyword]);

  const hasKeyword = Boolean(keyword.trim());
  const summaryJobCount = hasKeyword ? countVisibleJobs(companyResults) : 128;
  const summaryCompanyCount = hasKeyword ? companyResults.length : 5;

  function acceptConsent() {
    if (hasCheckedConsent) {
      setConsentState("accepted");
    }
  }

  function closeConsent() {
    setHasCheckedConsent(false);
    setConsentState("closed");
  }

  function reopenConsent() {
    setHasCheckedConsent(false);
    setConsentState("pending");
  }

  function clearFilters() {
    setKeyword("");
    setShowsSalesChip(false);
    setShowsMslChip(false);
    setShowsOnlyNewChip(false);
    setExpandedCompanyId(null);
  }

  function toggleCompany(companyId: string) {
    if (isLocked) {
      return;
    }

    setExpandedCompanyId((currentCompanyId) =>
      currentCompanyId === companyId ? null : companyId
    );
  }

  function preventLockedNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (isLocked) {
      event.preventDefault();
    }
  }

  return (
    <div className="app-shell">
      <main aria-hidden={isLocked ? "true" : undefined} className="workbench">
        <header className="app-header">
          <h1>Job-search</h1>
          <span>中国医药官方职位聚合</span>
        </header>

        <section aria-label="搜索条件" className="search-panel">
          <div className="search-controls">
            <label className="keyword-field">
              <Search aria-hidden="true" size={19} />
              <input
                disabled={isLocked}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setExpandedCompanyId(null);
                }}
                placeholder="职位关键词，如：医学代表、药物警戒"
                type="search"
                value={keyword}
              />
            </label>
            <button className="city-button" disabled={isLocked} type="button">
              <MapPin aria-hidden="true" size={18} />
              {DEFAULT_CITY}
              <ChevronDown aria-hidden="true" size={17} />
            </button>
            <button className="filter-button" disabled={isLocked} type="button">
              <SlidersHorizontal aria-hidden="true" size={20} />
              筛选
            </button>
          </div>

          <div className="chip-toolbar">
            <div className="chip-row" aria-label="已选条件">
              {showsSalesChip ? (
                <button
                  className="filter-chip"
                  disabled={isLocked}
                  onClick={() => setShowsSalesChip(false)}
                  type="button"
                >
                  销售
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
              {showsMslChip ? (
                <button
                  className="filter-chip"
                  disabled={isLocked}
                  onClick={() => setShowsMslChip(false)}
                  type="button"
                >
                  MSL
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
              {showsOnlyNewChip ? (
                <button
                  className="filter-chip"
                  disabled={isLocked}
                  onClick={() => setShowsOnlyNewChip(false)}
                  type="button"
                >
                  只看新增
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
              <button className="clear-button" disabled={isLocked} onClick={clearFilters} type="button">
                清空
              </button>
            </div>
            <button className="collapse-filter" disabled={isLocked} type="button">
              收起筛选
              <ChevronDown aria-hidden="true" size={15} />
            </button>
          </div>
        </section>

        <section aria-label="职位概览" className="summary-card">
          <div className="summary-left">
            <div className="summary-count">
              <span>{summaryJobCount}</span>
              <small>个职位</small>
            </div>
            <p>
              <strong>{summaryCompanyCount} 家公司</strong>
              <span aria-hidden="true" className="summary-divider" />
              <span>全站最后抓取 {GLOBAL_LAST_FETCHED}</span>
            </p>
          </div>
          <button className="sort-button" disabled={isLocked} type="button">
            排序：拼音 A-Z
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        </section>

        <section aria-label="公司职位列表" className="company-list">
          {companyResults.map((company) => {
            const isExpanded = expandedCompanyId === company.id;
            const countLabel = hasKeyword ? `${company.jobs.length} 个职位` : company.countLabel;

            return (
              <article className="company-row" key={company.id}>
                <button
                  aria-expanded={isExpanded}
                  className="company-toggle"
                  disabled={isLocked}
                  onClick={() => toggleCompany(company.id)}
                  type="button"
                >
                  <strong>{company.companyName}</strong>
                  <span>
                    {countLabel}
                    {isExpanded ? (
                      <ChevronDown aria-hidden="true" size={18} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={18} />
                    )}
                  </span>
                </button>

                {isExpanded && company.jobs.length > 0 ? (
                  <div className="job-list">
                    {company.jobs.map((job) => (
                      <div className="job-row" key={job.id}>
                        <div className="job-copy">
                          <h2>
                            {job.title}
                            {job.isNew ? <span className="new-badge">新增</span> : null}
                          </h2>
                          <p>{job.officialTitle}</p>
                          <div className="job-meta" aria-label="职位基本信息">
                            <span>
                              <MapPin aria-hidden="true" size={15} />
                              {job.city}
                            </span>
                            <span aria-hidden="true" className="meta-divider" />
                            <span>
                              <BriefcaseBusiness aria-hidden="true" size={15} />
                              {job.category}
                            </span>
                          </div>
                        </div>
                        <a
                          className="official-link"
                          href={job.officialUrl}
                          onClick={preventLockedNavigation}
                          rel="noreferrer"
                          target="_blank"
                        >
                          查看官方职位
                          <ExternalLink aria-hidden="true" size={14} />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </main>

      {consentState === "pending" ? (
        <div className="modal-overlay">
          <section aria-label="使用前确认" className="consent-modal" role="dialog">
            <button
              aria-label="关闭确认弹窗"
              className="modal-close"
              onClick={closeConsent}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
            <h2>使用前确认</h2>
            <span className="modal-accent" />
            <p>为使用职位搜索服务，请先同意隐私政策和服务条款。</p>
            <label className="consent-check">
              <input
                checked={hasCheckedConsent}
                onChange={(event) => setHasCheckedConsent(event.target.checked)}
                type="checkbox"
              />
              <span>
                我已阅读并同意
                <a href="/privacy" onClick={(event) => event.preventDefault()}>
                  《隐私政策》
                </a>
                <a href="/terms" onClick={(event) => event.preventDefault()}>
                  《服务条款》
                </a>
              </span>
            </label>
            <button
              className="enter-button"
              disabled={!hasCheckedConsent}
              onClick={acceptConsent}
              type="button"
            >
              进入 Job-search
            </button>
          </section>
        </div>
      ) : null}

      {consentState === "closed" ? (
        <div className="locked-overlay">
          <section aria-label="页面已锁定" className="locked-panel">
            <h2>使用前请先完成确认</h2>
            <p>关闭确认弹窗后，页面会保持锁定。重新打开并勾选同意后才能进入。</p>
            <button onClick={reopenConsent} type="button">
              重新打开确认
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
