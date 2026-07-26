/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import type {
  AppDataProvider,
  CoverageResult,
  FeedbackReceipt,
  SearchResult,
  StaticDocumentResult
} from "../../src/app/appDataProvider";

afterEach(() => {
  cleanup();
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
    await user.type(screen.getByPlaceholderText("职位关键词"), "MSL");
    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.click(screen.getByRole("checkbox", { name: "只看新增" }));
    await user.click(screen.getByRole("button", { name: "最新发布" }));
    await user.click(screen.getByRole("button", { name: "搜索职位" }));

    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
    expect(recording.searchJobs).toHaveBeenCalledWith({
      city: "北京",
      keyword: "MSL",
      categories: ["医学事务"],
      sort: "LATEST",
      onlyNew: true
    });
  });

  it("offers only concrete city choices and sends the selected city to the provider", async () => {
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

  it("loads grouped Beijing results after consent and updates by category and keyword", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);

    expect(await screen.findByText("阿斯利康")).toBeInTheDocument();
    expect(screen.getByText("辉瑞")).toBeInTheDocument();
    expect(screen.getByText("6 个职位")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "医学事务" }));
    await user.type(screen.getByPlaceholderText("职位关键词"), "MSL");

    await waitFor(() => {
      expect(screen.getByText("辉瑞")).toBeInTheDocument();
      expect(screen.queryByText("阿斯利康")).not.toBeInTheDocument();
      expect(screen.queryByText("区域销售经理")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /辉瑞/ }));
    expect(screen.getByText("肿瘤 MSL")).toBeInTheDocument();
  });

  it("shows official job links and per-company cap control when expanding a company", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);

    await user.click(await screen.findByRole("button", { name: /阿斯利康/ }));

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

  it("shows publication-aware coverage states and prefers official careers before website fallback", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await user.click(screen.getByRole("button", { name: "查看覆盖公司" }));

    await waitFor(() => {
      expect(recording.listCoverage).toHaveBeenLastCalledWith({ keyword: "", offset: 0, limit: 60 });
    });
    expect(await screen.findByText("自动更新中")).toBeInTheDocument();
    expect(screen.getByText("仅展示来源可核验的官方职位，不作抓全声明。")).toBeInTheDocument();
    expect(screen.getByText("核验中")).toBeInTheDocument();
    expect(screen.getByText("仅官方入口")).toBeInTheDocument();
    expect(screen.getByText("暂无公开官方招聘入口")).toBeInTheDocument();
    expect(screen.getByText("用户授权一期排除")).toBeInTheDocument();
    expect(screen.getByText("近期更新异常")).toBeInTheDocument();
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

    expect(await screen.findByText("辉瑞")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看辉瑞官方招聘入口" })).toHaveAttribute(
      "href",
      "https://www.pfizer.com/about/careers"
    );
    expect(screen.queryByText("医学科学联络官")).not.toBeInTheDocument();
  });

  it("submits contextual feedback with company and job ids", async () => {
    const user = userEvent.setup();
    const recording = createRecordingProvider();
    render(<App dataProvider={recording.provider} />);

    await acceptConsent(user);
    await runBeijingSearch(user);
    await user.click(await screen.findByRole("button", { name: /辉瑞/ }));
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

    expect(screen.getByText("6 个职位")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "只看新增" }));

    await waitFor(() => {
      expect(screen.getByText("3 个职位")).toBeInTheDocument();
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
});
