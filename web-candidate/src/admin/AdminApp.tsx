import { submissionErrorMessage, UNKNOWN_WRITE_MESSAGE } from "../app/apiResponse";
import { useEffect, useState } from "react";
import { JOB_CATEGORIES, type JobCategory } from "../domain/search";
import type { AdminDashboardModel } from "./adminViewModel";

export type AdminAppProps = {
  isAuthenticated: boolean;
  model: AdminDashboardModel;
  onLogin: (input: { username: string; password: string }) => Promise<void> | void;
  onQueueManualCrawl: (input: { sourceId: string; reason: string }) => Promise<void> | void;
  onReviewFeedback: (input: { feedbackId: string; status: "REVIEWED" | "CLOSED" }) => Promise<void> | void;
  onReviewRecommendation: (input: {
    recommendationId: string;
    status: "REVIEWED" | "CLOSED";
  }) => Promise<void> | void;
  onApplyCategoryCorrection: (input: {
    jobId: string;
    category: JobCategory;
    secondaryCategory?: JobCategory;
    reason: string;
  }) => Promise<void> | void;
};

type CorrectionDraft = {
  category: JobCategory;
  secondaryCategory: "" | JobCategory;
  reason: string;
};

function createCorrectionDraft(category: JobCategory): CorrectionDraft {
  return {
    category,
    secondaryCategory: "",
    reason: ""
  };
}

