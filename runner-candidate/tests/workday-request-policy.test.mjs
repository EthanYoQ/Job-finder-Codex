import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchWithOfficialTimeout } from "../src/crawler/officialHttpRuntimeLimits.ts";
import { assertWorkdayAvailable, observeWorkdayResponse, recordWorkdayAccessResponse, withWorkdayRequestPolicy,
  workdayRetryAfterHeader } from "../src/crawler/workdayRequestPolicy.ts";
import { withSourceTransportObservation, retryableTransportFailureFromError,
  safeSourceTransportFailureReason } from "../src/crawler/sourceFetchFailure.ts";
import { transportFailureDiagnosticBundle } from "../src/crawler/sourceFailureDiagnostics.ts";

const amgen = "https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/Careers/jobs";
const csl = "https://csl.wd1.myworkdayjobs.com/wday/cxs/csl/CSL_External/jobs";
const roche = "https://roche.wd3.myworkdayjobs.com/wday/cxs/roche-ext/roche-ext/job/X";
const localCleanup = async t => {
  const directory = await mkdtemp(join(tmpdir(), "workday-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("a real 429 challenge retains its body and defers only its producing host across restarts", async t => {
  const directory = await localCleanup(t);
  const body = "<script src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1'></script>";
  const response = await withWorkdayRequestPolicy(directory, () => fetchWithOfficialTimeout(amgen, {}, {
    fetchImpl: async () => new Response(body, { status: 429, headers: {
      "Content-Type": "text/html; charset=utf-8", "Retry-After": "2700"
    } })
  }));
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get("Retry-After"), "2700");
  assert.equal(workdayRetryAfterHeader(response), "2700");
  const cooldown = JSON.parse(await readFile(join(directory, "workday-cooldown.json"), "utf8"));
  const host = new URL(amgen).hostname;
  assert.equal(cooldown.hosts[host].status, 429);
  assert.equal(cooldown.family, undefined);
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { withWorkdayRequestPolicy } from "./src/crawler/workdayRequestPolicy.ts";
    import { fetchWithOfficialTimeout } from "./src/crawler/officialHttpRuntimeLimits.ts";
    const [root, target, independent, until] = process.argv.slice(1);
    const attempts = [], seen = [];
    const fetchImpl = async url => { attempts.push(url); return new Response("ok"); };
    await withWorkdayRequestPolicy(root, async () => {
      try { await fetchWithOfficialTimeout(target, {}, {fetchImpl}); }
      catch (error) { seen.push(error.code, error.status, error.retryAfterMs > 2_400_000); }
      try { await fetchWithOfficialTimeout(new URL("/en-US/Careers", target), {}, {fetchImpl}); }
      catch (error) { seen.push(error.code); }
      await fetchWithOfficialTimeout(independent, {}, {fetchImpl});
      Date.now = () => Number(until) + 1;
      await fetchWithOfficialTimeout(target, {}, {fetchImpl});
    });
    console.log(JSON.stringify({attempts, seen}));
  `, directory, amgen, csl, String(cooldown.hosts[host].until)], {
    cwd: fileURLToPath(new URL("..", import.meta.url))
  });
  assert.deepEqual(JSON.parse(stdout), {
    attempts: [csl, amgen], seen: ["WORKDAY_COOLDOWN", 429, true, "WORKDAY_COOLDOWN"]
  });
});

test("individual Workday 403 stays local, and ordinary 429 only defers its tenant", async t => {
  const directory = await localCleanup(t);
  const started = [];
  await withWorkdayRequestPolicy(directory, async () => {
    const fetchImpl = async url => {
      started.push(Date.now());
      if (url === roche) return new Response('{"errorCode":"S22"}', { status: 403 });
      if (url === amgen) return new Response('{"error":"limited"}', { status: 429, headers: { "Retry-After": "ambiguous" } });
      return new Response("ok");
    };
    assert.equal((await fetchWithOfficialTimeout(roche, {}, {fetchImpl})).status, 403);
    const limited = await fetchWithOfficialTimeout(amgen, {}, {fetchImpl});
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "ambiguous");
    assert.equal(workdayRetryAfterHeader(limited), "60");
    await assert.rejects(fetchWithOfficialTimeout(amgen, {}, {fetchImpl}), {code: "WORKDAY_COOLDOWN"});
    assert.equal((await fetchWithOfficialTimeout(csl, {}, {fetchImpl})).status, 200);
    assert.equal(started.length, 3);
    assert.ok(started[1] - started[0] >= 2_200);
    assert.ok(started[2] - started[1] >= 2_200);
    const after = JSON.parse(await readFile(join(directory, "workday-cooldown.json"), "utf8"));
    assert.deepEqual(Object.keys(after.hosts), ["amgen.wd1.myworkdayjobs.com"]);
    assert.equal(after.family, undefined);
  });
});

test("post-response spacing waits >= 2.2s after an HTTP 200 completes", async t => {
  const directory = await localCleanup(t);
  const events = [];
  await withWorkdayRequestPolicy(directory, async () => {
    const fetchImpl = async () => {
      events.push({ start: Date.now() });
      await new Promise(resolve => setTimeout(resolve, 150));
      events.at(-1).end = Date.now();
      return new Response("ok");
    };
    await fetchWithOfficialTimeout(csl, {}, { fetchImpl });
    await fetchWithOfficialTimeout(csl, {}, { fetchImpl });
  });
  assert.equal(events.length, 2);
  assert.ok(events[1].start - events[0].end >= 2_150, `gap=${events[1].start - events[0].end}`);
});

test("source cancellation during pacing prevents the queued Workday dispatch", async t => {
  const directory = await localCleanup(t);
  const abort = new AbortController();
  let requests = 0;
  await withWorkdayRequestPolicy(directory, async () => {
    const fetchImpl = async () => { requests++; return new Response("ok"); };
    await fetchWithOfficialTimeout(csl, {}, {fetchImpl});
    const queued = fetchWithOfficialTimeout(csl, {signal: abort.signal}, {fetchImpl});
    abort.abort(new Error("source cancelled"));
    await assert.rejects(queued, /source cancelled/);
    assert.equal(requests, 1);
  });
});

test("cancellation while inspecting challenge bytes stays a rejected request", async t => {
  const directory = await localCleanup(t);
  const abort = new AbortController();
  const reason = new Error("cancelled during challenge inspection");
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), {
    status: 429, headers: { "Content-Type": "text/html" }
  });
  await withWorkdayRequestPolicy(directory, async () => {
    const pending = fetchWithOfficialTimeout(amgen, { signal: abort.signal }, {
      fetchImpl: async () => {
        setImmediate(() => abort.abort(reason));
        return response;
      }
    });
    try {
      await assert.rejects(pending, error => error === reason);
      await assert.rejects(readFile(join(directory, "workday-cooldown.json")), {code: "ENOENT"});
    } finally {
      stream.close();
    }
  });
});

for (const status of [403, 429]) {
  test(`a ${status} challenge scales 5m -> 10m -> 20m -> 30m and resets on HTTP 200`, async t => {
    const directory = await localCleanup(t);
    let now = 1_800_000_000_000;
    t.mock.method(Date, "now", () => now);
    const expectedMinutes = [5, 10, 20, 30, 30];
    for (const [index, minutes] of expectedMinutes.entries()) {
      await withWorkdayRequestPolicy(directory, async () => {
        await fetchWithOfficialTimeout(amgen, {}, { fetchImpl: async () => new Response("challenge", {
          status, headers: { "cf-mitigated": "challenge", "retry-after": "120" }
        }) });
        assert.throws(() => assertWorkdayAvailable(amgen), error =>
          error.status === status && error.retryAfterMs === minutes * 60_000, `step ${index}`);
        assert.doesNotThrow(() => assertWorkdayAvailable(csl));
      }, { minSpacingMs: 0, maxSpacingMs: 0 });
      const saved = JSON.parse(await readFile(join(directory, "workday-cooldown.json"), "utf8"));
      assert.deepEqual(saved.hosts[new URL(amgen).hostname], { status, until: now + minutes * 60_000, hits: index + 1 });
      assert.equal(saved.family, undefined);
      now += minutes * 60_000;
    }
    await withWorkdayRequestPolicy(directory, async () => {
      assert.equal((await fetchWithOfficialTimeout(amgen, {}, { fetchImpl: async () => new Response("ok") })).status, 200);
      assert.doesNotThrow(() => assertWorkdayAvailable(amgen));
      await fetchWithOfficialTimeout(amgen, {}, { fetchImpl: async () => new Response("challenge", {
        status, headers: { "cf-mitigated": "challenge", "retry-after": "60" }
      }) });
      assert.throws(() => assertWorkdayAvailable(amgen), error =>
        error.status === status && error.retryAfterMs === 5 * 60_000);
      // An overlapping HTTP 200 completed before the active cooldown expires must NOT clear the active cooldown.
      now += 60_000;
      await observeWorkdayResponse(amgen, new Response("ok"), new AbortController().signal);
      assert.throws(() => assertWorkdayAvailable(amgen), error =>
        error.status === status && error.retryAfterMs === 4 * 60_000);
    }, { minSpacingMs: 0, maxSpacingMs: 0 });
  });

  test(`a ${status} cooldown attributes an actual response and same-host local deferral separately`, async t => {
    const directory = await localCleanup(t);
    const observations = [];
    let requests = 0;
    const fetchImpl = async () => {
      requests++;
      return new Response("challenge", { status,
        headers: { "cf-mitigated": "challenge", "retry-after": "10800" } });
    };
    await withWorkdayRequestPolicy(directory, async () => {
      await withSourceTransportObservation("actual-source", value => observations.push(value), async () => {
        assert.equal((await fetchWithOfficialTimeout(amgen, {}, { fetchImpl })).status, status);
      });
      await withSourceTransportObservation("deferred-source", value => observations.push(value), async () => {
        await assert.rejects(fetchWithOfficialTimeout(amgen, {}, { fetchImpl }), error => {
          const failure = retryableTransportFailureFromError(error);
          assert.equal(failure.code, "OFFICIAL_REQUEST_DEFERRED");
          assert.equal(failure.deferredStatus, status);
          assert.ok(failure.retryAfterMs > 10_799_000);
          assert.match(safeSourceTransportFailureReason(failure), new RegExp(`previous HTTP ${status}`));
          assert.deepEqual(transportFailureDiagnosticBundle(failure, {
            fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: []
          }), {
            failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE", failureDiagnosticCode: "FETCH_FAILED_CLOSED",
            fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: []
          });
          return true;
        });
      });
    });
    assert.equal(requests, 1);
    assert.ok(observations.length >= 4, "Deadline checkpoints precede the final source reports");
    const actual = observations.filter(value => value.sourceId === "actual-source").at(-1);
    const deferred = observations.filter(value => value.sourceId === "deferred-source").at(-1);
    assert.equal(actual.sourceId, "actual-source");
    assert.equal(actual.observedActualHttp, true);
    assert.deepEqual(actual.actualHttpStatuses, [status]);
    assert.equal(actual.locallyDeferred, false);
    assert.equal(actual.retryAt, actual.lastActualRequestAt + 10_800_000);
    assert.equal(deferred.sourceId, "deferred-source");
    assert.equal(deferred.observedActualHttp, false);
    assert.deepEqual(deferred.actualHttpStatuses, []);
    assert.equal(deferred.lastActualRequestAt, undefined);
    assert.equal(deferred.locallyDeferred, true);
    assert.equal(deferred.deferredStatus, status);
    assert.ok(deferred.retryAt >= actual.retryAt);
  });
}

test("active legacy family deadlines survive restarts and new host observations without extension", async t => {
  const directory = await localCleanup(t), file = join(directory, "workday-cooldown.json");
  let now = 1_800_000_000_000, requests = 0;
  t.mock.method(Date, "now", () => now);
  const family = { status: 429, until: now + 40 * 60_000 };
  await writeFile(file, JSON.stringify({ family, hosts: {} }));
  const fetchImpl = async () => { requests++; return new Response("ready"); };
  await withWorkdayRequestPolicy(directory, async () => {
    await assert.rejects(fetchWithOfficialTimeout(csl, {}, { fetchImpl }), { code: "WORKDAY_COOLDOWN" });
    // A response already in flight can still arrive while the legacy hold is active.
    recordWorkdayAccessResponse(amgen, 403, new Headers({ "cf-mitigated": "challenge", "retry-after": "7200" }));
    const observation = [];
    await withSourceTransportObservation("csl-response", value => observation.push(value), async () => {
      const delay = recordWorkdayAccessResponse(csl, 429, new Headers({ "retry-after": "120" }));
      assert.equal(delay, family.until - now);
    });
    assert.equal(observation.at(-1).retryAt, family.until);
  });
  const written = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(written.family, family, "The old shared deadline is neither reset nor extended");
  assert.equal(written.hosts[new URL(amgen).hostname].until, now + 7_200_000);
  assert.equal(written.hosts[new URL(csl).hostname].until, now + 120_000);
  now = family.until - 1;
  await withWorkdayRequestPolicy(directory, async () => {
    await assert.rejects(fetchWithOfficialTimeout(csl, {}, { fetchImpl }), error =>
      error.code === "WORKDAY_COOLDOWN" && error.retryAfterMs === 1);
  });
  assert.equal(requests, 0);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), written, "Reading after restart does not rewrite state");
  now = family.until;
  await withWorkdayRequestPolicy(directory, async () => {
    assert.equal((await fetchWithOfficialTimeout(csl, {}, { fetchImpl })).status, 200);
    assert.throws(() => assertWorkdayAvailable(amgen), error =>
      error.code === "WORKDAY_COOLDOWN" && error.status === 403 && error.retryAfterMs === 4_800_000);
  });
  assert.equal(requests, 1);
});
