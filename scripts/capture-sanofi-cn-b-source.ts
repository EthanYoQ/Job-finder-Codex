/** Dot-cloud candidate capture only. The sole publisher owns SQL48 and real B issuance. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { serialize } from "node:v8";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createSanofiChineseSourceFetch } from "../src/crawler/sanofiChineseNative";
import { runSourceCrawl, type SourceFetchResult } from "../src/crawler/runSourceCrawl";
import { captureSanofiChineseIndependent, type SanofiChineseDomCapture } from "../src/crawler/sanofiChineseRenderedTraversal";
import { createOfficialJsonRenderedTraversalValidation } from "../src/crawler/traversalCertificate";
import { runWithOfficialSourceAttemptTimeout } from "../src/crawler/officialHttpRuntimeLimits";


const [mode, directory, domPath, ...extra] = process.argv.slice(2);
if (!["main", "independent"].includes(mode ?? "") || !directory || extra.length || (mode === "independent" ? !domPath : domPath !== undefined)) {
  throw Error("Usage: capture-sanofi-cn-b-source.ts main <new-private-directory> | independent <new-private-directory> <fresh-dom-capture.json>");
}
const root = resolve(directory); await mkdir(root, { mode: 0o700 });
const put = (name: string, data: string | Uint8Array) => writeFile(join(root, name), data, { flag: "wx", mode: 0o600 });
const sourceId = "source-sanofi-china-social";
const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === sourceId)!;
const sourceConfigSha256 = sourcePlanConfigSha256(plan), startedAt = new Date().toISOString();
await put("plan.json", JSON.stringify(plan, null, 2));
try {
  if (mode === "main") {
    let fetched: SourceFetchResult | undefined, responseNumber = 0;
    const fetch = createSanofiChineseSourceFetch({ onResponse: async (request, response, requestedAt) => {
      const sequence = responseNumber++;
      await put(`response-${String(sequence).padStart(4, "0")}.json`, JSON.stringify({ requestedAt,
        request: { url: request.url, method: request.method ?? "GET", ...(request.redirect?{redirect:request.redirect}:{}), ...(request.body === undefined ? {} : { body: request.body }) },
        response, bodySha256: createHash("sha256").update(response.body).digest("hex") }, null, 2));
      console.log(JSON.stringify({ event: "MAIN_HTTP_ORIGINAL_ARCHIVED", sequence, url: request.url, status: response.status }));
    } });
    const result = await runWithOfficialSourceAttemptTimeout(() => runSourceCrawl(plan, { isBaseline: false, fetch: async (p, t) => {
      fetched = await fetch(p, t);
      await put("sourceFetchResult.v8", serialize(fetched)); return fetched;
    } }), 20 * 60_000);
    const bytes = serialize(fetched), finishedAt = new Date().toISOString();
    await put("result.v8", serialize(result)); await put("records.json", JSON.stringify(result.jobs, null, 2));
    await put("reviewed-worker-capture.json", JSON.stringify({ schemaVersion: 2, sourceId, sourceConfigSha256, startedAt, finishedAt,
      fetched: { path: join(root, "sourceFetchResult.v8"), sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "v8" } }, null, 2));
    const summary = { purpose: "NON_CERTIFYING_CANDIDATE_CAPTURE", sourceId, sourceConfigSha256, startedAt, finishedAt,
      status: result.status, truth: result.truth, count: result.jobs.length, dates: result.jobs.filter(j => j.officialPublishedAt).length,
      fetchCounts: result.fetchEvidence?.fetchCounts, failureReason: result.status === "FAILED" ? result.failureReason : undefined };
    await put("capture-summary.json", JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
    if (!result.truth.transportSuccess || !result.truth.adapterSuccess || !result.truth.completenessVerified) process.exitCode = 1;
  } else {
    const domText = await readFile(resolve(domPath!), "utf8");
    await put("dom-capture.json", domText);
    const captured = await captureSanofiChineseIndependent({ dom: JSON.parse(domText) as SanofiChineseDomCapture,
      onReceipt: async (receipt, sequence) => {
        await put(`independent-http-${String(sequence).padStart(4, "0")}.json`, JSON.stringify(receipt, null, 2));
        console.log(JSON.stringify({ event: "INDEPENDENT_HTTP_ORIGINAL_ARCHIVED", sequence, url: receipt.url, status: receipt.status }));
      }
    });
    await put("ui-traversal.json", JSON.stringify(captured, null, 2));
    const validation = createOfficialJsonRenderedTraversalValidation({ sourceId, companyId: plan.company.id, sourceConfigSha256,
      surfaceIds: [plan.source.surfaceId!], channelIds: plan.expectedChannels!.map(c => c.channelId), pages: captured.pages,
      observedAt: captured.observedAt, expiresAt: new Date(Date.parse(captured.observedAt) + 30 * 60_000).toISOString() });
    await put("independent-validation.json", JSON.stringify(validation, null, 2));
    const summary = { purpose: "NON_CERTIFYING_INDEPENDENT_DOM_PLUS_HTTP_CAPTURE", sourceId, sourceConfigSha256,
      observedAt: captured.observedAt, finishedAt: new Date().toISOString(), pageCount: captured.pages.length,
      rawCount: captured.pages.reduce((n, p) => n + p.rawRows.length, 0),
      excludedCount: captured.pages.flatMap(p => p.rawRows).filter(r => r.scopeDecision === "EXCLUDED_AUDITED").length,
      artifactSha256: validation.artifactSha256 };
    await put("capture-summary.json", JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
  }
} catch (error) {
  await put("failure.json", JSON.stringify({ sourceId, sourceConfigSha256, startedAt, failedAt: new Date().toISOString(), error: String(error) }, null, 2));
  throw error;
}
