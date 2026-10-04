/** Invented official responses only; never live qualification evidence. */
import { lillyPlan, lillyBootstrap, syntheticLillyRow } from "./lillyPhenom";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";

export async function captureSyntheticLillyAGrade() {
  const plan = lillyPlan(), raw = syntheticLillyRow();
  const observedAt = "2026-10-02T10:00:00.000Z";
  const result = await runSourceCrawl(plan, {fetch: createOfficialJsonSourceFetch({
    now: () => new Date(observedAt), allowBrowserFallback: false, http: async request => {
      let body: string;
      if (request.url === plan.source.officialEntryUrl) body = `<script>var phApp=${JSON.stringify(lillyBootstrap)};</script>`;
      else if (request.url === lillyBootstrap.widgetApiEndpoint) body = JSON.stringify({refineSearch: {status: 200, hits: 1, totalHits: 1,
        data: {jobs: [raw], aggregations: [], ui_selections: {country: ["China"]}}}});
      else if (request.url === raw.applyUrl) body = `<script>window.workday = {postingAvailable: true};</script><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting", identifier: {value: raw.reqId}, title: raw.title, description: "Synthetic quality role", datePosted: "2025-11-12",
        jobLocation: {address: {addressCountry: "China", addressLocality: "Shang Hai"}}
      })}</script>`;
      else throw Error("SYNTHETIC_A_UNEXPECTED_REQUEST");
      return {status: 200, body, finalUrl: request.url, contentType: request.method === "POST" ? "application/json" : "text/html", capturedAt: observedAt};
    }
  })});
  return {plan, result, startedAt: new Date(observedAt)};
}
