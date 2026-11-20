import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { retryableHttpTransportFailure, retryableTransportFailureFromError,
  withSourceTransportObservation } from "../src/crawler/sourceFetchFailure.ts";
import { WorkdayCooldownError } from "../src/crawler/workdayRequestPolicy.ts";
import { fetchWithOfficialTimeout } from "../src/crawler/officialHttpRuntimeLimits.ts";
import { defaultHttpHtmlClient } from "../src/crawler/httpHtmlSourceFetch.ts";
import { createChromiumDom } from "../src/crawler/local-browser/chromium-dom.mjs";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter.ts";
import { recordIsolatedSourceTransportObservation } from "../src/crawler/sourceTransportObservation.ts";
import { buildRetrySchedule, readRetrySources, selectDueSourceIds } from "../../pipeline/retry-schedule.ts";

const liveResponse = (status, retryAfter) => fetchWithOfficialTimeout("https://careers.example.test/jobs", {}, {
  fetchImpl: async () => new Response("<h1>Unavailable</h1>", { status,
    headers: { "content-type": "text/html", ...(retryAfter ? { "retry-after": retryAfter } : {}) } })
});

test("transport observations retain the longest official retry floor across failures", async t => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const observations = [];
  await withSourceTransportObservation("generic-source", value => observations.push(value), async () => {
    let firstResponse, secondResponse, bothStarted;
    const started = new Promise(resolve => { bothStarted = resolve; });
    const first = fetchWithOfficialTimeout("https://careers.example.test/jobs/1", {}, {
      fetchImpl: () => new Promise(resolve => { firstResponse = resolve; })
    });
    const second = fetchWithOfficialTimeout("https://careers.example.test/jobs/2", {}, {
      fetchImpl: () => new Promise(resolve => { secondResponse = resolve; bothStarted(); })
    });
    await started;
    firstResponse(new Response("unavailable", { status: 503, headers: { "retry-after": "10800" } }));
    await first;
    now += 500;
    secondResponse(new Response("limited", { status: 429, headers: { "retry-after": "60" } }));
    await second;
  });
  assert.equal(observations.length, 2, "Only the increased deadline and final observation are published");
  assert.deepEqual(observations.at(-1), { sourceId: "generic-source", observedAt: now,
    observedActualHttp: true, actualHttpStatuses: [503, 429], lastActualRequestAt: now,
    locallyDeferred: false, retryAt: 1_800_010_800_000, retryAfterMs: 10_799_500 });
});

test("a rejected official Retry-After still exposes the real HTTP response without inventing a floor", async () => {
  const sourceId = "source-biogen-china-social";
  const observations = [];
  await assert.rejects(withSourceTransportObservation(sourceId, value => observations.push(value), async () => {
    await liveResponse(429, "ambiguous");
    throw new Error("source stopped");
  }), /source stopped/);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].observedActualHttp, true);
  assert.deepEqual(observations[0].actualHttpStatuses, [429]);
  assert.equal(observations[0].retryAt, undefined);
  const responseAt = observations[0].lastActualRequestAt;
  const schedule = buildRetrySchedule({
    sourceConfigHashes: new Map([[sourceId, "a".repeat(64)]]), completeSourceIds: new Set(),
    previous: [], attemptedSourceIds: new Set([sourceId]),
    outcomes: [{ ...observations[0], challenged: true }], now: responseAt + 30 * 60_000
  });
  assert.equal(schedule.nextRetryAt, responseAt + 4 * 60 * 60_000);
});

test("network exceptions and local fetch counters do not imply an HTTP response", async () => {
  const observations = [];
  await withSourceTransportObservation("generic-source", value => observations.push(value), async () => {
    assert.equal(retryableTransportFailureFromError(Object.assign(new Error("reset"), {
      code: "ECONNRESET"
    })).code, "OFFICIAL_NETWORK_ERROR");
  });
  assert.deepEqual(observations, []);
});

