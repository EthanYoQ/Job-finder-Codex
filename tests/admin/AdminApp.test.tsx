/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApp, type AdminAppProps } from "../../src/admin/AdminApp";
import { buildAdminDashboardModel } from "../../src/admin/adminViewModel";
import type { JobCategory } from "../../src/domain/search";

afterEach(() => {
  cleanup();
});

function createModel() {
  return buildAdminDashboardModel({
    sourceHealth: [
      {
        sourceId: "source-critical",
        companyId: "company-critical",
        companyName: "问题药企",
        verificationStatus: "VERIFIED_SCRAPABLE",
        structuredJobCount: 5,
        consecutiveFailureCount: 4,
        latestObservation: {
          crawledAt: new Date("2026-07-08T11:00:00.000Z"),
          successful: false,
          structuredJobCount: 0,
          failureReason: "timeout"
        }
      }
    ],
    feedbackQueue: [
      {
        id: "feedback-1",
        companyName: "辉瑞",
        jobTitle: "MSL",
        issueType: "职位信息有误",
        description: "城市写错",
        status: "OPEN",
        createdAt: new Date("2026-07-08T09:00:00.000Z")
      }
    ],
    recommendationQueue: [
      {
        id: "recommendation-1",
        companyName: "礼来",
        officialWebsiteUrl: "https://www.lilly.com/cn",
        note: "补充覆盖",
        status: "OPEN",
        createdAt: new Date("2026-07-08T08:00:00.000Z")
      }
    ],
    categoryCorrectionQueue: [
      {
        jobId: "job-1",
        companyName: "阿斯利康",
        jobTitle: "医学科学联络官",
        currentCategory: "其他",
        suggestedCategory: "医学事务"
      }
    ]
  });
}

function createModelWithCorrectionJobs(
  jobs: Array<{
    jobId: string;
    companyName: string;
    jobTitle: string;
    currentCategory: JobCategory;
    suggestedCategory: JobCategory;
  }>
) {
  return buildAdminDashboardModel({
    sourceHealth: [
      {
        sourceId: "source-critical",
        companyId: "company-critical",
        companyName: "问题药企",
        verificationStatus: "VERIFIED_SCRAPABLE",
        structuredJobCount: 5,
        consecutiveFailureCount: 4,
        latestObservation: {
          crawledAt: new Date("2026-07-08T11:00:00.000Z"),
          successful: false,
          structuredJobCount: 0,
          failureReason: "timeout"
        }
      }
    ],
    feedbackQueue: [
      {
        id: "feedback-1",
        companyName: "辉瑞",
        jobTitle: "MSL",
        issueType: "职位信息有误",
        description: "城市写错",
        status: "OPEN",
        createdAt: new Date("2026-07-08T09:00:00.000Z")
      }
    ],
    recommendationQueue: [
      {
        id: "recommendation-1",
        companyName: "礼来",
        officialWebsiteUrl: "https://www.lilly.com/cn",
        note: "补充覆盖",
        status: "OPEN",
        createdAt: new Date("2026-07-08T08:00:00.000Z")
      }
    ],
    categoryCorrectionQueue: jobs
  });
}

function renderAdminApp(overrides: Partial<AdminAppProps> = {}) {
  const onLogin = vi.fn(async () => {});
  const onQueueManualCrawl = vi.fn(async () => {});
  const onReviewFeedback = vi.fn(async () => {});
  const onReviewRecommendation = vi.fn(async () => {});
  const onApplyCategoryCorrection = vi.fn(async () => {});

  render(
    <AdminApp
      isAuthenticated={true}
      model={createModel()}
      onLogin={onLogin}
      onQueueManualCrawl={onQueueManualCrawl}
      onReviewFeedback={onReviewFeedback}
      onReviewRecommendation={onReviewRecommendation}
      onApplyCategoryCorrection={onApplyCategoryCorrection}
      {...overrides}
    />
  );

  return {
    onLogin,
    onQueueManualCrawl,
    onReviewFeedback,
    onReviewRecommendation,
    onApplyCategoryCorrection
  };
}

