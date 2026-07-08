import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  List,
  MapPin,
  MessageSquareWarning,
  Search,
  Send,
  ShieldCheck,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createDemoAppDataProvider,
  type AppDataProvider,
  type CoverageCompany,
  type SearchCompany,
  type StaticDocumentResult
} from "./appDataProvider";
import type { SortMode } from "./jobSearch";
import "./App.css";

type ConsentState = "pending" | "closed" | "accepted";
type ViewMode = "discover" | "coverage";

interface AppProps {
  dataProvider?: AppDataProvider;
}

interface FeedbackDraft {
  issueType: string;
  description: string;
  companyId?: string;
  companyName?: string;
  jobId?: string;
  jobTitle?: string;
}

const DEFAULT_CITY = "北京";
const DEFAULT_COMPANY_ROW_CAP = 3;
const CITY_OPTIONS = ["北京", "上海", "广州"];
const CATEGORY_OPTIONS = ["销售", "医学事务", "市场准入", "临床运营"];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "暂无更新";
  }

  return value.slice(0, 16).replace("T", " ");
}

function sortCompanies(companies: SearchCompany[], sort: SortMode): SearchCompany[] {
  const sorted = [...companies];

  if (sort === "JOB_COUNT_DESC") {
    return sorted.sort(
      (left, right) =>
        right.jobs.length - left.jobs.length || left.pinyin.localeCompare(right.pinyin, "zh-CN")
    );
  }

  if (sort === "LATEST") {
    const latestFor = (company: SearchCompany) =>
      company.jobs.reduce(
        (latest, job) =>
          (job.officialPublishedAt ?? "").localeCompare(latest, "zh-CN") > 0
            ? job.officialPublishedAt ?? ""
            : latest,
        ""
      );

    return sorted.sort(
      (left, right) =>
        latestFor(right).localeCompare(latestFor(left), "zh-CN") ||
        left.pinyin.localeCompare(right.pinyin, "zh-CN")
    );
  }

  return sorted.sort((left, right) => left.pinyin.localeCompare(right.pinyin, "zh-CN"));
}

function applyClientFilters(
  companies: SearchCompany[],
  keyword: string,
  categories: string[],
  onlyNew: boolean,
  sort: SortMode
): SearchCompany[] {
  const normalizedKeyword = normalize(keyword);
  const selectedCategories = new Set(categories);

  return sortCompanies(
    companies
      .map((company) => ({
        ...company,
        jobs: company.jobs.filter((job) => {
          const keywordMatches =
            normalizedKeyword === "" ||
            normalize(company.companyName).includes(normalizedKeyword) ||
            normalize(job.title).includes(normalizedKeyword) ||
            normalize(job.officialTitle).includes(normalizedKeyword) ||
            normalize(job.category).includes(normalizedKeyword);
          const categoryMatches =
            selectedCategories.size === 0 || selectedCategories.has(job.category);
          const newMatches = !onlyNew || job.isNew;

          return keywordMatches && categoryMatches && newMatches;
        })
      }))
      .filter((company) => company.jobs.length > 0),
    sort
  );
}