test("parallel source scopes never attribute one source response to another", async () => {
  const observations = [];
  await Promise.all([429, 503].map(status => withSourceTransportObservation(`source-${status}`,
    value => observations.push(value), async () => {
      await Promise.resolve();
      await liveResponse(status);
    })));
  assert.deepEqual(observations.map(value => [value.sourceId, value.actualHttpStatuses]),
    [["source-429", [429]], ["source-503", [503]]]);
});

test("classifying historical HTTP and cooldown failures does not record a current request or deferral", async () => {
  const observations = [];
  await withSourceTransportObservation("source-historical", value => observations.push(value), async () => {
    assert.equal(retryableHttpTransportFailure(429, { value: "7200", delayMs: 7_200_000 }).code, "OFFICIAL_HTTP_429");
    assert.equal(retryableHttpTransportFailure(503).code, "OFFICIAL_HTTP_503");
    assert.equal(retryableTransportFailureFromError(new WorkdayCooldownError(429, 7_200_000)).code,
      "OFFICIAL_REQUEST_DEFERRED");
  });
  assert.deepEqual(observations, []);
});

for (const sourceId of ["source-sanofi-china-social", "source-novartis-china-social"]) {
  for (const status of [429, 503]) {
    test(`${sourceId} live HTML HTTP ${status} keeps Retry-After=7200 in its scheduler observation`, async t => {
      const now = 1_800_000_000_000, observations = [];
      t.mock.method(Date, "now", () => now);
      let requests = 0;
      t.mock.method(globalThis, "fetch", async () => {
        requests++;
        return new Response("<h1>Unavailable</h1>", { status,
          headers: { "content-type": "text/html", "retry-after": "7200" } });
      });
      await withSourceTransportObservation(sourceId, value => observations.push(value), async () => {
        const response = await defaultHttpHtmlClient({ url: "https://careers.example.test/jobs", headers: {} });
        assert.equal(response.status, status);
        assert.equal(response.retryAfter, undefined, "The scheduler must not depend on the narrowed HTML response");
      });
      assert.equal(requests, 1);
      assert.equal(observations.length, 2);
      for (const observation of observations) assert.deepEqual(observation, { sourceId, observedAt: now, observedActualHttp: true,
        actualHttpStatuses: [status], lastActualRequestAt: now, locallyDeferred: false,
        retryAt: now + 7_200_000, retryAfterMs: 7_200_000 });
      const schedule = buildRetrySchedule({ sourceConfigHashes: new Map([[sourceId, "a".repeat(64)]]),
        completeSourceIds: new Set(), previous: [], attemptedSourceIds: new Set([sourceId]),
        outcomes: observations, now });
      assert.equal(schedule.nextRetryAt, now + 7_200_000);
      assert.equal(schedule.retrySources[0].lastActualRequestAt, now);
    });
  }
}

test("browser response events retain their owning source and ignore unrelated asset failures", async () => {
  const context = new EventEmitter(), observations = [];
  context.pages = () => [];
  const chromium = { launch: async () => ({ newContext: async () => context, close: async () => {} }) };
  let ready, finish;
  const registered = new Promise(resolve => { ready = resolve; });
  const pending = withSourceTransportObservation("source-browser", value => observations.push(value), async () => {
    const browser = await createChromiumDom({ chromium });
    ready();
    await new Promise(resolve => { finish = resolve; });
    await browser.close();
  });
  await registered;
  const frame = { page: () => ({ mainFrame: () => frame }) };
  const response = (navigation, status, retryAfter) => ({
    url: () => "https://careers.example.test/jobs", status: () => status,
    headers: () => ({ "retry-after": retryAfter }), frame: () => frame,
    request: () => ({ isNavigationRequest: () => navigation, resourceType: () => navigation ? "document" : "image" })
  });
  context.emit("response", response(false, 429, "10800"));
  context.emit("response", response(true, 503, "7200"));
  finish();
  await pending;
  assert.equal(observations.length, 2);
  assert.deepEqual(observations[0].actualHttpStatuses, [503]);
  assert.equal(observations[0].retryAt - observations[0].lastActualRequestAt, 7_200_000);
});

