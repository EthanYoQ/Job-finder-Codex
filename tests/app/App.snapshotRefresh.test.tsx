/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import type { AppDataProvider, CoverageResult, SearchResult } from "../../src/app/appDataProvider";
import { SNAPSHOT_REFRESH_DELAY_MS } from "../../src/app/boundedSnapshotRequest";

const OLD_TIME = "2026-07-08T09:00:00.000Z";
const NEW_TIME = "2026-10-04T13:00:00.000Z";
function searchResult(name = "旧版公司", state: "CURRENT" | "UPDATING" | "FAILED" = "UPDATING"): SearchResult {
  return {
    snapshotRefresh: { state, version: name === "旧版公司" ? "v1" : "v2" },
    totalJobs: 1,
    lastUpdatedAt: name === "旧版公司" ? OLD_TIME : NEW_TIME,
    companies: [{ id: "company-test", companyName: name, pinyin: "test", jobs: [{
      id: "job-test", title: "医学科学联络官", officialTitle: "MSL", category: "医学事务", city: "北京",
      locationRaw: "北京", officialPublishedAt: OLD_TIME, isNew: true, officialUrl: "https://example.test/job"
    }] }]
  };
}
function coverageResult(name = "旧版公司", state: "CURRENT" | "UPDATING" | "FAILED" = "CURRENT"): CoverageResult {
  return {
    snapshotRefresh: { state, version: name === "旧版公司" ? "v1" : "v2" },
    offset: 0, limit: 60, hasMore: false,
    companies: [{ id: "company-test", companyName: name, category: "FOREIGN_PHARMA", state: "PUBLISHING",
      health: "HEALTHY", officialCareersUrl: "https://example.test/careers", officialWebsiteUrl: null,
      lastSuccessAt: name === "旧版公司" ? OLD_TIME : NEW_TIME }]
  };
}
function createProvider() {
  const searchJobs = vi.fn<AppDataProvider["searchJobs"]>().mockResolvedValue(searchResult());
  const listCoverage = vi.fn<AppDataProvider["listCoverage"]>().mockResolvedValue(coverageResult());
  const provider: AppDataProvider = {
    searchJobs, listCoverage,
    submitFeedback: vi.fn(), recommendCompany: vi.fn(), getDocument: vi.fn()
  };
  return { provider, searchJobs, listCoverage };
}
async function acceptConsent() {
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    fireEvent.click(screen.getByRole("button", { name: "进入 Job-search" }));
  });
}
async function tick(ms = SNAPSHOT_REFRESH_DELAY_MS) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function click(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}
function jobs() { return within(screen.getByRole("region", { name: "公司职位列表" })); }
function directory() { return within(screen.getByRole("region", { name: "公司目录" })); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("App bounded snapshot refresh", () => {
  it("keeps search and coverage checks separate and starts fresh after a new request", async () => {
    const recording = createProvider();
    recording.searchJobs.mockResolvedValue({ ...searchResult(), snapshotRefresh: { state: "UPDATING", version: "v1", check: "search-check" } });
    recording.listCoverage.mockResolvedValue({ ...coverageResult(), snapshotRefresh: { state: "UPDATING", version: "v1", check: "coverage-check" } });
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    expect(recording.searchJobs.mock.calls[0]?.[1]?.snapshotCheck).toBeUndefined();
    expect(recording.listCoverage.mock.calls[0]?.[1]?.snapshotCheck).toBeUndefined();
    await tick();
    expect(recording.searchJobs.mock.calls[1]?.[1]?.snapshotCheck).toBe("search-check");
    expect(recording.listCoverage.mock.calls[1]?.[1]?.snapshotCheck).toBe("coverage-check");
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "上海" })); });
    await click("搜索职位");
    expect(recording.searchJobs.mock.calls[2]?.[0].city).toBe("上海");
    expect(recording.searchJobs.mock.calls[2]?.[1]?.snapshotCheck).toBeUndefined();
    await click("官方招聘目录");
    expect(recording.listCoverage.mock.calls[2]?.[1]?.snapshotCheck).toBeUndefined();
    await tick();
    expect(recording.listCoverage.mock.calls[3]?.[1]?.snapshotCheck).toBe("coverage-check");
    await act(async () => { fireEvent.change(screen.getByRole("searchbox", { name: "搜索已覆盖公司" }), { target: { value: "公司" } }); });
    expect(recording.listCoverage.mock.calls[4]?.[0].keyword).toBe("公司");
    expect(recording.listCoverage.mock.calls[4]?.[1]?.snapshotCheck).toBeUndefined();
  });

  it.each([undefined, "CURRENT", "FAILED"] as const)("does not poll search or coverage with %s status", async state => {
    const recording = createProvider();
    const search = searchResult(), coverage = coverageResult();
    if (state) {
      search.snapshotRefresh = { state, version: "v1" };
      coverage.snapshotRefresh = { state, version: "v1" };
    } else {
      delete search.snapshotRefresh;
      delete coverage.snapshotRefresh;
    }
    recording.searchJobs.mockResolvedValue(search);
    recording.listCoverage.mockResolvedValue(coverage);
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
    expect(recording.listCoverage).toHaveBeenCalledTimes(1);
  });

  it("ends both refresh rounds within the attempt budget without hiding their old data", async () => {
    const recording = createProvider();
    recording.listCoverage.mockResolvedValue(coverageResult("旧版公司", "UPDATING"));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(6);
    expect(recording.listCoverage).toHaveBeenCalledTimes(6);
    expect(jobs().getByRole("button", { name: /旧版公司/ })).toBeInTheDocument();
    expect(screen.getByText("最后更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
  });

  it("makes no read or scheduled refresh until the user explicitly accepts in this mount", async () => {
    const recording = createProvider();
    const mounted = render(<App dataProvider={recording.provider} />);
    await tick(60_000);
    fireEvent.click(screen.getByRole("checkbox", { name: /我已阅读并同意/ }));
    await tick(60_000);
    expect(recording.searchJobs).not.toHaveBeenCalled();
    expect(recording.listCoverage).not.toHaveBeenCalled();
    await click("进入 Job-search");
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
    mounted.unmount();
    render(<App dataProvider={recording.provider} />);
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
    expect(recording.listCoverage).toHaveBeenCalledTimes(1);
  });

  it("keeps the old jobs and real timestamp visible while a newer snapshot is fetched", async () => {
    const recording = createProvider();
    let resolve!: (value: SearchResult) => void;
    recording.searchJobs.mockResolvedValueOnce(searchResult())
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await tick();
    expect(recording.searchJobs).toHaveBeenCalledTimes(2);
    expect(jobs().getByRole("button", { name: /旧版公司/ })).toBeInTheDocument();
    expect(screen.getByText("最后更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索职位" })).toBeEnabled();
    expect(screen.queryByText("正在加载官方职位…")).not.toBeInTheDocument();
    await act(async () => resolve(searchResult("新版公司", "CURRENT")));
    expect(jobs().getByRole("button", { name: /新版公司/ })).toBeInTheDocument();
    expect(screen.getByText("最后更新 2026-10-04 13:00 UTC")).toBeInTheDocument();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(2);
  });

  it("preserves directory rows and timestamps until a newer coverage snapshot arrives", async () => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    let resolve!: (value: CoverageResult) => void;
    recording.listCoverage.mockResolvedValueOnce(coverageResult("旧版公司", "UPDATING"))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await click("官方招聘目录");
    await tick();
    expect(directory().getByText("旧版公司")).toBeInTheDocument();
    expect(directory().getByText("最近成功更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
    expect(screen.queryByText("正在加载公司目录…")).not.toBeInTheDocument();
    await act(async () => resolve(coverageResult("新版公司")));
    expect(directory().getByText("新版公司")).toBeInTheDocument();
    expect(directory().getByText("最近成功更新 2026-10-04 13:00 UTC")).toBeInTheDocument();
    await tick(60_000);
    expect(recording.listCoverage).toHaveBeenCalledTimes(3);
  });

  it("silently keeps a valid display and stops re-fetching when the background refresh fails", async () => {
    const recording = createProvider();
    recording.searchJobs.mockResolvedValueOnce(searchResult()).mockRejectedValueOnce(new Error("offline"));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(2);
    expect(jobs().getByRole("button", { name: /旧版公司/ })).toBeInTheDocument();
    expect(screen.getByText("最后更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("正在加载官方职位…")).not.toBeInTheDocument();
  });

  it("hides the previous city's jobs and overview during an explicit search and its failure", async () => {
    const recording = createProvider();
    recording.searchJobs.mockResolvedValue(searchResult("旧版公司", "CURRENT"));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    expect(jobs().getByRole("button", { name: /旧版公司/ })).toBeInTheDocument();
    let reject!: (error: Error) => void;
    recording.searchJobs.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "上海" })); });
    await click("搜索职位");
    expect(recording.searchJobs.mock.calls[1]?.[0].city).toBe("上海");
    expect(jobs().queryByRole("button", { name: /旧版公司/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "1 个职位" })).not.toBeInTheDocument();
    expect(screen.queryByText("最后更新 2026-07-08 09:00 UTC")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载官方职位");
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent("职位加载失败");
    expect(jobs().queryByRole("button", { name: /旧版公司/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "1 个职位" })).not.toBeInTheDocument();
    expect(screen.queryByText("最后更新 2026-07-08 09:00 UTC")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "上海" })).toBeChecked();
  });

  it.each(["keyword", "city", "category", "new", "sort"])("stops the search refresh when %s changes", async filter => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await act(async () => {
      if (filter === "keyword") fireEvent.change(screen.getByRole("searchbox", { name: "职位关键词" }), { target: { value: "MSL" } });
      if (filter === "city") fireEvent.click(screen.getByRole("radio", { name: "上海" }));
      if (filter === "category") fireEvent.click(screen.getByRole("checkbox", { name: "医学事务" }));
      if (filter === "new") fireEvent.click(screen.getByRole("checkbox", { name: "只看新增" }));
      if (filter === "sort") fireEvent.click(screen.getByRole("button", { name: "最新发布" }));
    });
    expect(recording.searchJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("finishes the original initial search after navigating to the directory and back", async () => {
    const recording = createProvider();
    let resolve!: (value: SearchResult) => void;
    recording.searchJobs.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    expect(screen.getByRole("button", { name: "搜索中" })).toBeDisabled();
    await click("官方招聘目录");
    await click("职位发现");
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
    expect(recording.searchJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(screen.getByRole("button", { name: "搜索中" })).toBeDisabled();
    await act(async () => resolve(searchResult("原请求公司", "CURRENT")));
    expect(jobs().getByRole("button", { name: /原请求公司/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索职位" })).toBeEnabled();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("keeps a single bounded search refresh round across directory navigation", async () => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    await click("官方招聘目录");
    await tick(SNAPSHOT_REFRESH_DELAY_MS * 2);
    expect(recording.searchJobs).toHaveBeenCalledTimes(3);
    expect(recording.searchJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await click("职位发现");
    expect(jobs().getByRole("button", { name: /旧版公司/ })).toBeInTheDocument();
    expect(screen.queryByText("正在加载官方职位…")).not.toBeInTheDocument();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(6);
    await click("官方招聘目录");
    await click("职位发现");
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(6);
    expect(screen.getByText("最后更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
  });

  it.each([false, true])("a new search wins over a late response (background refresh: %s)", async refreshing => {
    const recording = createProvider();
    let resolve!: (value: SearchResult) => void;
    if (refreshing) recording.searchJobs.mockResolvedValueOnce(searchResult());
    recording.searchJobs.mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValueOnce(searchResult("新搜索公司", "CURRENT"));
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    if (refreshing) await tick();
    else await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "上海" })); });
    await click("搜索职位");
    expect(jobs().getByRole("button", { name: /新搜索公司/ })).toBeInTheDocument();
    await act(async () => resolve(searchResult("迟到公司", "CURRENT")));
    expect(jobs().queryByRole("button", { name: /迟到公司/ })).not.toBeInTheDocument();
    expect(jobs().getByRole("button", { name: /新搜索公司/ })).toBeInTheDocument();
    await tick(60_000);
    expect(recording.searchJobs).toHaveBeenCalledTimes(refreshing ? 3 : 2);
  });

  it("ignores a late coverage refresh after the directory keyword changes", async () => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    let resolve!: (value: CoverageResult) => void;
    recording.listCoverage.mockResolvedValueOnce(coverageResult("旧版公司", "UPDATING"))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValueOnce(coverageResult("新搜索公司"));
    await click("官方招聘目录");
    await tick();
    await act(async () => { fireEvent.change(screen.getByRole("searchbox", { name: "搜索已覆盖公司" }), { target: { value: "新搜索" } }); });
    expect(recording.listCoverage.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => resolve(coverageResult("迟到公司")));
    expect(directory().queryByText("迟到公司")).not.toBeInTheDocument();
    expect(directory().getByText("新搜索公司")).toBeInTheDocument();
    await tick(60_000);
    expect(recording.listCoverage).toHaveBeenCalledTimes(4);
  });

  it("ignores the previous view's coverage refresh after navigation", async () => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    let resolve!: (value: CoverageResult) => void;
    recording.listCoverage.mockResolvedValueOnce(coverageResult("旧版公司", "UPDATING"))
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValueOnce(coverageResult("新视图公司"));
    await click("官方招聘目录");
    await tick();
    await click("职位发现");
    expect(recording.listCoverage.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => resolve(coverageResult("迟到公司")));
    expect(screen.getByRole("button", { name: /孔位.*新视图公司/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /孔位.*迟到公司/ })).not.toBeInTheDocument();
    await tick(60_000);
    expect(recording.listCoverage).toHaveBeenCalledTimes(4);
  });

  it("silently preserves the existing directory on background refresh error and stops that round", async () => {
    const recording = createProvider();
    render(<App dataProvider={recording.provider} />);
    await acceptConsent();
    recording.listCoverage.mockResolvedValueOnce(coverageResult("旧版公司", "UPDATING"))
      .mockRejectedValueOnce(new Error("offline"));
    await click("官方招聘目录");
    await tick(60_000);
    expect(directory().getByText("旧版公司")).toBeInTheDocument();
    expect(directory().getByText("最近成功更新 2026-07-08 09:00 UTC")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("正在加载公司目录…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新加载企业状态" })).not.toBeInTheDocument();
    expect(recording.listCoverage).toHaveBeenCalledTimes(3);
  });

  it("cancels old-provider requests on replacement and cancels pending reads on unmount", async () => {
    const old = createProvider(), next = createProvider();
    old.listCoverage.mockResolvedValue(coverageResult("旧版公司", "UPDATING"));
    const mounted = render(<App dataProvider={old.provider} />);
    await acceptConsent();
    next.listCoverage.mockImplementation(() => new Promise(() => {}));
    mounted.rerender(<App dataProvider={next.provider} />);
    expect(old.searchJobs.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(old.listCoverage.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    mounted.unmount();
    expect(next.listCoverage.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await tick(60_000);
    expect(old.searchJobs).toHaveBeenCalledTimes(1);
    expect(old.listCoverage).toHaveBeenCalledTimes(1);
    expect(next.searchJobs).not.toHaveBeenCalled();
    expect(next.listCoverage).toHaveBeenCalledTimes(1);
  });
});