export function AdminApp({
  isAuthenticated,
  model,
  onLogin,
  onQueueManualCrawl,
  onReviewFeedback,
  onReviewRecommendation,
  onApplyCategoryCorrection
}: AdminAppProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => { setActionError(""); }, [isAuthenticated]);
  async function runAction(operation: () => Promise<void> | void) {
    if (actionBusy || actionError === UNKNOWN_WRITE_MESSAGE) return;
    setActionBusy(true); setActionError("");
    try { await operation(); }
    catch (error) { setActionError(submissionErrorMessage(error)); }
    finally { setActionBusy(false); }
  }
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, CorrectionDraft>>(() =>
    Object.fromEntries(
      model.categoryCorrectionQueue.map((item) => [item.jobId, createCorrectionDraft(item.suggestedCategory)])
    )
  );

  useEffect(() => {
    setCorrectionDrafts((current) => {
      let hasNewDraft = false;
      const nextDrafts = { ...current };

      for (const item of model.categoryCorrectionQueue) {
        if (nextDrafts[item.jobId] !== undefined) {
          continue;
        }

        nextDrafts[item.jobId] = createCorrectionDraft(item.suggestedCategory);
        hasNewDraft = true;
      }

      return hasNewDraft ? nextDrafts : current;
    });
  }, [model.categoryCorrectionQueue]);

  async function handleLogin() {
    await runAction(() => onLogin({ username, password }));
  }

  async function handleCorrectionSubmit(jobId: string) {
    const draft = correctionDrafts[jobId];

    if (draft === undefined || draft.reason.trim() === "") {
      return;
    }

    await runAction(() => onApplyCategoryCorrection({
      jobId,
      category: draft.category,
      ...(draft.secondaryCategory === "" ? {} : { secondaryCategory: draft.secondaryCategory }),
      reason: draft.reason.trim()
    }));
  }

  return (
    <main>
      <h1>Admin Console</h1>
      {actionError ? <p role="alert">{actionError}</p> : null}

      {!isAuthenticated ? (
        <section aria-label="Login">
          <label>
            <span>管理员账号</span>
            <input
              aria-label="管理员账号"
              onChange={(event) => setUsername(event.target.value)}
              type="text"
              value={username}
            />
          </label>
          <label>
            <span>管理员密码</span>
            <input
              aria-label="管理员密码"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE} onClick={() => void handleLogin()} type="button">
            登录
          </button>
        </section>
      ) : (
        <>
          <section aria-label="Source Health">
            <h2>Source Health</h2>
            <ul>
              {model.sources.map((source) => (
                <li key={source.sourceId}>
                  <strong>{source.companyName}</strong>
                  <div>状态: {source.verificationStatus}</div>
                  <div>已入库职位 {source.structuredJobCount}</div>
                  <div>连续失败 {source.consecutiveFailureCount} 次</div>
                  <div>最近结果: {source.latestOutcomeLabel}</div>
                  {source.latestFailureCategoryLabel === null ? null : (
                    <div>失败类别: {source.latestFailureCategoryLabel}</div>
                  )}
                  {source.latestFetchAttemptCount === null || source.latestRetryCount === null ? null : (
                    <div>
                      抓取尝试 {source.latestFetchAttemptCount} 次，其中重试 {source.latestRetryCount} 次
                    </div>
                  )}
                  {source.latestFailureReason === null ? null : (
                    <div>最近失败原因: {source.latestFailureReason}</div>
                  )}
                  {source.canQueueManualCrawl ? (
                    <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE}
                      onClick={() =>
                        void runAction(() => onQueueManualCrawl({
                          sourceId: source.sourceId,
                          reason: "admin-console"
                        }))
                      }
                      type="button"
                    >
                      加入手动抓取
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Feedback Review">
            <h2>Feedback Review</h2>
            <ul>
              {model.feedbackQueue.map((feedback) => (
                <li key={feedback.id}>
                  <strong>{feedback.companyName}</strong>
                  <div>{feedback.jobTitle}</div>
                  <div>{feedback.issueType}</div>
                  <div>{feedback.description}</div>
                  {feedback.contact ? <div>{feedback.contact}</div> : null}
                  <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE}
                    onClick={() => void runAction(() => onReviewFeedback({ feedbackId: feedback.id, status: "REVIEWED" }))}
                    type="button"
                  >
                    标记反馈已复核
                  </button>
                  <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE}
                    onClick={() => void runAction(() => onReviewFeedback({ feedbackId: feedback.id, status: "CLOSED" }))}
                    type="button"
                  >
                    关闭反馈
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Recommendation Review">
            <h2>Recommendation Review</h2>
            <ul>
              {model.recommendationQueue.map((recommendation) => (
                <li key={recommendation.id}>
                  <strong>{recommendation.companyName}</strong>
                  <div>{recommendation.officialWebsiteUrl}</div>
                  <div>{recommendation.note}</div>
                  <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE}
                    onClick={() =>
                      void runAction(() => onReviewRecommendation({
                        recommendationId: recommendation.id,
                        status: "REVIEWED"
                      }))
                    }
                    type="button"
                  >
                    标记推荐已复核
                  </button>
                  <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE}
                    onClick={() =>
                      void runAction(() => onReviewRecommendation({
                        recommendationId: recommendation.id,
                        status: "CLOSED"
                      }))
                    }
                    type="button"
                  >
                    关闭推荐
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Category Correction">
            <h2>Category Correction</h2>
            <ul>
              {model.categoryCorrectionQueue.map((item) => {
                const draft = correctionDrafts[item.jobId];

                if (draft === undefined) {
                  return null;
                }

                return (
                  <li key={item.jobId}>
                    <strong>{item.companyName}</strong>
                    <div>{item.jobTitle}</div>
                    <div>当前类目: {item.currentCategory}</div>
                    <label>
                      <span>纠正后主类目</span>
                      <select
                        aria-label="纠正后主类目"
                        onChange={(event) =>
                          setCorrectionDrafts((current) => ({
                            ...current,
                            [item.jobId]: {
                              ...(current[item.jobId] ?? createCorrectionDraft(item.suggestedCategory)),
                              category: event.target.value as JobCategory
                            }
                          }))
                        }
                        value={draft.category}
                      >
                        {JOB_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>纠正后副类目</span>
                      <select
                        aria-label="纠正后副类目"
                        onChange={(event) =>
                          setCorrectionDrafts((current) => ({
                            ...current,
                            [item.jobId]: {
                              ...(current[item.jobId] ?? createCorrectionDraft(item.suggestedCategory)),
                              secondaryCategory: event.target.value as "" | JobCategory
                            }
                          }))
                        }
                        value={draft.secondaryCategory}
                      >
                        <option value="">无</option>
                        {JOB_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>纠正原因</span>
                      <input
                        aria-label="纠正原因"
                        onChange={(event) =>
                          setCorrectionDrafts((current) => ({
                            ...current,
                            [item.jobId]: {
                              ...(current[item.jobId] ?? createCorrectionDraft(item.suggestedCategory)),
                              reason: event.target.value
                            }
                          }))
                        }
                        type="text"
                        value={draft.reason}
                      />
                    </label>
                    <button disabled={actionBusy || actionError === UNKNOWN_WRITE_MESSAGE} onClick={() => void handleCorrectionSubmit(item.jobId)} type="button">
                      提交类目纠正
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