test("a longer official deadline is published before a blocked response body completes", async () => {
  const observations = [];
  let finishBody, bodyEntered;
  const entered = new Promise(resolve => { bodyEntered = resolve; });
  const pending = withSourceTransportObservation("source-blocked-body", value => observations.push(value), () =>
    fetchWithOfficialTimeout("https://careers.example.test/jobs", {}, {
      fetchImpl: async () => new Response("unavailable", { status: 503, headers: { "retry-after": "7200" } }),
      consumeResponse: async () => {
        bodyEntered();
        return new Promise(resolve => { finishBody = resolve; });
      }
    }));
  await entered;
  try {
    assert.equal(observations.length, 1);
    assert.equal(observations[0].retryAt - observations[0].lastActualRequestAt, 7_200_000);
    assert.deepEqual(observations[0].actualHttpStatuses, [503]);
  } finally { finishBody("completed"); }
  await pending;
  assert.equal(observations.length, 2);
});

for (const observed of [true, false]) {
  test(`the source router honors the live retry floor with${observed ? "" : "out"} a scheduler callback`, async () => {
    let requests = 0, delays = 0;
    const observations = [];
    const html = async () => {
      requests++;
      const response = await liveResponse(503, "7200");
      // The historical HTML result contract omits Retry-After, but the live boundary retains it.
      return { ok: false, capturedAt: new Date().toISOString(), failureReason: "unavailable",
        transportFailure: retryableHttpTransportFailure(response.status) };
    };
    const unexpected = () => assert.fail("Unexpected adapter");
    const router = createSourceFetchRouter({ html, moka: unexpected, fallback: unexpected,
      delay: async () => { delays++; } });
    const plan = { source: { id: "source-sanofi-china-social", atsKind: "OFFICIAL_HTML" },
      adapterId: "html-table", transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 } };
    const run = () => router(plan);
    const result = await (observed
      ? withSourceTransportObservation(plan.source.id, value => observations.push(value), run) : run());
    assert.equal(result.ok, false);
    assert.equal(requests, 1);
    assert.equal(delays, 0);
    assert.equal(observations.length, observed ? 2 : 0);
  });
}

test("isolated observations merge only into their source and checkpoint only a growing deadline", async () => {
  const observations = [], now = Date.now();
  const incoming = { sourceId: "source-isolated", observedAt: now, observedActualHttp: true,
    actualHttpStatuses: [503], lastActualRequestAt: now, locallyDeferred: false,
    retryAt: now + 7_200_000, retryAfterMs: 7_200_000 };
  await withSourceTransportObservation(incoming.sourceId, value => observations.push(value), async () => {
    recordIsolatedSourceTransportObservation({ ...incoming, sourceId: "source-other" });
    assert.equal(observations.length, 0);
    recordIsolatedSourceTransportObservation(incoming);
    assert.equal(observations.length, 1);
    recordIsolatedSourceTransportObservation(incoming);
    assert.equal(observations.length, 1);
  });
  assert.equal(observations.length, 2);
  assert.equal(observations.at(-1).retryAt, incoming.retryAt);
  assert.deepEqual(observations.at(-1).actualHttpStatuses, [503]);
});

