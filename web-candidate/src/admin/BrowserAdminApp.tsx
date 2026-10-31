import { readApiJson } from "../app/apiResponse";
import { useEffect, useMemo, useState } from "react";
import { AdminApp } from "./AdminApp";
import type { AdminDashboardModel } from "./adminViewModel";

const EMPTY_MODEL: AdminDashboardModel = {
  sources: [],
  feedbackQueue: [],
  recommendationQueue: [],
  categoryCorrectionQueue: []
};

export function BrowserAdminApp() {
  const [token, setToken] = useState<string | null>(() => window.sessionStorage.getItem("job-search-admin-token"));
  const [model, setModel] = useState<AdminDashboardModel>(EMPTY_MODEL);
  const [dashboardError, setDashboardError] = useState("");
  const [reload, setReload] = useState(0);
  const [manualReceipt, setManualReceipt] = useState<{id: string; status: string; launchStatus?: string} | null>(null);

  const headers = useMemo(() => {
    if (token === null) {
      return { "content-type": "application/json" };
    }

    return {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (token === null) {
      setModel(EMPTY_MODEL);
      setDashboardError("");
      setManualReceipt(null);
      return;
    }

    void loadDashboard(headers).then(next => {
      if (cancelled) return;
      setModel(next); setDashboardError("");
    }).catch(error => {
      if (cancelled) return;
      if (error instanceof Error && error.message === "ADMIN_AUTH_REQUIRED") {
        window.sessionStorage.removeItem("job-search-admin-token");
        setToken(null);
        setModel(EMPTY_MODEL);
      } else {
        setDashboardError("后台数据暂不可用，登录状态和当前编辑内容已保留。可刷新后台数据后查看。");
      }
    });
    return () => { cancelled = true; };
  }, [headers, token, reload]);

  async function login(input: { username: string; password: string }) {
    const response = await postJson<{ token: string }>("/admin/api/login", {
      email: input.username,
      password: input.password
    });
    window.sessionStorage.setItem("job-search-admin-token", response.token);
    setToken(response.token);
  }

  async function refresh() {
    if (token !== null) {
      setModel(await loadDashboard(headers));
      setDashboardError("");
    }
  }

  return (
    <>
    {dashboardError ? <p role="alert">{dashboardError}</p> : null}
    {token !== null ? <button type="button" onClick={() => setReload(value => value + 1)}>刷新后台数据</button> : null}
    {manualReceipt ? <p role="status">请求 {manualReceipt.id}：{manualReceipt.status}。
      {manualReceipt.status === "QUEUED" ? manualReceipt.launchStatus === "START_REQUESTED"
        ? "已请求启动，尚未确认抓取完成。" : "已保存到队列，启动尚未确认，请勿重复提交。" : "此手动抓取仅供预览，不会发布到公开网页。"}
      <button type="button" onClick={() => {
        void fetch("/admin/api/manual-crawls", {headers}).then(response => readApiJson<{requests: {id: string; status: string}[]}>(response))
          .then(({requests}) => {
            const current = requests.find(item => item.id === manualReceipt.id);
            if (current) setManualReceipt(previous => previous?.id === current.id ? {...previous, status: current.status} : previous);
            else setDashboardError("最近的状态记录中未找到此请求，请保留回执并核实，不要重复提交。");
          }).catch(() => setDashboardError("抓取状态暂不可读，已入队回执仍保留，请勿重复提交。"));
      }}>查看抓取状态</button>
    </p> : null}
    <AdminApp
      isAuthenticated={token !== null}
      model={model}
      onLogin={login}
      onQueueManualCrawl={async (input) => {
        const receipt = await postJson<{id: string; status: string; launchStatus?: string}>("/admin/api/manual-crawl", input, headers);
        setManualReceipt(receipt);
        await refresh().catch(() => setDashboardError("请求已入队，后台数据刷新暂时失败，请勿重复提交。"));
      }}
      onReviewFeedback={async (input) => {
        await postJson("/admin/api/feedback-review", input, headers);
        await refresh();
      }}
      onReviewRecommendation={async (input) => {
        await postJson("/admin/api/recommendation-review", input, headers);
        await refresh();
      }}
      onApplyCategoryCorrection={async (input) => {
        await postJson("/admin/api/category-correction", input, headers);
        await refresh();
      }}
    />
    </>
  );
}

async function loadDashboard(headers: Record<string, string>): Promise<AdminDashboardModel> {
  const response = await fetch("/admin/api/dashboard", { headers });
  if (!response.ok) {
    if (response.status === 401) throw new Error("ADMIN_AUTH_REQUIRED");
    throw new Error(`Admin dashboard failed with status ${response.status}`);
  }

  return (await response.json()) as AdminDashboardModel;
}

async function postJson<T = unknown>(
  path: string,
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" }
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  return readApiJson<T>(response);
}
