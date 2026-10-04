/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import type {
  AppDataProvider,
  CoverageResult,
  FeedbackReceipt,
  SearchResult,
  StaticDocumentResult
} from "../../src/app/appDataProvider";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createRecordingProvider() {
  const searchResult: SearchResult = {
    companies: [
      {
        id: "astrazeneca",
        companyName: "阿斯利康",
        pinyin: "a si li kang",
        jobs: [
          {
            id: "az-msl-1",
            title: "医学科学联络官",
            officialTitle: "Medical Science Liaison",
            officialPublishedAt: "2026-07-08T08:00:00.000Z",
            city: "北京",
            locationRaw: "北京",
            category: "医学事务",
            isNew: true,
            officialUrl: "https://careers.astrazeneca.com.cn/msl"
          },
          {
            id: "az-sales-1",
            title: "区域销售经理",
            officialTitle: "Regional Sales Manager",
            officialPublishedAt: "2026-07-07T08:00:00.000Z",
            city: "北京",
            locationRaw: "北京",
            category: "销售",
            isNew: true,
            officialUrl: "https://careers.astrazeneca.com.cn/sales"
          },
          {
            id: "az-access-1",
            title: "市场准入经理",
            officialTitle: "Market Access Manager",
            officialPublishedAt: "2026-07-06T08:00:00.000Z",
            city: "北京",
            locationRaw: "北京",
            category: "市场准入",
            isNew: false,
            officialUrl: "https://careers.astrazeneca.com.cn/access"
          },
          {
            id: "az-medical-1",
            title: "医学顾问",
            officialTitle: "Medical Advisor",
            officialPublishedAt: "2026-07-05T08:00:00.000Z",
            city: "北京",
            locationRaw: "北京",
            category: "医学事务",
            isNew: false,
            officialUrl: "https://careers.astrazeneca.com.cn/advisor"
          }
        ]
      },
      {
        id: "pfizer",
        companyName: "辉瑞",
        pinyin: "hui rui",
        jobs: [
          {
            id: "pfizer-msl-1",
            title: "肿瘤 MSL",
            officialTitle: "Oncology MSL",
            officialPublishedAt: "2026-07-09T07:00:00.000Z",
            city: "北京",
            locationRaw: "India - Vizag | APAC - Any Pfizer Site",
            category: "医学事务",
            isNew: true,
            officialUrl: "https://www.pfizer.com.cn/careers/msl"
          },
          {
            id: "pfizer-sales-1",
            title: "地区销售主管",
            officialTitle: "Area Sales Lead",
            officialPublishedAt: "2026-07-04T08:00:00.000Z",
            city: "北京",
            locationRaw: "北京",
            category: "销售",
            isNew: false,
            officialUrl: "https://www.pfizer.com.cn/careers/sales"
          }
        ]
      }
    ],
    totalJobs: 6,
    lastUpdatedAt: "2026-07-08T09:00:00.000Z"
  };

  const coverageResult: CoverageResult = {
    companies: [
      {
        id: "astrazeneca",
        companyName: "阿斯利康",
        officialWebsiteUrl: "https://www.astrazeneca.com.cn/",
        officialCareersUrl: "https://careers.astrazeneca.com.cn/",
        category: "FOREIGN_PHARMA",
        state: "PUBLISHING",
        health: "DEGRADED",
        lastSuccessAt: "2026-07-13T08:00:00.000Z"
      },
      {
        id: "pfizer",
        companyName: "辉瑞",
        officialWebsiteUrl: "https://www.pfizer.com.cn/",
        officialCareersUrl: "https://www.pfizer.com/about/careers",
        category: "FOREIGN_PHARMA",
        state: "VERIFYING",
        health: "NOT_APPLICABLE",
        lastSuccessAt: null
      },
      {
        id: "lilly",
        companyName: "礼来",
        officialWebsiteUrl: "https://www.lilly.com/cn/",
        officialCareersUrl: "https://careers.lilly.com/zh-cn/",
        category: "FOREIGN_PHARMA",
        state: "OFFICIAL_LINK_ONLY",
        health: "NOT_APPLICABLE",
        lastSuccessAt: null
      },
      {
        id: "no-public-entry",
        companyName: "无公开入口药企",
        officialWebsiteUrl: "https://official.example/no-entry",
        officialCareersUrl: null,
        category: "DOMESTIC_PHARMA",
        state: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
        health: "NOT_APPLICABLE",
        lastSuccessAt: null
      },
      {
        id: "humanwell",
        companyName: "人福医药集团股份公司",
        officialWebsiteUrl: "http://www.humanwell.com.cn/",
        officialCareersUrl: null,
        category: "DOMESTIC_PHARMA",
        state: "USER_AUTHORIZED_PHASE1_EXCLUSION",
        health: "NOT_APPLICABLE",
        lastSuccessAt: null
      }
    ],
    offset: 0,
    limit: 60,
    hasMore: false
  };

  const receipt: FeedbackReceipt = { id: "receipt-1", status: "OPEN" };

  const documents: Record<"privacy" | "terms", StaticDocumentResult> = {
    privacy: {
      slug: "privacy",
      title: "隐私说明",
      body: "本服务在用户明确同意前，不提供职位搜索。"
    },
    terms: {
      slug: "terms",
      title: "使用条款",
      body: "本服务仅用于求职信息查询与纠错反馈。"
    }
  };

  const searchJobs = vi.fn(async (request) => request && searchResult);
  const listCoverage = vi.fn(async (request) => ({
    ...coverageResult,
    companies: coverageResult.companies.filter(({ companyName }) =>
      request.keyword === "" || companyName.includes(request.keyword)
    )
  }));
  const submitFeedback = vi.fn(async (request) => request && receipt);
  const recommendCompany = vi.fn(async (request) => request && receipt);
  const getDocument = vi.fn(async (slug: "privacy" | "terms") => documents[slug]);

  const provider: AppDataProvider = {
    supportsCityPendingSearch: false,
    searchJobs,
    listCoverage,
    submitFeedback,
    recommendCompany,
    getDocument
  };

  return {
    provider,
    searchJobs,
    listCoverage,
    submitFeedback,
    recommendCompany,
    getDocument
  };
}