test("a same-source follow-up after HTTP 503 Retry-After=7200 is locally deferred without a dispatch", async t => {
  let now = 1_800_000_000_000, requests = 0;
  t.mock.method(Date, "now", () => now);
  const observations = [], deadline = now + 7_200_000;
  const fetchImpl = async () => {
    requests++;
    return requests === 1
      ? new Response("unavailable", { status: 503, headers: { "retry-after": "7200" } })
      : new Response("ready", { status: 200 });
  };
  await withSourceTransportObservation("source-sanofi-china-social", value => observations.push(value), async () => {
    assert.equal((await fetchWithOfficialTimeout("https://careers.example.test/first", {}, { fetchImpl })).status, 503);
    await assert.rejects(fetchWithOfficialTimeout("https://careers.example.test/next", {}, { fetchImpl }), error => {
      assert.equal(error.code, "OFFICIAL_REQUEST_DEFERRED");
      assert.equal(error.retryAt, deadline);
      now += 100;
      assert.deepEqual(retryableTransportFailureFromError(error), {
        code: "OFFICIAL_REQUEST_DEFERRED", retryable: true, retryAfterMs: 7_199_900
      });
      return true;
    });
    assert.equal(requests, 1);
    now = deadline + 1;
    assert.equal((await fetchWithOfficialTimeout("https://careers.example.test/next", {}, { fetchImpl })).status, 200);
    assert.equal(requests, 2);
  });
  assert.equal(observations.length, 2, "A deferral does not extend or republish the existing deadline");
  assert.equal(observations.at(-1).locallyDeferred, true);
  assert.equal(observations.at(-1).retryAt, deadline);
  assert.deepEqual(observations.at(-1).actualHttpStatuses, [503]);
});

test("explicit browser navigation respects the same-source live retry deadline", async () => {
  const context = new EventEmitter(), page = new EventEmitter(), observations = [];
  let navigations = 0;
  const frame = { page: () => page };
  page.mainFrame = () => frame;
  page.goto = async url => {
    navigations++;
    const response = { url: () => url, status: () => 503, headers: () => ({ "retry-after": "7200" }),
      headerValue: async () => "7200", frame: () => frame,
      request: () => ({ isNavigationRequest: () => true, resourceType: () => "document" }) };
    context.emit("response", response);
    return response;
  };
  context.pages = () => [page];
  context.newPage = async () => page;
  const chromium = { launch: async () => ({ newContext: async () => context, close: async () => {} }) };
  await withSourceTransportObservation("source-browser-navigation", value => observations.push(value), async () => {
    const browser = await createChromiumDom({ chromium });
    const tab = await browser.createBrowserTab("cdp", "https://careers.example.test/jobs");
    await assert.rejects(tab.goto("https://careers.example.test/next"), { code: "OFFICIAL_REQUEST_DEFERRED" });
    await browser.close();
  });
  assert.equal(navigations, 1);
  assert.equal(observations.at(-1).locallyDeferred, true);
  assert.deepEqual(observations.at(-1).actualHttpStatuses, [503]);
});

for (const retryAfter of ["9999999999", "Fri, 31 Dec 9999 23:59:59 GMT"]) {
  test(`extreme valid Retry-After ${retryAfter} remains exact through durable scheduling`, async t => {
    const now = 1_800_000_000_000, sourceId = "source-extreme-retry", observations = [];
    t.mock.method(Date, "now", () => now);
    const deadline = /^\d+$/.test(retryAfter) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
    await withSourceTransportObservation(sourceId, value => observations.push(value), async () => {
      await liveResponse(503, retryAfter);
      await assert.rejects(liveResponse(503), { code: "OFFICIAL_REQUEST_DEFERRED" });
    });
    assert.equal(observations.at(-1).retryAt, deadline);
    assert.ok(Number.isSafeInteger(deadline));
    assert.ok(Number.isFinite(new Date(deadline).getTime()));
    const hashes = new Map([[sourceId, "a".repeat(64)]]);
    const schedule = buildRetrySchedule({ sourceConfigHashes: hashes, completeSourceIds: new Set(),
      previous: [], attemptedSourceIds: new Set([sourceId]), outcomes: observations, now });
    const restored = readRetrySources(JSON.parse(JSON.stringify(schedule)), hashes);
    assert.equal(restored[0].retryAt, deadline);
    assert.deepEqual(selectDueSourceIds([sourceId], new Set(), restored, now + 7 * 24 * 60 * 60_000), []);
    assert.deepEqual(selectDueSourceIds([sourceId], new Set(), restored, deadline - 1), []);
    assert.deepEqual(selectDueSourceIds([sourceId], new Set(), restored, deadline), [sourceId]);
  });
}