function ViewButton({
  active,
  children,
  icon,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`view-button${active ? " is-active" : ""}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function App({ dataProvider = createDemoAppDataProvider() }: AppProps) {
  const [consentState, setConsentState] = useState<ConsentState>("pending");
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
  const isLocked = consentState !== "accepted";

  const [activeView, setActiveView] = useState<ViewMode>("discover");
  const [city, setCity] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState<SortMode>("PINYIN_ASC");

  const [searchResult, setSearchResult] = useState<{
    companies: SearchCompany[];
    totalJobs: number;
    lastUpdatedAt: string | null;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [rowCaps, setRowCaps] = useState<Record<string, number>>({});

  const [coverageKeyword, setCoverageKeyword] = useState("");
  const [coverageResults, setCoverageResults] = useState<CoverageCompany[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isRecommendationFormOpen, setIsRecommendationFormOpen] = useState(false);
  const [recommendCompanyName, setRecommendCompanyName] = useState("");
  const [recommendWebsiteUrl, setRecommendWebsiteUrl] = useState("");
  const [recommendMessage, setRecommendMessage] = useState("");

  const [document, setDocument] = useState<StaticDocumentResult | null>(null);
  const [documentLoading, setDocumentLoading] = useState<"privacy" | "terms" | null>(null);

  const visibleCompanies = useMemo(() => {
    if (searchResult === null) {
      return [];
    }

    return applyClientFilters(searchResult.companies, keyword, selectedCategories, onlyNew, sort);
  }, [keyword, onlyNew, searchResult, selectedCategories, sort]);

  const visibleJobCount = visibleCompanies.reduce((sum, company) => sum + company.jobs.length, 0);

  useEffect(() => {
    if (consentState !== "accepted" || activeView !== "coverage") {
      return;
    }

    let cancelled = false;
    setCoverageLoading(true);

    dataProvider
      .listCoverage({ keyword: coverageKeyword, offset: 0, limit: 50 })
      .then((result) => {
        if (!cancelled) {
          setCoverageResults(result.companies);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCoverageLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, consentState, coverageKeyword, dataProvider]);

  async function openDocument(slug: "privacy" | "terms") {
    setDocumentLoading(slug);
    const nextDocument = await dataProvider.getDocument(slug);
    setDocument(nextDocument);
    setDocumentLoading(null);
  }

  function closeConsent() {
    setConsentState("closed");
    setHasCheckedConsent(false);
  }

  function acceptConsent() {
    if (!hasCheckedConsent) {
      return;
    }

    setConsentState("accepted");
    setActiveView("discover");
    setCity(DEFAULT_CITY);
  }

  async function handleSearch() {
    if (consentState !== "accepted" || city === "") {
      return;
    }

    setIsSearching(true);
    setFeedbackDraft(null);
    setFeedbackMessage("");

    try {
      const result = await dataProvider.searchJobs({
        city,
        keyword,
        categories: selectedCategories,
        sort,
        onlyNew
      });

      setSearchResult(result);
      setExpandedCompanyId(null);
      setRowCaps({});
    } finally {
      setIsSearching(false);
    }
  }

  function toggleCategory(category: string) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    );
  }

  function toggleCompany(companyId: string) {
    setExpandedCompanyId((current) => (current === companyId ? null : companyId));
  }

  function openFeedback(company: SearchCompany, job: SearchCompany["jobs"][number]) {
    setFeedbackMessage("");
    setFeedbackDraft({
      issueType: "",
      description: "",
      companyId: company.id,
      companyName: company.companyName,
      jobId: job.id,
      jobTitle: job.title
    });
  }

  async function submitFeedback() {
    if (
      feedbackDraft === null ||
      feedbackDraft.issueType.trim() === "" ||
      feedbackDraft.description.trim() === ""
    ) {
      return;
    }

    await dataProvider.submitFeedback({
      issueType: feedbackDraft.issueType,
      description: feedbackDraft.description,
      ...(feedbackDraft.companyId === undefined ? {} : { companyId: feedbackDraft.companyId }),
      ...(feedbackDraft.jobId === undefined ? {} : { jobId: feedbackDraft.jobId })
    });

    setFeedbackMessage("反馈已提交，待人工核查。");
    setFeedbackDraft(null);
  }

  async function submitRecommendation() {
    if (recommendCompanyName.trim() === "" || recommendWebsiteUrl.trim() === "") {
      return;
    }

    await dataProvider.recommendCompany({
      companyName: recommendCompanyName.trim(),
      officialWebsiteUrl: recommendWebsiteUrl.trim()
    });

    setRecommendMessage("已收到推荐，公司会进入管理员复核队列。");
    setRecommendCompanyName("");
    setRecommendWebsiteUrl("");
  }

  return (
    <div className="app-shell">
      <main aria-hidden={isLocked ? "true" : undefined} className="workbench">
        <header className="app-header">
          <div>
            <h1>Job-search</h1>
            <p>中国医药官方职位聚合</p>
          </div>
          <button className="document-trigger" onClick={() => openDocument("privacy")} type="button">
            <ShieldCheck aria-hidden="true" size={16} />
            隐私说明
          </button>
        </header>

        <section className="view-strip" aria-label="产品流程">
          <ViewButton
            active={activeView === "discover"}
            icon={<List aria-hidden="true" size={16} />}
            onClick={() => setActiveView("discover")}
          >
            职位发现
          </ViewButton>
          <ViewButton
            active={activeView === "coverage"}
            icon={<Building2 aria-hidden="true" size={16} />}
            onClick={() => setActiveView("coverage")}
          >
            查看覆盖公司
          </ViewButton>
        </section>

        {activeView === "discover" ? (
          <>
            <section aria-label="搜索条件" className="panel search-panel">
              <div className="search-controls">
                <label className="keyword-field">
                  <Search aria-hidden="true" size={18} />
                  <input
                    aria-label="职位关键词"
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="职位关键词"
                    type="search"
                    value={keyword}
                  />
                </label>
                <button className="search-button" onClick={handleSearch} type="button">
                  <Search aria-hidden="true" size={16} />
                  {isSearching ? "搜索中" : "搜索职位"}
                </button>
              </div>

              <div className="city-group" role="radiogroup" aria-label="城市">
                {CITY_OPTIONS.map((option) => (
                  <label
                    className={`city-option${city === option ? " is-active" : ""}`}
                    key={option}
                  >
                    <input
                      checked={city === option}
                      name="city"
                      onChange={() => setCity(option)}
                      type="radio"
                      value={option}
                    />
                    <MapPin aria-hidden="true" size={15} />
                    <span>{option}</span>
                  </label>
                ))}
              </div>

              <div className="filter-block">
                <div className="filter-heading">
                  <SlidersIcon />
                  <span>筛选条件</span>
                </div>
                <div className="category-grid">
                  {CATEGORY_OPTIONS.map((category) => (
                    <label className="toggle-chip" key={category}>
                      <input
                        checked={selectedCategories.includes(category)}
                        onChange={() => toggleCategory(category)}
                        type="checkbox"
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
                <label className="toggle-row">
                  <input
                    checked={onlyNew}
                    onChange={(event) => setOnlyNew(event.target.checked)}
                    type="checkbox"
                  />
                  <span>只看新增</span>
                </label>
                <div className="sort-row" aria-label="排序">
                  <button
                    aria-pressed={sort === "PINYIN_ASC"}
                    className={`sort-button${sort === "PINYIN_ASC" ? " is-active" : ""}`}
                    onClick={() => setSort("PINYIN_ASC")}
                    type="button"
                  >
                    拼音 A-Z
                  </button>
                  <button
                    aria-pressed={sort === "LATEST"}
                    className={`sort-button${sort === "LATEST" ? " is-active" : ""}`}
                    onClick={() => setSort("LATEST")}
                    type="button"
                  >
                    最新发布
                  </button>
                  <button
                    aria-pressed={sort === "JOB_COUNT_DESC"}
                    className={`sort-button${sort === "JOB_COUNT_DESC" ? " is-active" : ""}`}
                    onClick={() => setSort("JOB_COUNT_DESC")}
                    type="button"
                  >
                    职位数量
                  </button>
                </div>
              </div>
            </section>

            <section aria-label="职位概览" className="panel summary-card">
              <div>
                <strong>{visibleJobCount} 个职位</strong>
                <p>{visibleCompanies.length} 家公司</p>
              </div>
              <span>最后更新 {formatTimestamp(searchResult?.lastUpdatedAt ?? null)}</span>
            </section>

            <section aria-label="公司职位列表" className="company-list">
              {searchResult === null ? (
                <div className="empty-state">
                  <BriefcaseBusiness aria-hidden="true" size={18} />
                  <p>选择城市并搜索后加载官方职位分组结果。</p>
                </div>
              ) : visibleCompanies.length === 0 ? (
                <div className="empty-state">
                  <Search aria-hidden="true" size={18} />
                  <p>当前筛选下没有匹配职位。</p>
                </div>
              ) : (
                visibleCompanies.map((company) => {
                  const isExpanded = expandedCompanyId === company.id;
                  const cap = rowCaps[company.id] ?? DEFAULT_COMPANY_ROW_CAP;
                  const visibleJobs = company.jobs.slice(0, cap);

                  return (
                    <article
                      className="company-card"
                      data-testid={`company-${company.id}`}
                      key={company.id}
                    >
                      <button
                        aria-expanded={isExpanded}
                        className="company-toggle"
                        onClick={() => toggleCompany(company.id)}
                        type="button"
                      >
                        <strong>{company.companyName}</strong>
                        <span>
                          {company.jobs.length} 个职位
                          {isExpanded ? (
                            <ChevronDown aria-hidden="true" size={16} />
                          ) : (
                            <ChevronRight aria-hidden="true" size={16} />
                          )}
                        </span>
                      </button>

                      {isExpanded ? (
                        <div className="job-list">
                          {visibleJobs.map((job) => (
                            <div className="job-row" key={job.id}>
                              <div className="job-copy">
                                <h2>
                                  {job.title}
                                  {job.isNew ? <span className="new-badge">新增</span> : null}
                                </h2>
                                <p>{job.officialTitle}</p>
                                <div className="job-meta">
                                  <span>
                                    <MapPin aria-hidden="true" size={14} />
                                    {job.city}
                                  </span>
                                  <span>
                                    <BriefcaseBusiness aria-hidden="true" size={14} />
                                    {job.category}
                                  </span>
                                </div>
                              </div>
                              <div className="job-actions">
                                <a
                                  aria-label={`查看官方职位 ${job.title}`}
                                  className="official-link"
                                  href={job.officialUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  查看官方职位
                                  <ExternalLink aria-hidden="true" size={14} />
                                </a>
                                <button
                                  aria-label={`反馈此职位 ${job.title}`}
                                  className="secondary-button"
                                  onClick={() => openFeedback(company, job)}
                                  type="button"
                                >
                                  反馈此职位
                                </button>
                              </div>
                            </div>
                          ))}

                          {company.jobs.length > cap ? (
                            <button
                              className="row-cap-button"
                              onClick={() =>
                                setRowCaps((current) => ({
                                  ...current,
                                  [company.id]: company.jobs.length
                                }))
                              }
                              type="button"
                            >
                              查看全部 {company.jobs.length} 个职位
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </section>

            {feedbackDraft !== null ? (
              <section className="panel feedback-panel" aria-label="职位反馈">
                <div className="panel-heading">
                  <MessageSquareWarning aria-hidden="true" size={18} />
                  <div>
                    <strong>职位反馈</strong>
                    <p>
                      {feedbackDraft.companyName} / {feedbackDraft.jobTitle}
                    </p>
                  </div>
                </div>
                <label className="form-field">
                  <span>反馈类型</span>
                  <select
                    aria-label="反馈类型"
                    onChange={(event) =>
                      setFeedbackDraft((current) =>
                        current === null ? current : { ...current, issueType: event.target.value }
                      )
                    }
                    value={feedbackDraft.issueType}
                  >
                    <option value="">请选择</option>
                    <option value="职位信息有误">职位信息有误</option>
                    <option value="链接不可用">链接不可用</option>
                    <option value="重复职位">重复职位</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>反馈内容</span>
                  <textarea
                    aria-label="反馈内容"
                    onChange={(event) =>
                      setFeedbackDraft((current) =>
                        current === null ? current : { ...current, description: event.target.value }
                      )
                    }
                    rows={3}
                    value={feedbackDraft.description}
                  />
                </label>
                <div className="panel-actions">
                  <button className="secondary-button" onClick={() => setFeedbackDraft(null)} type="button">
                    取消
                  </button>
                  <button className="primary-button" onClick={submitFeedback} type="button">
                    提交反馈
                  </button>
                </div>
              </section>
            ) : null}

            {feedbackMessage !== "" ? (
              <p className="success-banner">
                <CheckCircle2 aria-hidden="true" size={16} />
                {feedbackMessage}
              </p>
            ) : null}
          </>
        ) : null}

        {activeView === "coverage" ? (
          <section className="panel stacked-panel" aria-label="公司覆盖">
            <div className="panel-heading">
              <Building2 aria-hidden="true" size={18} />
              <div>
                <strong>已覆盖公司</strong>
                <p>仅展示公司名称与官网入口。</p>
              </div>
            </div>
            <label className="keyword-field">
              <Search aria-hidden="true" size={18} />
              <input
                aria-label="搜索已覆盖公司"
                onChange={(event) => setCoverageKeyword(event.target.value)}
                placeholder="搜索已覆盖公司"
                type="search"
                value={coverageKeyword}
              />
            </label>
            <div className="coverage-list">
              {coverageLoading ? (
                <p className="muted-copy">加载中...</p>
              ) : (
                coverageResults.map((company) => (
                  <article className="coverage-row" key={company.id}>
                    <strong>{company.companyName}</strong>
                    <a href={company.officialWebsiteUrl} rel="noreferrer" target="_blank">
                      {company.officialWebsiteUrl}
                    </a>
                  </article>
                ))
              )}
            </div>
          </section>
        ) : null}

        <section className="panel stacked-panel auxiliary-panel" aria-label="辅助操作">
          <div className="panel-heading">
            <Send aria-hidden="true" size={18} />
            <div>
              <strong>辅助操作</strong>
              <p>补充未覆盖但有官方招聘入口的药企。</p>
            </div>
          </div>
          <div className="auxiliary-actions">
            <button
              aria-expanded={isRecommendationFormOpen}
              className="secondary-button"
              onClick={() => {
                setIsRecommendationFormOpen((current) => !current);
                setRecommendMessage("");
              }}
              type="button"
            >
              <Send aria-hidden="true" size={16} />
              推荐未覆盖公司
            </button>
          </div>

          {isRecommendationFormOpen ? (
            <div className="recommendation-form">
              <div className="panel-heading">
                <Send aria-hidden="true" size={18} />
                <div>
                  <strong>推荐公司</strong>
                  <p>提交后会进入管理员复核队列。</p>
                </div>
              </div>
              <label className="form-field">
                <span>公司名称</span>
                <input
                  aria-label="公司名称"
                  onChange={(event) => setRecommendCompanyName(event.target.value)}
                  type="text"
                  value={recommendCompanyName}
                />
              </label>
              <label className="form-field">
                <span>官网链接</span>
                <input
                  aria-label="官网链接"
                  onChange={(event) => setRecommendWebsiteUrl(event.target.value)}
                  type="url"
                  value={recommendWebsiteUrl}
                />
              </label>
              <div className="panel-actions">
                <button className="primary-button" onClick={submitRecommendation} type="button">
                  提交推荐
                </button>
              </div>
              {recommendMessage !== "" ? (
                <p className="success-banner">
                  <CheckCircle2 aria-hidden="true" size={16} />
                  {recommendMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>

      {consentState === "pending" ? (
        <div className="modal-overlay">
          <section aria-label="使用前确认" className="consent-modal" role="dialog">
            <button aria-label="关闭确认弹窗" className="icon-button" onClick={closeConsent} type="button">
              <X aria-hidden="true" size={16} />
            </button>
            <h2>使用前确认</h2>
            <p>先完成同意，前台才会请求职位搜索结果。</p>
            <label className="consent-check">
              <input
                checked={hasCheckedConsent}
                onChange={(event) => setHasCheckedConsent(event.target.checked)}
                type="checkbox"
              />
              <span>
                我已阅读并同意
                <a
                  className="inline-link"
                  href="/privacy"
                  onClick={(event) => {
                    event.preventDefault();
                    void openDocument("privacy");
                  }}
                >
                  隐私政策
                </a>
                和
                <a
                  className="inline-link"
                  href="/terms"
                  onClick={(event) => {
                    event.preventDefault();
                    void openDocument("terms");
                  }}
                >
                  服务条款
                </a>
              </span>
            </label>
            <button className="primary-button large-button" disabled={!hasCheckedConsent} onClick={acceptConsent} type="button">
              进入 Job-search
            </button>
          </section>
        </div>
      ) : null}

      {consentState === "closed" ? (
        <div className="locked-overlay">
          <section aria-label="页面已锁定" className="locked-panel">
            <h2>使用前请先完成确认</h2>
            <p>关闭确认后，职位搜索会保持锁定。</p>
            <button className="primary-button" onClick={() => setConsentState("pending")} type="button">
              重新打开确认
            </button>
            <button className="secondary-button" onClick={() => openDocument("privacy")} type="button">
              查看隐私说明
            </button>
            <button className="secondary-button" onClick={() => openDocument("terms")} type="button">
              查看使用条款
            </button>
          </section>
        </div>
      ) : null}

      {document !== null || documentLoading !== null ? (
        <div className="modal-overlay">
          <section aria-label="文档内容" className="document-modal" role="dialog">
            <button aria-label="关闭文档" className="icon-button" onClick={() => setDocument(null)} type="button">
              <X aria-hidden="true" size={16} />
            </button>
            <div className="panel-heading">
              <FileText aria-hidden="true" size={18} />
              <div>
                <h2>{document?.title ?? "加载中"}</h2>
              </div>
            </div>
            <div className="document-body">
              {documentLoading !== null ? documentLoading : document?.body}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SlidersIcon() {
  return <BriefcaseBusiness aria-hidden="true" size={16} />;
}