describe("App product flows", () => {
  async function selectLocation(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
    const combo = screen.getByRole("combobox", {name: label});
    if (combo.getAttribute("aria-expanded") !== "true") await user.click(combo);
    const list = screen.getByRole("listbox", {name: label});
    await user.click(within(list).getByRole("option", {name: new RegExp(`^${value}(?: |$)`)}));
  }
  async function openLocation(user: ReturnType<typeof userEvent.setup>, label: string) {
    const combo = screen.getByRole("combobox", {name: label});
    if (combo.getAttribute("aria-expanded") !== "true") await user.click(combo);
    return screen.getByRole("listbox", {name: label});
  }

  async function acceptConsent(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "进入 Job-search" }));
  }

  async function runBeijingSearch(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("radio", { name: "北京" }));
    await user.click(screen.getByRole("button", { name: "搜索职位" }));
  }

  it("keeps search locked before consent and allows privacy and terms before search", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();
    expect(recording.searchJobs).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", {name: "0 个职位"})).not.toBeInTheDocument();
    expect(screen.queryByText("0 家公司")).not.toBeInTheDocument();
    expect(screen.queryByText(/最后更新/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "隐私政策" }));
    expect(await screen.findByRole("heading", { name: "隐私说明" })).toBeInTheDocument();
    expect(recording.getDocument).toHaveBeenCalledWith("privacy");
    expect(recording.searchJobs).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "关闭文档" }));

    await user.click(screen.getByRole("link", { name: "服务条款" }));
    expect(await screen.findByRole("heading", { name: "使用条款" })).toBeInTheDocument();
    expect(recording.getDocument).toHaveBeenCalledWith("terms");
    expect(recording.searchJobs).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "关闭文档" }));

    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    expect(screen.getByText("使用前请先完成确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新打开确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看隐私说明" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看使用条款" })).toBeInTheDocument();
    expect(recording.searchJobs).not.toHaveBeenCalled();
  });

  it("loads all-city results once after explicit consent and preserves later filters across views", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = true;
    render(<StrictMode><App dataProvider={recording.provider} /></StrictMode>);

    await acceptConsent(user);

    expect(recording.searchJobs).toHaveBeenCalledExactlyOnceWith({
      province: "全部地区", city: "全部城市", keyword: "", categories: [], sort: "PINYIN_ASC", onlyNew: false
    });
    expect(await screen.findByRole("heading", {name: "6 个职位"})).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司职位列表"})).getByRole("button", { name: /阿斯利康/ })).toBeInTheDocument();

    await selectLocation(user, "城市/地区", "城市待核");
    await user.type(screen.getByPlaceholderText("职位、公司或岗位类别"), "MSL");
    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.click(screen.getByRole("button", { name: "官方招聘目录" }));
    await user.click(screen.getByRole("button", { name: "职位发现" }));

    expect(screen.getByRole("combobox", { name: "城市/地区" })).toHaveTextContent("城市待核");
    expect(screen.getByPlaceholderText("职位、公司或岗位类别")).toHaveValue("MSL");
    expect(screen.getByRole("checkbox", { name: "医学事务" })).toBeChecked();
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("shows loading without false zero counts and prevents duplicate search requests", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    const result = await recording.searchJobs({});
    recording.searchJobs.mockClear();
    let resolveSearch!: (result: SearchResult) => void;
    recording.searchJobs.mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve; }));
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载官方职位");
    expect(screen.getByText("数据加载后显示职位统计。")).toBeInTheDocument();
    expect(screen.queryByText("完成使用前确认后显示。")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "公司职位列表" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "搜索中" })).toBeDisabled();
    expect(screen.queryByRole("heading", {name: "0 个职位"})).not.toBeInTheDocument();
    expect(screen.queryByText("0 家公司")).not.toBeInTheDocument();
    expect(screen.queryByText(/最后更新/)).not.toBeInTheDocument();
    expect(screen.queryByText("当前筛选下没有匹配职位。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "搜索中" }));
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);

    await act(async () => resolveSearch(result));
    expect(screen.getByRole("heading", {name: "6 个职位"})).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索职位" })).toBeEnabled();
  });

  it("distinguishes failed requests from empty results and retries the user's current filters", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    recording.searchJobs.mockRejectedValueOnce(new Error("network unavailable"));
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("职位加载失败，请重试。");
    expect(screen.queryByRole("heading", {name: "0 个职位"})).not.toBeInTheDocument();
    expect(screen.queryByText("当前筛选下没有匹配职位。")).not.toBeInTheDocument();
    expect(screen.queryByText(/最后更新/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "上海" }));
    await user.type(screen.getByPlaceholderText("职位、公司或岗位类别"), "MSL");
    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.click(screen.getByRole("button", { name: "重新加载职位" }));
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({
      city: "上海", keyword: "MSL", categories: ["医学事务"]
    }));
    expect(await within(screen.getByRole("region", { name: "职位概览" })).findByRole("heading", {name: "1 个职位"})).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    recording.searchJobs.mockRejectedValueOnce(new Error("server unavailable"));
    await user.click(screen.getByRole("button", { name: "搜索职位" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", {name: "1 个职位"})).not.toBeInTheDocument();
    expect(screen.queryByText(/最后更新/)).not.toBeInTheDocument();

    recording.searchJobs.mockResolvedValueOnce({ companies: [], totalJobs: 0, lastUpdatedAt: null });
    await user.click(screen.getByRole("button", { name: "重新加载职位" }));
    expect(await screen.findByText("当前筛选下没有匹配职位。")).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "0 个职位"})).toBeInTheDocument();
    expect(screen.getByText("0 家公司")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "上海" })).toBeChecked();
  });

  it("requires confirmation after closing the dialog and again after a fresh mount", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    const first = render(<App dataProvider={recording.provider} />);

    await user.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole("button", { name: "关闭确认弹窗" }));
    await user.click(screen.getByRole("button", { name: "重新打开确认" }));
    expect(screen.getByRole("button", { name: "进入 Job-search" })).toBeDisabled();
    expect(recording.searchJobs).not.toHaveBeenCalled();
    await acceptConsent(user);
    expect(await screen.findByRole("heading", {name: "6 个职位"})).toBeInTheDocument();
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);

    first.unmount();
    render(<App dataProvider={recording.provider} />);
    expect(screen.getByRole("dialog", { name: "使用前确认" })).toBeInTheDocument();
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("submits a privacy request before consent without loading jobs", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await user.click(screen.getByRole("link", { name: "隐私政策" }));
    await user.click(await screen.findByRole("button", { name: "提交数据导出/删除请求" }));
    await user.selectOptions(screen.getByLabelText("隐私请求类型"), "PRIVACY_EXPORT");
    await user.type(screen.getByLabelText("隐私请求联系方式"), "user@example.cn");
    await user.type(screen.getByLabelText("隐私请求说明"), "请导出我的反馈记录");
    await user.click(screen.getByRole("button", { name: "提交隐私请求" }));

    expect(recording.submitFeedback).toHaveBeenCalledWith({
      issueType: "PRIVACY_EXPORT", contact: "user@example.cn", description: "请导出我的反馈记录"
    });
    expect(recording.searchJobs).not.toHaveBeenCalled();
    expect(await screen.findByText(/回执/)).toBeInTheDocument();
  });

  it("passes current UI filters to the provider when searching", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await user.type(screen.getByPlaceholderText("职位、公司或岗位类别"), "MSL");
    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.click(screen.getByRole("checkbox", { name: "只看新增" }));
    await user.click(screen.getByRole("button", { name: "最新发布" }));
    await user.click(screen.getByRole("button", { name: "搜索职位" }));

    expect(recording.searchJobs).toHaveBeenCalledTimes(2);
    expect(recording.searchJobs).toHaveBeenCalledWith({
      city: "北京",
      keyword: "MSL",
      categories: ["医学事务"],
      sort: "LATEST",
      onlyNew: true
    });
  });

  it("offers concrete city choices and sends the selected city to the provider", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    expect(screen.getByRole("radio", { name: "北京" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "上海" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "广州" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "全部地点" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "上海" }));
    await user.click(screen.getByRole("button", { name: "搜索职位" }));

    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ city: "上海" }));
  });

  it("keeps legacy providers limited to their supported city choices", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = false;
    render(<App dataProvider={recording.provider} />);
    await acceptConsent(user);
    expect(screen.queryByRole('radio', { name: '城市待核' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '北京' })).toBeInTheDocument();
  });

  it("makes city-pending jobs discoverable and distinguishes matched jobs from published totals", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = true;
    const result = await recording.searchJobs({});
    result.companies = result.companies.slice(0, 1);
    result.companies[0]!.jobs = [{
      ...result.companies[0]!.jobs[0]!, title: '待核城市职位', city: '城市待核',
      cityPending: true, locationRaw: 'China / title: Shanghai; structured: Beijing'
    }];
    result.totalJobs = 1;
    result.publishedJobSummary = { totalJobs: 120, cityPendingJobs: 8 };
    render(<App dataProvider={recording.provider} />);
    await acceptConsent(user);
    await selectLocation(user, "城市/地区", "城市待核");
    await user.click(screen.getByRole('button', { name: '搜索职位' }));
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ city: '城市待核' }));
    const overview = screen.getByRole('region', { name: '职位概览' });
    expect(within(overview).getByRole("heading", {name: "1 个职位"})).toBeInTheDocument();
    expect(within(overview).getByText('当前筛选匹配')).toBeInTheDocument();
    expect(within(overview).getByText('全部已发布职位 120 个，其中城市待核 8 个（不随筛选变化）')).toBeInTheDocument();
    await user.click(await within(screen.getByRole("region", {name: "公司职位列表"})).findByRole("button", {name: /阿斯利康/}));
    expect(screen.getByText('官方城市尚未核实')).toBeInTheDocument();
    expect(screen.getByText('官方原始地点：China / title: Shanghai; structured: Beijing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看官方职位 待核城市职位' })).toHaveAttribute('href', result.companies[0]!.jobs[0]!.officialUrl);
    await user.type(screen.getByPlaceholderText('职位、公司或岗位类别'), '不存在');
    expect(within(overview).getByRole("heading", {name: "0 个职位"})).toBeInTheDocument();
    expect(within(overview).getByText('全部已发布职位 120 个，其中城市待核 8 个（不随筛选变化）')).toBeInTheDocument();
  });

  it("discovers all provinces and cities, resets city on province changes, and keeps published counts separate", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = true;
    const result = await recording.searchJobs({});
    result.publishedJobSummary = { totalJobs: 120, cityPendingJobs: 8 };
    result.provinceFacets = [
      { province: '四川', jobCount: 30, cityPendingJobs: 2 },
      { province: '江苏', jobCount: 50, cityPendingJobs: 3 },
      { province: '河南', jobCount: 2, cityPendingJobs: 2 }
    ];
    result.cityFacets = [
      { city: '成都', province: '四川', jobCount: 3 }, { city: '南京', province: '江苏', jobCount: 5 },
      { city: '全国', province: null, jobCount: 4 }, { city: '城市待核', province: null, jobCount: 8 }
    ];
    recording.searchJobs.mockClear();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent(user);

    const citySelect = screen.getByRole('combobox', { name: '城市/地区' });
    const provinceSelect = screen.getByRole('combobox', { name: '省份/地区' });
    expect(citySelect).toHaveTextContent('全部城市');
    expect(provinceSelect).toHaveTextContent('全部地区');
    await user.click(screen.getByRole('button', { name: '搜索职位' }));
    expect(recording.searchJobs).toHaveBeenCalledTimes(2);
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ province: '全部地区', city: '全部城市' }));
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '全部城市 120' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '南京 5' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '全国 4' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '城市待核 8' })).toBeInTheDocument();
    expect(screen.getByText(/明确该城市\/地区的岗位数.*全部地区.*同时包含全国岗位.*选定省份后不含全国岗位/)).toBeInTheDocument();

    await selectLocation(user, "城市/地区", "成都");
    await user.click(screen.getByRole('button', { name: '搜索职位' }));
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ city: '成都' }));
    await user.type(screen.getByPlaceholderText('职位、公司或岗位类别'), '不存在');
    const overview = screen.getByRole('region', { name: '职位概览' });
    expect(within(overview).getByRole("heading", {name: "0 个职位"})).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '成都 3' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '南京 5' })).toBeInTheDocument();
    expect(within(overview).getByText('全部已发布职位 120 个，其中城市待核 8 个（不随筛选变化）')).toBeInTheDocument();

    await selectLocation(user, "省份/地区", "江苏");
    expect(recording.searchJobs).toHaveBeenCalledTimes(3);
    expect(citySelect).toHaveTextContent('全部城市');
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '全部城市 50' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '城市待核 3' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).queryByRole('option', { name: /成都|全国/ })).not.toBeInTheDocument();
    await selectLocation(user, "城市/地区", "南京");
    await user.click(screen.getByRole('button', { name: '搜索职位' }));
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ province: '江苏', city: '南京' }));

    await selectLocation(user, "省份/地区", "河南");
    expect(citySelect).toHaveTextContent('全部城市');
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '全部城市 2' })).toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).queryByRole('option', { name: /南京|成都|全国/ })).not.toBeInTheDocument();
    expect(within(await openLocation(user, "城市/地区")).getByRole('option', { name: '城市待核 2' })).toBeInTheDocument();
    await selectLocation(user, "城市/地区", "城市待核");
    await user.click(screen.getByRole('button', { name: '搜索职位' }));
    expect(recording.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ province: '河南', city: '城市待核' }));
    expect(screen.getByText('官方地点未明确到城市或存在冲突；城市待核职位不计入具体城市/地区筛选。已明确省份的职位可在该省的全部城市和城市待核中查看。')).toBeInTheDocument();
  });

  it("loads grouped Beijing results after consent and updates by category and keyword", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);

    expect(await within(screen.getByRole("region", {name: "公司职位列表"})).findByText("阿斯利康")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司职位列表"})).getByText("辉瑞")).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "6 个职位"})).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.type(screen.getByPlaceholderText("职位、公司或岗位类别"), "MSL");

    await waitFor(() => {
      expect(within(screen.getByRole("region", {name: "公司职位列表"})).getByText("辉瑞")).toBeInTheDocument();
      expect(within(screen.getByRole("region", {name: "公司职位列表"})).queryByText("阿斯利康")).not.toBeInTheDocument();
      expect(screen.queryByText("区域销售经理")).not.toBeInTheDocument();
    });

    await user.click(within(screen.getByRole("region", {name: "公司职位列表"})).getByRole("button", { name: /辉瑞/ }));
    expect(screen.getByText("肿瘤 MSL")).toBeInTheDocument();
  });

  it("shows official job links and per-company cap control when expanding a company", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);

    await user.click(await within(screen.getByRole("region", {name: "公司职位列表"})).findByRole("button", { name: /阿斯利康/ }));

    const companyCard = screen.getByTestId("company-astrazeneca");
    expect(within(companyCard).getByText("医学科学联络官")).toBeInTheDocument();
    expect(within(companyCard).getByRole("link", { name: "查看官方职位 医学科学联络官" })).toHaveAttribute(
      "href",
      "https://careers.astrazeneca.com.cn/msl"
    );
    expect(within(companyCard).queryByText("医学顾问")).not.toBeInTheDocument();

    await user.click(within(companyCard).getByRole("button", { name: "查看全部 4 个职位" }));
    expect(within(companyCard).getByText("医学顾问")).toBeInTheDocument();
  });

  it("expands the eleventh verified job and shows portable coverage honestly", async () => {
    const user=userEvent.setup(),recording=createRecordingProvider();
    const result=await recording.searchJobs({});
    result.companies=result.companies.slice(0,1);
    result.companies[0]!.jobs=Array.from({length:11},(_,i)=>({...result.companies[0]!.jobs[0]!,id:`verified-${i}`,title:`已核验职位${i+1}`,officialTitle:`Verified Job ${i+1}`}));
    result.totalJobs=11;result.coverageSummary={requiredCompanyCount:40,publishingCompanyCount:1,excludedCompanyCount:1,degradedCompanyCount:0};
    render(<App dataProvider={recording.provider}/>);await acceptConsent(user);await runBeijingSearch(user);
    await user.click(await within(screen.getByRole("region", {name: "公司职位列表"})).findByRole("button",{name:/阿斯利康/}));
    expect(screen.queryByText("已核验职位11")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"查看全部 11 个职位"}));
    expect(screen.getByText("已核验职位11")).toBeInTheDocument();
    expect(screen.getByText(/当前已更新 1\/40 家目标企业/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "职位概览"})).getByText(/最后更新.*UTC/)).toBeInTheDocument();
  });

  it("shows publication-aware coverage states and prefers official careers before website fallback", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await user.click(screen.getByRole("button", { name: "官方招聘目录" }));
    expect(screen.getByRole("heading", {name: "官方招聘目录"})).toBeInTheDocument();
    expect(screen.queryByText(/60 家官方招聘目录/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(recording.listCoverage).toHaveBeenLastCalledWith({ keyword: "", offset: 0, limit: 60 });
    });
    expect(await within(screen.getByRole("region", {name: "公司目录"})).findByText("自动更新中")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("仅展示来源可核验的官方职位，不作抓全声明。")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("核验中")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("仅官方入口")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("暂无公开官方招聘入口")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("用户授权一期排除")).toBeInTheDocument();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("近期更新异常")).toBeInTheDocument();
    expect(screen.getByText("本期不对该公司职位完整性作声明。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看阿斯利康官方招聘入口" })).toHaveAttribute(
      "href",
      "https://careers.astrazeneca.com.cn/"
    );
    expect(screen.getByRole("link", { name: "访问无公开入口药企公司官网" })).toHaveAttribute(
      "href",
      "https://official.example/no-entry"
    );

    await user.type(screen.getByPlaceholderText("搜索已覆盖公司"), "辉");

    await waitFor(() => {
      expect(recording.listCoverage).toHaveBeenLastCalledWith({ keyword: "辉", offset: 0, limit: 60 });
    });

    expect(await within(screen.getByRole("region", {name: "公司目录"})).findByText("辉瑞")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看辉瑞官方招聘入口" })).toHaveAttribute(
      "href",
      "https://www.pfizer.com/about/careers"
    );
    expect(screen.queryByText("医学科学联络官")).not.toBeInTheDocument();
  });

  it.each([
    "石药官方社会招聘频道（人工 D36 指定入口）；仅覆盖该频道，不代表集团及子公司全量。",
    "施维雅中国 Moka 社会招聘门户（47734）；门户职位总量与已确认中国工作地的职位数量分开核验，未披露工作地的职位保持未知。"
  ])("keeps bounded source scope visible through collapse, reopen, and directory navigation: %s", async (note) => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    const search = await recording.searchJobs({});
    search.companies[0]!.sourceScopeNote = note;
    const coverage = await recording.listCoverage({keyword: ""});
    coverage.companies[0]!.sourceScopeNote = note;
    render(<App dataProvider={recording.provider} />);
    await acceptConsent(user);
    await runBeijingSearch(user);
    const card = screen.getByTestId("company-astrazeneca");
    expect(within(card).getByText(note)).toBeVisible();
    const toggle = within(card).getByRole("button", {name: /阿斯利康/});
    await user.click(toggle);
    expect(within(card).getByText(note)).toBeVisible();
    await user.click(toggle);
    expect(within(card).getByText(note)).toBeVisible();
    await user.click(screen.getByRole("button", {name: "官方招聘目录"}));
    expect(await screen.findByText(note)).toBeVisible();
    expect(within(screen.getByRole("region", {name: "公司目录"})).getByText("自动更新中")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("搜索已覆盖公司"), "辉");
    await waitFor(() => expect(screen.queryByText(note)).not.toBeInTheDocument());
  });

  it("submits contextual feedback with company and job ids", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);
    await user.click(await within(screen.getByRole("region", {name: "公司职位列表"})).findByRole("button", { name: /辉瑞/ }));
    await user.click(screen.getByRole("button", { name: "反馈此职位 肿瘤 MSL" }));
    await user.selectOptions(screen.getByLabelText("反馈类型"), "职位信息有误");
    await user.type(screen.getByLabelText("反馈内容"), "职位链接跳转错误");
    await user.click(screen.getByRole("button", { name: "提交反馈" }));

    await waitFor(() => {
      expect(recording.submitFeedback).toHaveBeenCalledWith({
          issueType: "职位信息有误",
          description: "职位链接跳转错误",
          companyId: "pfizer",
          jobId: "pfizer-msl-1"
        });
    });

    expect(await screen.findByText("反馈已提交，待人工核查。")).toBeInTheDocument();
  });

  it("applies only-new filtering and updates company order when sort changes", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);

    expect(screen.getByRole("heading", {name: "6 个职位"})).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "只看新增" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", {name: "3 个职位"})).toBeInTheDocument();
      expect(screen.queryByText("市场准入经理")).not.toBeInTheDocument();
    });

    const companyCards = () => screen.getAllByTestId(/company-/);

    expect(companyCards()[0]).toHaveAttribute("data-testid", "company-astrazeneca");
    expect(companyCards()[1]).toHaveAttribute("data-testid", "company-pfizer");

    await user.click(screen.getByRole("button", { name: "最新发布" }));

    await waitFor(() => {
      expect(companyCards()[0]).toHaveAttribute("data-testid", "company-pfizer");
      expect(companyCards()[1]).toHaveAttribute("data-testid", "company-astrazeneca");
    });
  });

  it("keeps recommendation out of the primary view strip and still submits from an auxiliary entry", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);

    const viewStrip = screen.getByRole("region", { name: "产品流程" });
    expect(within(viewStrip).queryByRole("button", { name: "推荐公司" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "推荐未覆盖公司" }));
    await user.type(screen.getByLabelText("公司名称"), "礼来");
    await user.type(screen.getByLabelText("官网链接"), "https://www.lilly.com/cn");
    await user.click(screen.getByRole("button", { name: "提交推荐" }));

    await waitFor(() => {
      expect(recording.recommendCompany).toHaveBeenCalledWith({
          companyName: "礼来",
          officialWebsiteUrl: "https://www.lilly.com/cn"
      });
    });

    expect(await screen.findByText("已收到推荐，公司会进入管理员复核队列。")).toBeInTheDocument();
  });
  it("keeps the plate private before consent and preserves real stale timestamps", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);
    expect(recording.listCoverage).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: /孔位.*阿斯利康/})).not.toBeInTheDocument();
    expect(document.querySelectorAll(".plate img")).toHaveLength(0);
    await acceptConsent(user);
    expect(await screen.findByRole("button", {name: /孔位.*阿斯利康.*近期更新异常/})).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "官方招聘目录"}));
    expect(await within(screen.getByRole("region", {name: "公司目录"})).findByText("最近成功更新 2026-07-13 08:00 UTC")).toBeInTheDocument();
  });

  it("searches province options, cascades to cities, and closes with Escape", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = true;
    render(<App dataProvider={recording.provider} />); await acceptConsent(user);
    await user.click(screen.getByRole("combobox", {name: "省份/地区"}));
    await user.type(screen.getByRole("searchbox", {name: "搜索省份"}), "江苏");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox", {name: "省份/地区"})).toHaveTextContent("江苏");
    expect(screen.getByRole("combobox", {name: "城市/地区"})).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", {name: "南京 0"})).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", {name: "城市/地区"})).toHaveFocus();
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("does not turn directory errors into false empty results and retries", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.listCoverage.mockRejectedValueOnce(new Error("unavailable"));
    render(<App dataProvider={recording.provider} />); await acceptConsent(user);
    expect(await screen.findByRole("button", {name: "重新加载企业状态"})).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "重新加载企业状态"}));
    expect(await screen.findByRole("button", {name: /孔位.*阿斯利康/})).toBeInTheDocument();
    recording.listCoverage.mockRejectedValueOnce(new Error("unavailable"));
    await user.click(screen.getByRole("button", {name: "官方招聘目录"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("公司目录加载失败");
    expect(screen.queryByText("没有符合当前关键词的公司。")).not.toBeInTheDocument();
  });

  it("does not reopen a document after its pending request was dismissed", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    let resolveDocument!: (result: StaticDocumentResult) => void;
    recording.getDocument.mockImplementationOnce(() => new Promise(resolve => {resolveDocument = resolve;}));
    render(<App dataProvider={recording.provider} />);
    await user.click(screen.getByRole("link", {name: "隐私政策"}));
    await user.click(screen.getByRole("button", {name: "关闭文档"}));
    await act(async () => resolveDocument({slug:"privacy",title:"隐私说明",body:"delayed"}));
    expect(screen.getByRole("dialog", {name:"使用前确认"})).toBeInTheDocument();
    expect(screen.queryByText("delayed")).not.toBeInTheDocument();
    expect(recording.searchJobs).not.toHaveBeenCalled();
  });

  it("refetches clear filters after the server has returned an empty result", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    recording.provider.supportsCityPendingSearch = true;
    render(<App dataProvider={recording.provider} />); await acceptConsent(user);
    await user.type(screen.getByRole("searchbox", {name:"职位关键词"}), "不存在");
    await user.click(screen.getByRole("checkbox", {name:"医学事务"}));
    await user.click(screen.getByRole("checkbox", {name:"只看新增"}));
    recording.searchJobs.mockResolvedValueOnce({companies:[],totalJobs:0,lastUpdatedAt:null});
    await user.click(screen.getByRole("button", {name:"搜索职位"}));
    expect(await screen.findByRole("heading", {name:"0 个职位"})).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name:"清除关键词与类别筛选"}));
    expect(recording.searchJobs).toHaveBeenLastCalledWith({province:"全部地区",city:"全部城市",keyword:"",categories:[],sort:"PINYIN_ASC",onlyNew:false});
    expect(await screen.findByRole("heading", {name:"6 个职位"})).toBeInTheDocument();
    expect(screen.getByRole("searchbox", {name:"职位关键词"})).toHaveValue("");
    expect(screen.getByRole("checkbox", {name:"医学事务"})).not.toBeChecked();
    expect(screen.getByRole("checkbox", {name:"只看新增"})).not.toBeChecked();
    expect(recording.searchJobs).toHaveBeenCalledTimes(3);
  });

  it("waits for fresh directory rows before consuming a plate navigation scroll", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    const coverage = await recording.listCoverage({keyword:""}); recording.listCoverage.mockClear();
    const previousScroll = Element.prototype.scrollIntoView;
    const connected: boolean[] = [];
    const scroll = vi.fn(function(this: Element) {connected.push(this.isConnected);});
    Element.prototype.scrollIntoView = scroll;
    try {
      render(<App dataProvider={recording.provider} />); await acceptConsent(user);
      const lillyWell = await screen.findByRole("button", {name:/孔位.*礼来/});
      let resolveCoverage!: (result: CoverageResult) => void;
      recording.listCoverage.mockImplementationOnce(() => new Promise(resolve => {resolveCoverage = resolve;}));
      await user.click(lillyWell);
      expect(screen.getByRole("region", {name:"公司目录"})).toHaveTextContent("正在加载公司目录");
      expect(scroll).not.toHaveBeenCalled();
      await act(async () => resolveCoverage(coverage));
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(connected).toEqual([true]);
      expect(document.getElementById("row-lilly")).toBeInTheDocument();
    } finally { Element.prototype.scrollIntoView = previousScroll; }
  });

  it("keeps one plate tab stop and moves focus between wells with arrow keys", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />); await acceptConsent(user);
    const wells = await screen.findAllByRole("button", {name:/孔位.*(?:阿斯利康|辉瑞|礼来|无公开入口药企|人福医药)/});
    expect(wells.filter(well => well.tabIndex === 0)).toHaveLength(1);
    act(() => wells[0]!.focus());
    await user.keyboard("{ArrowRight}");
    expect(wells[1]).toHaveFocus();
    expect(wells.filter(well => well.tabIndex === 0)).toHaveLength(1);
    await user.tab();
    expect(document.activeElement?.classList.contains("well")).toBe(false);
  });

  it.each([390, 426, 721, 1360])("keeps the company plate in responsive reading order at %ipx", async width => {
    const previousMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: /max-width:\s*(\d+)px/.test(query) && width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1]),
      media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
    }));
    try {
      const user = userEvent.setup(), recording = createRecordingProvider();
      recording.provider.supportsCityPendingSearch = true;
      render(<App dataProvider={recording.provider} />);
      expect(recording.searchJobs).not.toHaveBeenCalled();
      await acceptConsent(user);
      const plate = await screen.findByRole("complementary", {name: "目标企业更新孔位图"});
      const finder = screen.getByRole("form", {name: "搜索条件"});
      expect(screen.getAllByRole("complementary", {name: "目标企业更新孔位图"})).toHaveLength(1);
      if (width <= 720) {
        expect(plate.parentElement?.nextElementSibling).toBe(finder);
        const well = within(plate).getAllByRole("button").find(button => button.tabIndex === 0);
        expect(well).toBeDefined();
        act(() => well!.focus());
        await user.tab();
        expect(screen.getByRole("searchbox", {name: "职位关键词"})).toHaveFocus();
      } else if (width <= 960) {
        expect(finder.nextElementSibling).toBe(plate.parentElement);
      } else {
        expect(plate.closest("#plateSlot")).not.toBeNull();
        expect(finder.parentElement?.firstElementChild).toBe(finder);
      }
    } finally { window.matchMedia = previousMedia; }
  });

  it("places the mobile dock outside the clipping hero while retaining a single navigation", async () => {
    const previousMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({matches: query.includes("max-width"), media:query, onchange:null,
      addListener:vi.fn(), removeListener:vi.fn(), addEventListener:vi.fn(), removeEventListener:vi.fn(), dispatchEvent:vi.fn()}));
    try {
      const user = userEvent.setup(), recording = createRecordingProvider();
      render(<App dataProvider={recording.provider} />); await acceptConsent(user);
      const navigation = screen.getByRole("region", {name:"产品流程"});
      expect(navigation.closest(".hero")).toBeNull();
      expect(navigation.closest(".public-page")).not.toBeNull();
      expect(screen.getAllByRole("button", {name:"官方招聘目录"})).toHaveLength(1);
      await user.click(within(navigation).getByRole("button", {name:"官方招聘目录"}));
      expect(await screen.findByRole("region", {name:"公司目录"})).toBeInTheDocument();
    } finally { window.matchMedia = previousMedia; }
  });

  it("resets view navigation to the top while keeping the user's search draft", async () => {
    const user = userEvent.setup(), recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />); await acceptConsent(user);
    await user.type(screen.getByRole("searchbox", {name:"职位关键词"}), "MSL");
    await user.click(screen.getByRole("button", {name:"官方招聘目录"}));
    expect(window.scrollTo).toHaveBeenLastCalledWith({top:0,behavior:"instant"});
    vi.mocked(window.scrollTo).mockClear();
    await user.click(screen.getByRole("button", {name:"职位发现"}));
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({top:0,behavior:"instant"});
    expect(screen.getByRole("searchbox", {name:"职位关键词"})).toHaveValue("MSL");
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

});
