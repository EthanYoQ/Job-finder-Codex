import { submissionErrorMessage, UNKNOWN_WRITE_MESSAGE } from "./apiResponse";
import {
  ArrowRight,
  Check,
  Flag,
  Info,
  LockKeyhole,
  SlidersHorizontal,
  Sparkles,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  COMPANY_DIRECTORY_PAGE_SIZE,
  createHttpAppDataProvider,
  type AppDataProvider,
  type CoverageCompany,
  type SearchCompany,
  type SearchRequest,
  type SearchResult,
  type StaticDocumentResult
} from "./appDataProvider";
import type { SortMode } from "./jobSearch";
import { JOB_CATEGORIES, SEARCH_CITIES } from "../domain/search";
import { JOB_CATEGORY_GROUPS, matchesJobCategory } from "../domain/jobClassification";
import { ALL_CITIES, ALL_PROVINCES, CITY_PENDING, NATIONWIDE } from "../domain/jobLocation";
import "./App.css";
import { CompanyLogo, CompanyPlate, coordinate, LocationPicker, Modal, type LocationOption } from "./RedesignComponents";
import { DESIGN_REGIONS } from "./designRegions";
import { startBoundedSnapshotRequest } from "./boundedSnapshotRequest";
const defaultProvider = createHttpAppDataProvider();

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

const DEFAULT_COMPANY_ROW_CAP = 3;
const NOVO_SOURCE_NOTE = "指定中国站已核实职位；全球站补充职位仍在核验";
const ORGANON_SOURCE_NOTE = "排序日期采用官网职位列表记录；地点冲突保留为城市待核";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "暂无更新";
  }

  return value.slice(0, 16).replace("T", " ");
}

const PUBLICATION_STATE_LABELS: Record<CoverageCompany["state"], string> = {
  PUBLISHING: "已发布快照",
  VERIFYING: "核验中",
  OFFICIAL_LINK_ONLY: "仅官方入口",
  NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME: "暂无公开官方招聘入口",
  USER_AUTHORIZED_PHASE1_EXCLUSION: "用户授权一期排除"
};

const COMPANY_CATEGORY_LABELS: Record<CoverageCompany["category"], string> = {
  FOREIGN_PHARMA: "外资药企",
  DOMESTIC_PHARMA: "国内药企"
};

function publicationNote(company: CoverageCompany): string {
  if (company.id === "company-novo-nordisk-china" && company.state === "PUBLISHING") return NOVO_SOURCE_NOTE;
  switch (company.state) {
    case "PUBLISHING":
      return "仅展示来源可核验的官方职位，不作抓全声明。";
    case "VERIFYING":
      return "官方入口与职位仍在核验，不作抓全声明。";
    case "OFFICIAL_LINK_ONLY":
      return "提供官方入口，职位暂未自动汇总。";
    case "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME":
      return "抓取时未发现公开官方招聘入口，可访问公司官网。";
    case "USER_AUTHORIZED_PHASE1_EXCLUSION":
      return "本期不对该公司职位完整性作声明。";
  }
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

  return sortCompanies(
    companies
      .map((company) => ({
        ...company,
        jobs: company.jobs.filter((job) => {
          const keywordMatches =
            normalizedKeyword === "" ||
            normalize(company.companyName).includes(normalizedKeyword) ||
            normalize(company.pinyin).includes(normalizedKeyword) ||
            normalize(job.title).includes(normalizedKeyword) ||
            normalize(job.officialTitle).includes(normalizedKeyword) ||
            normalize(job.category).includes(normalizedKeyword) ||
            normalize(job.subcategory ?? "").includes(normalizedKeyword);
          const categoryMatches = matchesJobCategory(job, categories);
          const newMatches = !onlyNew || job.isNew;

          return keywordMatches && categoryMatches && newMatches;
        })
      }))
      .filter((company) => company.jobs.length > 0),
    sort
  );
}