describe("AdminApp", () => {
  it("shows a login form while unauthenticated and hides admin data", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => {});
    render(
      <AdminApp
        isAuthenticated={false}
        model={createModel()}
        onLogin={onLogin}
        onQueueManualCrawl={vi.fn()}
        onReviewFeedback={vi.fn()}
        onReviewRecommendation={vi.fn()}
        onApplyCategoryCorrection={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Admin Console" })).toBeInTheDocument();
    expect(screen.getByLabelText("管理员账号")).toBeInTheDocument();
    expect(screen.getByLabelText("管理员密码")).toBeInTheDocument();
    expect(screen.queryByText("问题药企")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("管理员账号"), "admin");
    await user.type(screen.getByLabelText("管理员密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onLogin).toHaveBeenCalledWith({ username: "admin", password: "secret" });
  });

  it("shows source health with consecutive failures and manual crawl action", async () => {
    const user = userEvent.setup();
    const { onQueueManualCrawl } = renderAdminApp();

    const sourceSection = screen.getByRole("region", { name: "Source Health" });
    expect(within(sourceSection).getByText("问题药企")).toBeInTheDocument();
    expect(within(sourceSection).getByText("连续失败 4 次")).toBeInTheDocument();
    expect(within(sourceSection).getByText("最近失败原因: timeout")).toBeInTheDocument();

    await user.click(within(sourceSection).getByRole("button", { name: "加入手动抓取" }));

    expect(onQueueManualCrawl).toHaveBeenCalledWith({
      sourceId: "source-critical",
      reason: "admin-console"
    });
  });

  it("lets admins mark feedback and recommendations reviewed or closed", async () => {
    const user = userEvent.setup();
    const { onReviewFeedback, onReviewRecommendation } = renderAdminApp();

    const feedbackSection = screen.getByRole("region", { name: "Feedback Review" });
    await user.click(within(feedbackSection).getByRole("button", { name: "标记反馈已复核" }));
    await user.click(within(feedbackSection).getByRole("button", { name: "关闭反馈" }));

    const recommendationSection = screen.getByRole("region", { name: "Recommendation Review" });
    await user.click(within(recommendationSection).getByRole("button", { name: "标记推荐已复核" }));
    await user.click(within(recommendationSection).getByRole("button", { name: "关闭推荐" }));

    expect(onReviewFeedback).toHaveBeenNthCalledWith(1, {
      feedbackId: "feedback-1",
      status: "REVIEWED"
    });
    expect(onReviewFeedback).toHaveBeenNthCalledWith(2, {
      feedbackId: "feedback-1",
      status: "CLOSED"
    });
    expect(onReviewRecommendation).toHaveBeenNthCalledWith(1, {
      recommendationId: "recommendation-1",
      status: "REVIEWED"
    });
    expect(onReviewRecommendation).toHaveBeenNthCalledWith(2, {
      recommendationId: "recommendation-1",
      status: "CLOSED"
    });
  });

  it("submits human category corrections from the correction queue", async () => {
    const user = userEvent.setup();
    const { onApplyCategoryCorrection } = renderAdminApp();

    const correctionSection = screen.getByRole("region", { name: "Category Correction" });
    await user.selectOptions(within(correctionSection).getByLabelText("纠正后主类目"), "医学事务");
    await user.selectOptions(within(correctionSection).getByLabelText("纠正后副类目"), "市场");
    await user.type(within(correctionSection).getByLabelText("纠正原因"), "人工复核确认");
    await user.click(within(correctionSection).getByRole("button", { name: "提交类目纠正" }));

    expect(onApplyCategoryCorrection).toHaveBeenCalledWith({
      jobId: "job-1",
      category: "医学事务",
      secondaryCategory: "市场",
      reason: "人工复核确认"
    });
  });

  it("renders newly queued correction items after rerender without overwriting existing drafts", async () => {
    const user = userEvent.setup();
    const onApplyCategoryCorrection = vi.fn(async () => {});
    const initialModel = createModelWithCorrectionJobs([
      {
        jobId: "job-1",
        companyName: "阿斯利康",
        jobTitle: "医学科学联络官",
        currentCategory: "其他",
        suggestedCategory: "医学事务"
      }
    ]);

    const { rerender } = render(
      <AdminApp
        isAuthenticated={true}
        model={initialModel}
        onLogin={vi.fn()}
        onQueueManualCrawl={vi.fn()}
        onReviewFeedback={vi.fn()}
        onReviewRecommendation={vi.fn()}
        onApplyCategoryCorrection={onApplyCategoryCorrection}
      />
    );

    const correctionSection = screen.getByRole("region", { name: "Category Correction" });
    await user.type(within(correctionSection).getByLabelText("纠正原因"), "保留已有草稿");

    const updatedModel = createModelWithCorrectionJobs([
      {
        jobId: "job-1",
        companyName: "阿斯利康",
        jobTitle: "医学科学联络官",
        currentCategory: "其他",
        suggestedCategory: "医学事务"
      },
      {
        jobId: "job-2",
        companyName: "诺华",
        jobTitle: "地区经理",
        currentCategory: "销售",
        suggestedCategory: "市场"
      }
    ]);

    rerender(
      <AdminApp
        isAuthenticated={true}
        model={updatedModel}
        onLogin={vi.fn()}
        onQueueManualCrawl={vi.fn()}
        onReviewFeedback={vi.fn()}
        onReviewRecommendation={vi.fn()}
        onApplyCategoryCorrection={onApplyCategoryCorrection}
      />
    );

    expect(screen.getByText("诺华")).toBeInTheDocument();
    const reasonInputs = screen.getAllByLabelText("纠正原因");
    expect(reasonInputs).toHaveLength(2);
    expect(reasonInputs[0]).toHaveValue("保留已有草稿");
    expect(reasonInputs[1]).toHaveValue("");
  });

  it("does not render raw export or bulk download controls", () => {
    renderAdminApp();

    expect(screen.queryByRole("button", { name: /导出/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /下载/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/raw job/i)).not.toBeInTheDocument();
  });
});
