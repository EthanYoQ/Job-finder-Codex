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
    if (token === null) {
      setModel(EMPTY_MODEL);
      return;
    }

    void loadDashboard(headers).then(setModel).catch(() => {
      window.sessionStorage.removeItem("job-search-admin-token");
      setToken(null);
      setModel(EMPTY_MODEL);
    });
  }, [headers, token]);

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
    }
  }

  return (
    <AdminApp
      isAuthenticated={token !== null}
      model={model}
      onLogin={login}
      onQueueManualCrawl={async (input) => {
        await postJson("/admin/api/manual-crawl", input, headers);
        await refresh();
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
  );
}

async function loadDashboard(headers: Record<string, string>): Promise<AdminDashboardModel> {
  const response = await fetch("/admin/api/dashboard", { headers });
  if (!response.ok) {
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
