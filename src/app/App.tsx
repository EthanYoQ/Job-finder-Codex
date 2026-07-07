import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ListFilter,
  MapPin,
  Search,
  SlidersHorizontal,
  UserRound,
  X
} from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import "./App.css";
import { filterJobs, sortCompanies, type CompanyResult, type JobResult } from "./jobSearch";

type ConsentState = "pending" | "closed" | "accepted";

const GLOBAL_LAST_FETCHED = "2026-07-07 08:00";
const DEFAULT_CITY = "北京";
const DEFAULT_CATEGORY = "销售";
const DEFAULT_EXPANDED_COMPANY_ID = "pfizer";

function compareJobsByPublishedAt(left: JobResult, right: JobResult): number {
  return (
    right.officialPublishedAt.localeCompare(left.officialPublishedAt) ||
    left.title.localeCompare(right.title, "zh-CN")
  );
}

function countJobs(companies: CompanyResult[]): number {
  return companies.reduce((total, company) => total + company.jobs.length, 0);
}

export function App() {
  const [consentState, setConsentState] = useState<ConsentState>("pending");
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
  const isLocked = consentState !== "accepted";

  const [city] = useState(DEFAULT_CITY);
  const [keyword, setKeyword] = useState("");
  const [categoryChip, setCategoryChip] = useState<string | null>(DEFAULT_CATEGORY);
  const [showsOnlyNewChip, setShowsOnlyNewChip] = useState(true);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(
    DEFAULT_EXPANDED_COMPANY_ID
  );

  const companyResults = useMemo(() => {
    const results = filterJobs({
      city,
      keyword,
      categories: categoryChip ? [categoryChip] : [],
      onlyNew: showsOnlyNewChip
    });

    return sortCompanies(results, "PINYIN_ASC").map((company) => ({
      ...company,
      jobs: [...company.jobs].sort(compareJobsByPublishedAt)
    }));
  }, [city, keyword, categoryChip, showsOnlyNewChip]);

  const matchingJobCount = countJobs(companyResults);

  function acceptConsent() {
    if (!hasCheckedConsent) {
      return;
    }

    setConsentState("accepted");
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
    setCategoryChip(null);
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
          <div>
            <p className="app-kicker">中国医药官方职位聚合</p>
            <h1>Job-search</h1>
          </div>
          <button className="profile-button" disabled={isLocked} type="button">
            <UserRound aria-hidden="true" size={18} />
            我的
          </button>
        </header>

        <section aria-label="搜索条件" className="search-panel">
          <label className="keyword-field">
            <Search aria-hidden="true" size={20} />
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

          <div className="control-row">
            <button className="selector-button" disabled={isLocked} type="button">
              <MapPin aria-hidden="true" size={18} />
              {city}
              <ChevronDown aria-hidden="true" size={17} />
            </button>
            <button className="selector-button" disabled={isLocked} type="button">
              <SlidersHorizontal aria-hidden="true" size={18} />
              筛选
            </button>
          </div>

          <div className="chip-row" aria-label="已选条件">
            {categoryChip ? (
              <button
                className="filter-chip"
                disabled={isLocked}
                onClick={() => setCategoryChip(null)}
                type="button"
              >
                {categoryChip}
                <X aria-hidden="true" size={14} />
              </button>
            ) : null}
            {keyword.trim() ? (
              <button
                className="filter-chip"
                disabled={isLocked}
                onClick={() => setKeyword("")}
                type="button"
              >
                {keyword.trim()}
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
        </section>

        <section aria-label="职位概览" className="summary-card">
          <div>
            <div className="summary-count">
              <span>{matchingJobCount}</span>
              <small>个职位</small>
            </div>
            <p>
              <span>{companyResults.length} 家公司</span>
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
          {companyResults.length > 0 ? (
            companyResults.map((company) => {
              const isExpanded = expandedCompanyId === company.id;

              return (
                <article className="company-card" key={company.id}>
                  <button
                    aria-expanded={isExpanded}
                    className="company-toggle"
                    disabled={isLocked}
                    onClick={() => toggleCompany(company.id)}
                    type="button"
                  >
                    <span className="company-icon">
                      <Building2 aria-hidden="true" size={21} />
                    </span>
                    <span className="company-title">
                      <strong>{company.companyName}</strong>
                      <small>{company.jobs.length} 个职位</small>
                    </span>
                    {isExpanded ? (
                      <ChevronDown aria-hidden="true" size={22} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={22} />
                    )}
                  </button>

                  {isExpanded ? (
                    <div className="job-list">
                      {company.jobs.map((job) => (
                        <div className="job-row" key={job.id}>
                          <div className="job-copy">
                            <h2>
                              {job.title}
                              {job.isNew ? <span className="new-badge">新增</span> : null}
                            </h2>
                            {job.officialTitle ? <p>{job.officialTitle}</p> : null}
                            <div className="job-meta" aria-label="职位基本信息">
                              <span>
                                <MapPin aria-hidden="true" size={15} />
                                {job.city}
                              </span>
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
                            <ExternalLink aria-hidden="true" size={15} />
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <ListFilter aria-hidden="true" size={22} />
              <p>没有匹配职位</p>
              <button disabled={isLocked} onClick={clearFilters} type="button">
                清空条件
              </button>
            </div>
          )}
        </section>

        <nav aria-label="底部导航" className="bottom-nav">
          <button className="bottom-nav-item active" disabled={isLocked} type="button">
            <ListFilter aria-hidden="true" size={21} />
            职位发现
          </button>
          <button className="bottom-nav-item" disabled={isLocked} type="button">
            <UserRound aria-hidden="true" size={21} />
            我的
          </button>
        </nav>
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
              <X aria-hidden="true" size={18} />
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
