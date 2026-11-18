import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../src/data/companyRegistry.ts";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan.ts";
import { createWorkdaySourceFetch } from "../src/crawler/workdaySourceFetch.ts";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl.ts";
import { withWorkdayRequestPolicy } from "../src/crawler/workdayRequestPolicy.ts";
import { withSourceTransportObservation } from "../src/crawler/sourceTransportObservation.ts";
import { fetchWithOfficialTimeout } from "../src/crawler/officialHttpRuntimeLimits.ts";

const plans = buildStagedSourceCrawlPlans(candidateCompanies);
const restrictedPlan = plans.find(plan => plan.source.id === "source-csl-china-social");
const independentPlan = plans.find(plan => plan.source.id === "source-biogen-china-social");
const restrictedHost = new URL(restrictedPlan.source.officialEntryUrl).hostname;
const independentHost = new URL(independentPlan.source.officialEntryUrl).hostname;

for (const status of [403, 429]) {
  test(`CSL HTTP ${status} challenge retains response evidence while the separately authorized Biogen plan executes`, async t => {
    const root = await mkdtemp(join(tmpdir(), "workday-host-scope-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const body = "<html><script src='/cdn-cgi/challenge-platform/example'></script></html>";
    const requests = [], observations = [];
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async (input, init) => {
      const url = new URL(String(input));
      assert.ok([restrictedHost, independentHost].includes(url.hostname), "No alternate target or fallback is contacted");
      requests.push({ url: url.href, host: url.hostname, at: Date.now(), method: init.method });
      const restricted = url.hostname === restrictedHost;
      const response = new Response(restricted ? body : JSON.stringify({ total: 1, userAuthenticated: false,
        jobPostings: [{ title: "Synthetic authorized role", externalPath: "/job/Shanghai-China/Role_REQ1-1",
          locationsText: "Shanghai, China", bulletFields: ["REQ1"] }],
        facets: [{ facetParameter: "locationCountry", values: [{ id: "6cb77610a8a543aea2d6bc10457e35d4", descriptor: "China", count: 1 }] }]
      }), { status: restricted ? status : 200, headers: restricted
        ? { "content-type": "text/html", "retry-after": "7200" }
        : { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    });
    const fetch = createWorkdaySourceFetch();
    const capture = plan => withSourceTransportObservation(plan.source.id,
      observation => observations.push(observation), () => runSourceCrawl(plan, { fetch, isBaseline: false }));
    await withWorkdayRequestPolicy(root, async () => {
      const restricted = await withSourceTransportObservation(restrictedPlan.source.id,
        observation => observations.push(observation), async () => {
          const result = await runSourceCrawl(restrictedPlan, { fetch, isBaseline: false });
          await assert.rejects(fetchWithOfficialTimeout(independentPlan.source.officialEntryUrl),
            { code: "OFFICIAL_REQUEST_DEFERRED" }, "A blocked acquisition cannot switch targets");
          return result;
        });
      assert.equal(restricted.truth.transportSuccess, false);
      assert.equal(restricted.fetchEvidence.artifacts.length, 1);
      assert.equal(restricted.fetchEvidence.artifacts[0].httpStatus, status);
      assert.equal(restricted.fetchEvidence.artifacts[0].body, body);
      const deferred = await capture(restrictedPlan);
      assert.equal(deferred.truth.transportSuccess, false);
      assert.equal(deferred.transportFailure.code, "OFFICIAL_REQUEST_DEFERRED");
      assert.equal(deferred.fetchEvidence, undefined, "Local deferral does not invent another response artifact");
      const independent = await capture(independentPlan);
      assert.equal(independent.truth.transportSuccess, true);
      assert.equal(independent.truth.completenessVerified, true);
      assert.equal(independent.jobs.length, 1);
      assert.equal(independent.fetchEvidence.artifacts[0].httpStatus, 200);
    });
    assert.deepEqual(requests.map(request => request.host), [restrictedHost, independentHost]);
    assert.ok(requests[1].at - requests[0].at >= 500, "Shared pacing remains active across hosts");
    assert.ok(requests.every(request => request.method === "POST"));
    const saved = JSON.parse(await readFile(join(root, "workday-cooldown.json"), "utf8"));
    assert.equal(saved.family, undefined);
    assert.deepEqual(Object.keys(saved.hosts), [restrictedHost]);
    const actual = observations.find(observation => observation.sourceId === restrictedPlan.source.id && observation.observedActualHttp);
    assert.equal(saved.hosts[restrictedHost].until >= actual.lastActualRequestAt + 7_200_000, true);
    assert.equal(observations.filter(observation => observation.sourceId === independentPlan.source.id).length, 0,
      "The independent source does not inherit a local deferral or failing HTTP status");
    await withWorkdayRequestPolicy(root, async () => {
      const deferred = await capture(restrictedPlan);
      assert.equal(deferred.transportFailure.code, "OFFICIAL_REQUEST_DEFERRED");
      assert.equal(requests.filter(request => request.host === restrictedHost).length, 1,
        "Restart retains the producing host restriction without a second dispatch");
    });
  });
}
