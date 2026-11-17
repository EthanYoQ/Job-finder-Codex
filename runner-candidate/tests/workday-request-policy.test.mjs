import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fetchWithOfficialTimeout } from "../src/crawler/officialHttpRuntimeLimits.ts";
import { withWorkdayRequestPolicy, workdayRetryAfterHeader } from "../src/crawler/workdayRequestPolicy.ts";

const amgen = "https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/Careers/jobs";
const csl = "https://csl.wd1.myworkdayjobs.com/wday/cxs/csl/CSL_External/jobs";
const roche = "https://roche.wd3.myworkdayjobs.com/wday/cxs/roche-ext/roche-ext/job/X";
const localCleanup = async t => {
  const directory = await mkdtemp(join(tmpdir(), "workday-policy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("a real 429 challenge retains its body and defers other tenants across collector restarts", async t => {
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
  assert.equal(cooldown.family.status, 429);
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { withWorkdayRequestPolicy } from "./src/crawler/workdayRequestPolicy.ts";
    import { fetchWithOfficialTimeout } from "./src/crawler/officialHttpRuntimeLimits.ts";
    const [root, target, until] = process.argv.slice(1);
    const attempts = [], seen = [];
    const fetchImpl = async url => { attempts.push(url); return new Response("ok"); };
    await withWorkdayRequestPolicy(root, async () => {
      try { await fetchWithOfficialTimeout(target, {}, {fetchImpl}); }
      catch (error) { seen.push(error.code, error.status, error.retryAfterMs > 2_400_000); }
      await fetchWithOfficialTimeout("https://careers.amgen.com/en", {}, {fetchImpl});
      Date.now = () => Number(until) + 1;
      await fetchWithOfficialTimeout(target, {}, {fetchImpl});
    });
    console.log(JSON.stringify({attempts, seen}));
  `, directory, csl, String(cooldown.family.until)], {
    cwd: fileURLToPath(new URL("..", import.meta.url))
  });
  assert.deepEqual(JSON.parse(stdout), {
    attempts: ["https://careers.amgen.com/en", csl], seen: ["WORKDAY_COOLDOWN", 429, true]
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
    assert.ok(started[1] - started[0] >= 500);
    assert.ok(started[2] - started[1] >= 500);
    const after = JSON.parse(await readFile(join(directory, "workday-cooldown.json"), "utf8"));
    assert.deepEqual(Object.keys(after.hosts), ["amgen.wd1.myworkdayjobs.com"]);
    assert.equal(after.family, undefined);
  });
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