export function App({ dataProvider = defaultProvider }: AppProps) {
  const [consentState, setConsentState] = useState<ConsentState>("pending");
  const [hasCheckedConsent, setHasCheckedConsent] = useState(false);
  const isLocked = consentState !== "accepted";

  const [activeView, setActiveView] = useState<ViewMode>("discover");
  const [province, setProvince] = useState<string>(ALL_PROVINCES);
  const [city, setCity] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [onlyNew, setOnlyNew] = useState(false);
  const [sort, setSort] = useState<SortMode>("PINYIN_ASC");

  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const selectedProvince = searchResult?.provinceFacets?.find((facet) => facet.province === province);
  const allCitiesCount = province === ALL_PROVINCES ? searchResult?.publishedJobSummary?.totalJobs : selectedProvince?.jobCount;
  const cityPendingCount = province === ALL_PROVINCES ? searchResult?.publishedJobSummary?.cityPendingJobs : selectedProvince?.cityPendingJobs;
  const cityFacets = (searchResult?.cityFacets ?? [{ city: NATIONWIDE, province: null, jobCount: undefined }])
    .filter((facet) => facet.city !== CITY_PENDING && (province === ALL_PROVINCES || facet.province === province));

  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [rowCaps, setRowCaps] = useState<Record<string, number>>({});

  const [coverageKeyword, setCoverageKeyword] = useState("");
  const [coverageResults, setCoverageResults] = useState<CoverageCompany[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageFailed, setCoverageFailed] = useState(false);
  const [plateCompanies, setPlateCompanies] = useState<CoverageCompany[]>([]);
  const [coverageRetry, setCoverageRetry] = useState(0);
  const coverageRequestSequence = useRef(0);
  const coverageCompletedSequence = useRef(0);
  const [hotId, setHotId] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState<"province" | "city" | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 720px)").matches ?? false);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 960px)").matches ?? false);
  const [finderStuck, setFinderStuck] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [documentError, setDocumentError] = useState("");
  const documentSequence = useRef(0);
  const searchBusy = useRef(false);
  const searchRequestSequence = useRef(0);
  const searchWork = useRef<{ cancel: () => void; context: string; provider: AppDataProvider } | null>(null);
  const searchContext = JSON.stringify([consentState, province, city, keyword, selectedCategories, sort, onlyNew]);


  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isRecommendationFormOpen, setIsRecommendationFormOpen] = useState(false);
  const [recommendCompanyName, setRecommendCompanyName] = useState("");
  const [recommendWebsiteUrl, setRecommendWebsiteUrl] = useState("");
  const [recommendMessage, setRecommendMessage] = useState("");

  const [document, setDocument] = useState<StaticDocumentResult | null>(null);
  const [documentLoading, setDocumentLoading] = useState<"privacy" | "terms" | null>(null);
  const [privacyFormOpen, setPrivacyFormOpen] = useState(false);
  const [privacyType, setPrivacyType] = useState<"PRIVACY_EXPORT" | "PRIVACY_DELETE">("PRIVACY_EXPORT");
  const [privacyContact, setPrivacyContact] = useState("");
  const [privacyDescription, setPrivacyDescription] = useState("");
  const [privacyReceipt, setPrivacyReceipt] = useState("");

  const visibleCompanies = useMemo(() => {
    if (searchResult === null) {
      return [];
    }

    return applyClientFilters(searchResult.companies, keyword, selectedCategories, onlyNew, sort);
  }, [keyword, onlyNew, searchResult, selectedCategories, sort]);

  const visibleJobCount = visibleCompanies.reduce((sum, company) => sum + company.jobs.length, 0);

  useLayoutEffect(() => {
    if (consentState !== "accepted") return;
    const sequence = ++coverageRequestSequence.current;
    setCoverageLoading(true);
    setCoverageFailed(false);
    const requestKeyword = activeView === "coverage" ? coverageKeyword : "";
    const cancel = startBoundedSnapshotRequest({
      request: (signal, snapshotCheck) => dataProvider.listCoverage(
        {keyword: requestKeyword, offset: 0, limit: COMPANY_DIRECTORY_PAGE_SIZE},
        { signal, ...(snapshotCheck !== undefined ? { snapshotCheck } : {}) }
      ),
      onResult: result => {
        if (sequence !== coverageRequestSequence.current) return;
        coverageCompletedSequence.current = sequence;
        const sorted = [...result.companies].sort((a, b) => a.companyName.localeCompare(b.companyName, "zh-CN"));
        setCoverageResults(sorted);
        if (!requestKeyword) setPlateCompanies(sorted);
      },
      onError: (_error, refreshing) => { if (!refreshing && sequence === coverageRequestSequence.current) setCoverageFailed(true); },
      onInitialSettled: () => { if (sequence === coverageRequestSequence.current) setCoverageLoading(false); }
    });
    return () => { coverageRequestSequence.current++; cancel(); };
  }, [activeView, consentState, coverageKeyword, dataProvider, coverageRetry]);

  // Invalidate changed filters during commit, before a late promise can update them.
  useLayoutEffect(() => {
    if (searchWork.current && (searchWork.current.context !== searchContext || searchWork.current.provider !== dataProvider)) {
      searchRequestSequence.current++;
      searchWork.current.cancel();
      searchWork.current = null;
      searchBusy.current = false;
      setIsSearching(false);
    }
  }, [searchContext, dataProvider]);

  useLayoutEffect(() => () => {
    searchRequestSequence.current++;
    searchWork.current?.cancel();
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 720px)");
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 960px)");
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    // The selected source creates this grain texture at runtime as well.
    try {
      if (!window.CanvasRenderingContext2D) return;
      const canvas = window.document.createElement("canvas"); canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d"); if (!context) return;
      const pixels = context.createImageData(128, 128);
      for (let p = 0; p < pixels.data.length; p += 4) { const value = Math.random() * 255; pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = value; pixels.data[p + 3] = 60; }
      context.putImageData(pixels, 0, 0);
      window.document.documentElement.style.setProperty("--noise", `url(${canvas.toDataURL()})`);
    } catch { /* Texture is decorative; the page remains usable without canvas. */ }
  }, []);
  useEffect(() => {
    const update = () => setFinderStuck((stageRef.current?.getBoundingClientRect().top ?? 1) < 10);
    window.addEventListener("scroll", update, {passive: true});
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!pendingScroll || (activeView === "coverage" && (coverageLoading || coverageRequestSequence.current !== coverageCompletedSequence.current))) return;
    const element = window.document.getElementById(`row-${pendingScroll}`);
    if (element) { element.scrollIntoView?.({behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center"}); setPendingScroll(null); }
  }, [pendingScroll, activeView, coverageLoading, coverageResults, expandedCompanyId]);
  useEffect(() => {
    if (!locationOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setLocationOpen(null); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [locationOpen]);

  function changeView(view: ViewMode) {
    setActiveView(view); setLocationOpen(null);
    // Match the source navigation: a view change begins at its hero and finder.
    window.scrollTo({top: 0, behavior: "instant"});
  }
  function choosePlateCompany(company: CoverageCompany) {
    setHotId(company.id);
    if (activeView === "discover" && visibleCompanies.some(item => item.id === company.id)) setExpandedCompanyId(company.id);
    else { setCoverageKeyword(""); setActiveView("coverage"); }
    setPendingScroll(company.id);
  }
  function closeDocument() { documentSequence.current++; setDocument(null); setDocumentLoading(null); setDocumentError(""); }

  async function openDocument(slug: "privacy" | "terms") {
    const sequence = ++documentSequence.current;
    setPrivacyFormOpen(false); setPrivacyReceipt(""); setSubmitError("");
    setDocumentError(""); setDocument(null); setDocumentLoading(slug);
    try { const next = await dataProvider.getDocument(slug); if (sequence === documentSequence.current) setDocument(next); }
    catch { if (sequence === documentSequence.current) setDocumentError("文档加载失败，请关闭后重试。"); }
    finally { if (sequence === documentSequence.current) setDocumentLoading(null); }
  }

  async function submitPrivacyRequest() {
    if (privacyContact.trim() === "" || privacyDescription.trim() === "" || submitBusy || submitError === UNKNOWN_WRITE_MESSAGE) return;
    setSubmitBusy(true); setSubmitError("");
    try {
      const receipt = await dataProvider.submitFeedback({issueType: privacyType, contact: privacyContact.trim(), description: privacyDescription.trim()});
      setPrivacyReceipt(`隐私请求已提交，回执 ${receipt.id}`); setPrivacyContact(""); setPrivacyDescription("");
    } catch (error) { setSubmitError(submissionErrorMessage(error)); }
    finally { setSubmitBusy(false); }
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
    const initialCity = dataProvider.supportsCityPendingSearch ? ALL_CITIES : SEARCH_CITIES[0];
    setCity(initialCity);
    void executeSearch({
      ...(dataProvider.supportsCityPendingSearch ? { province: ALL_PROVINCES } : {}),
      city: initialCity,
      keyword: "",
      categories: [],
      sort: "PINYIN_ASC",
      onlyNew: false
    });
  }

  async function handleSearch() {
    if (consentState !== "accepted" || city === "" || isSearching) {
      return;
    }

    await executeSearch({
      ...(dataProvider.supportsCityPendingSearch ? { province } : {}),
      city,
      keyword,
      categories: selectedCategories,
      sort,
      onlyNew
    });
  }

  async function executeSearch(request: SearchRequest) {
    if (searchBusy.current) return;
    searchWork.current?.cancel();
    const sequence = ++searchRequestSequence.current;
    searchBusy.current = true;
    setLocationOpen(null);
    setIsSearching(true);
    setSearchFailed(false);
    setFeedbackDraft(null);
    setFeedbackMessage("");

    const cancel = startBoundedSnapshotRequest({
      request: (signal, snapshotCheck) => dataProvider.searchJobs(request, {
        signal, ...(snapshotCheck !== undefined ? { snapshotCheck } : {})
      }),
      onResult: (result, refreshing) => {
        if (sequence !== searchRequestSequence.current) return;
        setSearchResult(result);
        if (!refreshing) { setExpandedCompanyId(null); setRowCaps({}); }
      },
      onError: (_error, refreshing) => { if (!refreshing && sequence === searchRequestSequence.current) setSearchFailed(true); },
      onInitialSettled: () => {
        if (sequence !== searchRequestSequence.current) return;
        searchBusy.current = false;
        setIsSearching(false);
      }
    });
    searchWork.current = {
      cancel,
      context: JSON.stringify(["accepted", request.province ?? province, request.city, request.keyword, request.categories, request.sort, request.onlyNew]),
      provider: dataProvider
    };
  }

  function clearSearchFilters() {
    if (isLocked || searchBusy.current) return;
    setKeyword(""); setSelectedCategories([]); setOnlyNew(false);
    void executeSearch({
      ...(dataProvider.supportsCityPendingSearch ? {province} : {}),
      city, keyword: "", categories: [], sort, onlyNew: false
    });
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
    setSubmitError("");
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
    if (!feedbackDraft || !feedbackDraft.issueType.trim() || !feedbackDraft.description.trim() || submitBusy || submitError === UNKNOWN_WRITE_MESSAGE) return;
    setSubmitBusy(true); setSubmitError("");
    try {
      await dataProvider.submitFeedback({ issueType: feedbackDraft.issueType, description: feedbackDraft.description,
        ...(feedbackDraft.companyId === undefined ? {} : {companyId: feedbackDraft.companyId}),
        ...(feedbackDraft.jobId === undefined ? {} : {jobId: feedbackDraft.jobId}) });
      setFeedbackMessage("反馈已提交，待人工核查。"); setFeedbackDraft(null);
    } catch (error) { setSubmitError(submissionErrorMessage(error)); }
    finally { setSubmitBusy(false); }
  }
  async function submitRecommendation() {
    if (!recommendCompanyName.trim() || !recommendWebsiteUrl.trim() || submitBusy || submitError === UNKNOWN_WRITE_MESSAGE) return;
    setSubmitBusy(true); setSubmitError("");
    try {
      await dataProvider.recommendCompany({companyName: recommendCompanyName.trim(), officialWebsiteUrl: recommendWebsiteUrl.trim()});
      setRecommendMessage("已收到推荐，公司会进入管理员复核队列。"); setRecommendCompanyName(""); setRecommendWebsiteUrl("");
    } catch (error) { setSubmitError(submissionErrorMessage(error)); }
    finally { setSubmitBusy(false); }
  }

  const provinceOptions: LocationOption[] = [
    {value: ALL_PROVINCES}, ...DESIGN_REGIONS.map(([value, group]) => ({value, group, count: searchResult?.provinceFacets?.find(facet => facet.province === value)?.jobCount ?? (searchResult ? 0 : undefined)}))
  ];
  const cityOptions: LocationOption[] = [{value: ALL_CITIES, count: allCitiesCount}];
  const regionCities = province === ALL_PROVINCES ? cityFacets.map(facet => facet.city) : [...new Set([...(DESIGN_REGIONS.find(([name]) => name === province)?.[2] ?? []), ...cityFacets.map(facet => facet.city)])];
  const concreteCities = regionCities.filter(value => value !== NATIONWIDE && value !== CITY_PENDING && value !== ALL_CITIES)
    .map(value => ({value, count: cityFacets.find(facet => facet.city === value)?.jobCount ?? (searchResult ? 0 : undefined)}));
  if (province === ALL_PROVINCES) cityOptions.push({value: NATIONWIDE, count: cityFacets.find(facet => facet.city === NATIONWIDE)?.jobCount ?? (searchResult ? 0 : undefined)});
  cityOptions.push({value: CITY_PENDING, count: cityPendingCount});
  cityOptions.push(...concreteCities.filter(item => item.count !== 0).map(item => ({...item, group: "有已发布职位"})), ...concreteCities.filter(item => item.count === 0).map(item => ({...item, group: "暂无已发布职位"})));
  const hasSearch = searchResult !== null && !isSearching && !searchFailed;
  const plateBeforeFinder = mobile && activeView === "discover";
  const plate = <CompanyPlate companies={plateCompanies} result={hasSearch ? searchResult : null} ready={!isLocked} hotId={hotId} onHot={setHotId} onChoose={choosePlateCompany} loading={coverageLoading} failed={coverageFailed} onRetry={() => setCoverageRetry(value => value + 1)} />;
  const companyIndex = (id: string) => { const index = plateCompanies.findIndex(company => company.id === id); return index < 0 ? "—" : coordinate(index); };
  const navigation = <section className="primary-nav" aria-label="产品流程">
            <button type="button" aria-current={activeView === "discover" ? "page" : undefined} onClick={() => changeView("discover")}><List className="ic" />职位发现</button>
            <button type="button" aria-current={activeView === "coverage" ? "page" : undefined} onClick={() => changeView("coverage")}><Building2 className="ic" />官方招聘目录</button>
          </section>;
  return <div className={`app-shell${locationOpen ? " pop-open" : ""}`} data-consent={consentState}>
    <div className="public-page" aria-hidden={isLocked || document !== null || documentLoading !== null || documentError !== "" || feedbackDraft !== null ? true : undefined} inert={isLocked || document !== null || documentLoading !== null || documentError !== "" || feedbackDraft !== null}>
      <section className="hero">
        <header className="topbar"><div className="wrap">
          <div className="brand"><div className="brand-mark" aria-hidden="true">J</div><div><div className="brand-name">Job-search</div><div className="brand-sub">中国医药官方职位聚合</div></div></div>
          {!mobile ? navigation : null}
          <div className="top-actions"><button className="ghost-nav" aria-label="隐私说明" type="button" onClick={() => void openDocument("privacy")}><ShieldCheck className="ic" /><span>隐私说明</span></button></div>
        </div></header>
        <div className="wrap hero-grid"><div className="hero-copy">
          <p className="eyebrow">Official career entries · China pharma</p>
          <h1>{activeView === "discover" ? <><span>官方发布的</span><span className="l2">药企职位</span></> : <><span>官方招聘</span><span className="l2">目录</span></>}</h1>
          <p className="hero-lead">{activeView === "discover" ? "按城市、岗位类别查看目标药企的官方招聘信息。每个职位跳转到企业官网或企业明确背书的官方招聘入口。" : "全部目标公司都在目录里，每家公司的更新状态一目了然，并附官方招聘入口。"}</p>
          <ul className="proofs"><li><Check className="ic" />仅展示来源可核验的官方职位，不作抓全声明</li><li><Check className="ic" />地点冲突保留为城市待核</li><li><Check className="ic" />职位信息以官方来源为准</li></ul>
        </div><div id="plateSlot">{!narrow ? plate : null}</div></div>
      </section>
      <div className="wrap stage" ref={stageRef}>
        {plateBeforeFinder ? <div className="plate-m">{plate}</div> : null}
        {activeView === "discover" ? <form className={`finder${finderStuck && locationOpen === null ? " is-stuck" : ""}`} aria-label="搜索条件" onSubmit={event => {event.preventDefault(); void handleSearch();}}>
          <div className="finder-main">
            <label className="field kw"><span className="lbl">职位关键词</span><span className="control"><Search className="ic" /><input aria-label="职位关键词" placeholder="职位、公司或岗位类别" type="search" disabled={isLocked} value={keyword} onChange={event => setKeyword(event.target.value)} /></span></label>
            {dataProvider.supportsCityPendingSearch ? <>
              <LocationPicker label="省份/地区" value={province} options={provinceOptions} open={locationOpen === "province"} onOpen={() => setLocationOpen("province")} onClose={() => setLocationOpen(null)} disabled={isLocked} icon={<MapPin className="ic" />} onSelect={value => {setProvince(value);setCity(ALL_CITIES);setLocationOpen("city");}} />
              <LocationPicker label="城市/地区" value={city || ALL_CITIES} options={cityOptions} open={locationOpen === "city"} onOpen={() => setLocationOpen("city")} onClose={() => setLocationOpen(null)} disabled={isLocked} icon={<Building2 className="ic" />} onSelect={value => {setCity(value);setLocationOpen(null);}} />
            </> : <div className="legacy-cities" role="radiogroup" aria-label="城市">{SEARCH_CITIES.map(option => <label className="check" key={option}><input checked={city === option} name="city" onChange={() => setCity(option)} type="radio" value={option} /><span className="box"><Check className="ic" /></span><MapPin className="ic" />{option}</label>)}</div>}
            <button className="btn-primary" disabled={isLocked || isSearching} type="submit"><Search className="ic" />{isSearching ? "搜索中" : "搜索职位"}<ArrowRight className="ic go" /></button>
          </div>
          {dataProvider.supportsCityPendingSearch ? <p className="finder-note" id="city-facet-note"><Info className="ic" /><span>{searchResult === null ? "职位加载后可查看已发布地区的职位数量。" : ""}城市数字为明确该城市/地区的岗位数，不含全国和城市待核，不随关键词等筛选变化；全部地区下按具体城市搜索时，同时包含全国岗位，选定省份后不含全国岗位。</span></p> : null}
          {city === CITY_PENDING ? <p className="finder-note">官方地点未明确到城市或存在冲突；城市待核职位不计入具体城市/地区筛选。已明确省份的职位可在该省的全部城市和城市待核中查看。</p> : null}
        </form> : <div className="dirbar"><p>全部目标公司均在目录中；状态会明确区分自动更新、核验中与仅提供官方入口。</p><label className="field"><span className="lbl">搜索已覆盖公司</span><span className="control"><Search className="ic" /><input type="search" aria-label="搜索已覆盖公司" placeholder="搜索已覆盖公司" value={coverageKeyword} onChange={event => setCoverageKeyword(event.target.value)} /></span></label></div>}
        {!plateBeforeFinder ? <div className="plate-m">{narrow ? plate : null}</div> : null}
        {activeView === "discover" ? <main className="board" aria-label="职位发现">
          <div><button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen(value => !value)}><span><SlidersHorizontal className="ic" /> 筛选条件</span><ChevronDown className="ic" /></button>
            <aside className="filters" id="filters" data-open={filtersOpen} aria-label="筛选条件"><h2><SlidersHorizontal className="ic" />筛选条件</h2>
              <div><div className="group-title">岗位类别</div><div className="category-filters">{JOB_CATEGORIES.map(category => <div className="category-group" key={category}>
                <label className="check"><input checked={selectedCategories.includes(category)} onChange={() => toggleCategory(category)} type="checkbox" /><span className="box"><Check className="ic" /></span>{category}</label>
                {JOB_CATEGORY_GROUPS[category].length > 0 ? <details className="category-subfilters"><summary>{category}细分<ChevronDown className="ic" /></summary><div className="checks">{JOB_CATEGORY_GROUPS[category].map(subcategory => <label className="check" key={subcategory}><input checked={selectedCategories.includes(subcategory)} onChange={() => toggleCategory(subcategory)} type="checkbox" /><span className="box"><Check className="ic" /></span>{subcategory}</label>)}</div></details> : null}
              </div>)}</div></div>
              <label className="switch"><span><Sparkles className="ic" /> 只看新增</span><input checked={onlyNew} onChange={event => setOnlyNew(event.target.checked)} type="checkbox" /><span className="track" /></label>
              <div><div className="group-title">排序</div><div className="seg" aria-label="排序">{([["PINYIN_ASC", "拼音 A-Z"], ["LATEST", "最新发布"], ["JOB_COUNT_DESC", "职位数量"]] as const).map(([value, label]) => <button key={value} aria-pressed={sort === value} onClick={() => setSort(value)} type="button">{label}<Check className="ic" /></button>)}</div></div>
            </aside>
          </div>
          <div className="results">
            <section className="results-head" aria-label="职位概览">
              {hasSearch ? <><div><p className="kicker">当前筛选匹配</p><h2 className="results-title" aria-label={`${visibleJobCount} 个职位`}><b className="num">{visibleJobCount}</b><span>个职位</span></h2><p className="results-sub">{visibleCompanies.length} 家公司</p></div>
                <div className="results-meta">{searchResult?.publishedJobSummary ? <p>全部已发布职位 {searchResult.publishedJobSummary.totalJobs} 个，其中城市待核 {searchResult.publishedJobSummary.cityPendingJobs} 个（不随筛选变化）</p> : null}
                  {searchResult?.coverageSummary ? <p>当前已更新 {searchResult.coverageSummary.publishingCompanyCount}/{searchResult.coverageSummary.requiredCompanyCount} 家目标企业{searchResult.coverageSummary.publishingCompanyCount < searchResult.coverageSummary.requiredCompanyCount ? "，其他来源仍在核验" : ""}{searchResult.coverageSummary.degradedCompanyCount > 0 ? `；${searchResult.coverageSummary.degradedCompanyCount} 家近期更新异常` : ""}</p> : null}
                  {searchResult?.snapshotStorage === "SAVED" ? <p role="status">已保存的公开快照；更新时间保留自原核验。</p> : null}
                  <p>最后更新 {formatTimestamp(searchResult?.lastUpdatedAt ?? null)}{searchResult?.lastUpdatedAt ? " UTC" : ""}</p>
                </div></> : <div><p className="kicker">职位结果</p><div className="results-title"><b className="num">—</b></div><p className="results-sub">{isLocked ? "完成使用前确认后自动加载职位。" : isSearching ? "正在加载职位，请稍候…" : searchFailed ? "暂时无法获取职位数据。" : "职位尚未加载。"}</p></div>}
            </section>
            <p className="sort-note">排序日期采用官网职位列表记录；地点冲突保留为城市待核</p>
            {feedbackMessage ? <p className="banner"><CheckCircle2 className="ic" />{feedbackMessage}</p> : null}
            <section className="list" aria-label="公司职位列表" aria-busy={isSearching}>
              {isSearching ? <div className="empty" role="status"><Search className="ic" /><p>正在加载官方职位…</p></div> : searchFailed ? <div className="empty" role="alert"><p>职位加载失败，请重试。</p><button className="btn-primary" onClick={() => void handleSearch()} type="button">重新加载职位</button></div> : searchResult === null ? <div className="empty"><BriefcaseBusiness className="ic" /><p>完成使用前确认后，将自动展示官方职位分组结果。</p></div> : !visibleCompanies.length ? <div className="empty"><Search className="ic" /><p>当前筛选下没有匹配职位。</p><button type="button" className="btn-line" onClick={clearSearchFilters}>清除关键词与类别筛选</button></div> : visibleCompanies.map(company => {
                const expanded = expandedCompanyId === company.id, cap = rowCaps[company.id] ?? DEFAULT_COMPANY_ROW_CAP;
                return <article className={`co${hotId === company.id ? " is-link" : ""}`} data-open={expanded} data-testid={`company-${company.id}`} id={`row-${company.id}`} key={company.id} onMouseEnter={() => setHotId(company.id)} onMouseLeave={() => setHotId(null)}>
                  <button className="co-head" aria-expanded={expanded} aria-controls={`jobs-${company.id}`} onClick={() => toggleCompany(company.id)} type="button"><span className="coord">{companyIndex(company.id)}</span><CompanyLogo companyId={company.id} name={company.companyName} className="tk-row" /><strong className="co-name">{company.companyName}</strong><span className="co-count"><b>{company.jobs.length}</b><span>个职位</span></span><span className="co-go"><ChevronDown className="ic" /></span></button>
                  {company.id === "company-novo-nordisk-china" ? <p className="source-scope-note">{NOVO_SOURCE_NOTE}</p> : company.id === "company-organon-china" ? <p className="source-scope-note">{ORGANON_SOURCE_NOTE}</p> : null}
                  {company.sourceScopeNote ? <p className="source-scope-note">{company.sourceScopeNote}</p> : null}
                  <div className="co-body"><div className="co-inner" id={`jobs-${company.id}`} inert={!expanded} aria-hidden={!expanded}>{expanded ? <div className="jobs">
                    {company.jobs.slice(0, cap).map((job, index) => <div className="job" key={job.id}><span className="job-idx">{String(index + 1).padStart(2, "0")}</span>
                      <div><h3>{job.title}{job.cityPending ? <span className="badge pend">官方城市尚未核实</span> : job.city === NATIONWIDE ? <span className="badge nat">全国岗位</span> : null}{job.isNew ? <span className="badge new"><Sparkles className="ic" />新增</span> : null}</h3><p className="en">{job.officialTitle}</p></div>
                      <div className="job-meta"><span><MapPin className="ic" />{job.cityPending ? `官方原始地点：${job.locationRaw}` : job.locationRaw}</span><span><BriefcaseBusiness className="ic" />{job.category}{job.subcategory ? ` · ${job.subcategory}` : ""}</span></div>
                      <div className="job-actions"><a className="btn-solid" aria-label={`查看官方职位 ${job.title}`} href={job.officialUrl} rel="noreferrer" target="_blank">查看官方职位<ExternalLink className="ic" /></a><button className="btn-text" aria-label={`反馈此职位 ${job.title}`} onClick={() => openFeedback(company, job)} type="button"><Flag className="ic" />反馈此职位</button></div>
                    </div>)}
                    {company.jobs.length > cap ? <button className="more" type="button" onClick={() => setRowCaps(current => ({...current, [company.id]: company.jobs.length}))}>查看全部 {company.jobs.length} 个职位<ChevronDown className="ic" /></button> : null}
                  </div> : null}</div></div>
                </article>;
              })}
            </section>
          </div>
        </main> : <section className="dir" aria-label="公司目录"><h2 className="sr-only">官方招聘目录</h2><div className="dir-head"><span>孔位</span><span>公司</span><span>状态</span><span>说明</span><span className="h-upd">最近成功更新</span><span>官方入口</span></div>
          {coverageLoading ? <div className="empty" role="status">正在加载公司目录…</div> : coverageFailed ? <div className="empty" role="alert"><p>公司目录加载失败，请重试。</p><button className="btn-primary" onClick={() => setCoverageRetry(value => value + 1)} type="button">重新加载公司目录</button></div> : !coverageResults.length ? <p className="empty">没有符合当前关键词的公司。</p> : coverageResults.map(company => {
            const url = company.officialCareersUrl ?? company.officialWebsiteUrl;
            return <article className={`dr${hotId === company.id ? " is-link" : ""}`} id={`row-${company.id}`} key={company.id} onMouseEnter={() => setHotId(company.id)} onMouseLeave={() => setHotId(null)}><span className="coord">{companyIndex(company.id)}</span><div className="dco"><CompanyLogo companyId={company.id} name={company.companyName} className="tk-row" /><div><strong className="dname">{company.companyName}</strong><p className="dcat">{COMPANY_CATEGORY_LABELS[company.category]}</p></div></div>
              <div className="dstate"><span className="pill" data-state={company.state}>{PUBLICATION_STATE_LABELS[company.state]}</span>{company.health === "DEGRADED" ? <span className="pill health">近期更新异常</span> : null}</div>
              <div className="dnote"><p>{publicationNote(company)}</p>{company.sourceScopeNote ? <p>{company.sourceScopeNote}</p> : null}</div><p className="dupd">{company.lastSuccessAt ? <>最近成功更新 {formatTimestamp(company.lastSuccessAt)} UTC</> : "暂无成功更新"}</p>
              {url ? <a className="btn-line" aria-label={company.officialCareersUrl ? `查看${company.companyName}官方招聘入口` : `访问${company.companyName}公司官网`} href={url} rel="noreferrer" target="_blank">{company.officialCareersUrl ? "官方招聘入口" : "公司官网"}<ExternalLink className="ic" /></a> : <p className="none">暂无可用公开链接。</p>}
            </article>;
          })}
        </section>}
      </div>
      <section className="suggest" aria-label="辅助操作"><div className="wrap"><div className="suggest-top"><div><h2>目录里没有<br />你关注的药企？</h2><p>补充未覆盖但有官方招聘入口的药企，提交后进入管理员复核队列。</p></div><button className="btn-ink" aria-expanded={isRecommendationFormOpen} type="button" onClick={() => {setIsRecommendationFormOpen(current => !current);setRecommendMessage("");setSubmitError("");}}><Send className="ic" />推荐未覆盖公司</button></div>
        {isRecommendationFormOpen ? <form className="suggest-form" onSubmit={event => {event.preventDefault();void submitRecommendation();}}><label className="field"><span className="lbl">公司名称</span><span className="control"><input required aria-label="公司名称" value={recommendCompanyName} onChange={event => setRecommendCompanyName(event.target.value)} /></span></label><label className="field"><span className="lbl">官网链接</span><span className="control"><input required aria-label="官网链接" type="url" placeholder="https://" value={recommendWebsiteUrl} onChange={event => setRecommendWebsiteUrl(event.target.value)} /></span></label><button className="btn-primary" disabled={submitBusy || submitError === UNKNOWN_WRITE_MESSAGE} type="submit"><Send className="ic" />{submitBusy ? "提交中…" : "提交推荐"}</button></form> : null}
        {recommendMessage ? <p className="banner"><CheckCircle2 className="ic" />{recommendMessage}</p> : null}{submitError && isRecommendationFormOpen ? <p className="error-message" role="alert">{submitError}</p> : null}
      </div></section>
      <footer className="foot"><div className="wrap"><div><strong>Job-search</strong>中国医药官方职位聚合。仅展示来源可核验的官方职位，不作抓全声明。</div><div><strong>数据说明</strong>职位详情可能跳转到企业官网或企业明确背书的第三方官方招聘入口，离开本服务后由该入口的隐私规则负责。英文标题辅助翻译和岗位分类由 AI 或规则辅助生成，仅供参考，职位名称、职责、地点与申请条件均以官方来源为准。</div><div className="foot-links"><strong>政策</strong><button type="button" onClick={() => void openDocument("privacy")}>隐私政策</button><button type="button" onClick={() => void openDocument("terms")}>服务条款</button></div></div><div className="mega" aria-hidden="true">Job-search</div></footer>
      {mobile ? navigation : null}
    </div>
    {locationOpen ? <div className="scrim" onClick={() => setLocationOpen(null)} aria-hidden="true" /> : null}
    {consentState === "pending" && document === null && documentLoading === null && !documentError ? <Modal title="使用前确认" onClose={closeConsent} closeLabel="关闭确认弹窗" icon={<LockKeyhole className="ic" />}><p>先完成同意，前台才会请求职位搜索结果。</p><label className="consent-check"><input checked={hasCheckedConsent} onChange={event => setHasCheckedConsent(event.target.checked)} type="checkbox" /><span className="box"><Check className="ic" /></span><span>我已阅读并同意 <a href="/privacy" onClick={event => {event.preventDefault();void openDocument("privacy");}}>隐私政策</a> 和 <a href="/terms" onClick={event => {event.preventDefault();void openDocument("terms");}}>服务条款</a></span></label><button className="btn-primary" disabled={!hasCheckedConsent} onClick={acceptConsent} type="button">进入 Job-search<ArrowRight className="ic" /></button></Modal> : null}
    {consentState === "closed" && document === null && documentLoading === null && !documentError ? <Modal title="页面已锁定" heading="使用前请先完成确认" icon={<LockKeyhole className="ic" />}><p>关闭确认后，职位搜索会保持锁定。</p><button className="btn-primary" onClick={() => setConsentState("pending")} type="button">重新打开确认</button><div className="actions"><button className="btn-line" onClick={() => void openDocument("privacy")} type="button">查看隐私说明</button><button className="btn-line" onClick={() => void openDocument("terms")} type="button">查看使用条款</button></div></Modal> : null}
    {document !== null || documentLoading !== null || documentError ? <Modal title={document?.title ?? "文档内容"} onClose={closeDocument} closeLabel="关闭文档" wide plain ariaLabel="文档内容" icon={<FileText className="ic" />}><div className="doc-body">{documentError || (documentLoading ? "正在加载文档…" : document?.body)}</div>
      {document?.slug === "privacy" ? <div className="stack"><button className="btn-line" onClick={() => {setPrivacyFormOpen(value => !value);setSubmitError("");}} type="button">提交数据导出/删除请求</button>{privacyFormOpen ? <form className="stack" onSubmit={event => {event.preventDefault();void submitPrivacyRequest();}}><label className="field"><span className="lbl">请求类型</span><span className="control"><select aria-label="隐私请求类型" value={privacyType} onChange={event => setPrivacyType(event.target.value as typeof privacyType)}><option value="PRIVACY_EXPORT">隐私数据导出</option><option value="PRIVACY_DELETE">隐私数据删除</option></select><ChevronDown className="ic" /></span></label><label className="field"><span className="lbl">联系方式</span><span className="control"><input required aria-label="隐私请求联系方式" placeholder="邮箱或其他联系渠道" value={privacyContact} onChange={event => setPrivacyContact(event.target.value)} /></span></label><label className="field"><span className="lbl">说明</span><textarea className="area" required aria-label="隐私请求说明" rows={3} placeholder="说明请求范围，不要上传身份证件。" value={privacyDescription} onChange={event => setPrivacyDescription(event.target.value)} /></label><button className="btn-primary" disabled={submitBusy || submitError === UNKNOWN_WRITE_MESSAGE} type="submit">{submitBusy ? "提交中…" : "提交隐私请求"}</button>{privacyReceipt ? <p className="receipt">{privacyReceipt}</p> : null}{submitError ? <p className="error-message" role="alert">{submitError}</p> : null}</form> : null}</div> : null}
    </Modal> : null}
    {feedbackDraft ? <Modal title="职位反馈" onClose={() => setFeedbackDraft(null)} closeLabel="关闭职位反馈" drawer icon={<Flag className="ic" />}><div className="ctx"><b>{feedbackDraft.companyName}</b><span>{feedbackDraft.jobTitle}</span></div><form className="stack" onSubmit={event => {event.preventDefault();void submitFeedback();}}><label className="field"><span className="lbl">反馈类型</span><span className="control"><select required aria-label="反馈类型" value={feedbackDraft.issueType} onChange={event => setFeedbackDraft(current => current ? {...current, issueType: event.target.value} : current)}><option value="">请选择</option><option>职位信息有误</option><option>链接不可用</option><option>重复职位</option></select><ChevronDown className="ic" /></span></label><label className="field"><span className="lbl">反馈内容</span><textarea required className="area" aria-label="反馈内容" rows={4} placeholder="请描述你发现的问题，不要填写身份证件、简历等个人信息。" value={feedbackDraft.description} onChange={event => setFeedbackDraft(current => current ? {...current, description: event.target.value} : current)} /></label><div className="actions"><button className="btn-line" type="button" onClick={() => setFeedbackDraft(null)}>取消</button><button className="btn-primary" disabled={submitBusy || submitError === UNKNOWN_WRITE_MESSAGE} type="submit">{submitBusy ? "提交中…" : "提交反馈"}</button></div>{submitError ? <p className="error-message" role="alert">{submitError}</p> : null}</form></Modal> : null}
  </div>;
}
