import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { createAmgenManualWorkdaySourceFetch, validateStrictAmgenManualWorkdayEvidence } from "../../src/crawler/amgenManualWorkdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { amgenManualWorkdayFixture } from "../helpers/amgenManualWorkdayFixture";
import { AMGEN_TIME } from "../helpers/amgenNativeFixture";

const plan = () => buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
const now = () => new Date(AMGEN_TIME);
type Fixture = ReturnType<typeof amgenManualWorkdayFixture>;
type Request = Parameters<Fixture["http"]>[0];
type Response = Awaited<ReturnType<Fixture["http"]>>;
const key = (role: string, index: number) => `amgen-v2-${role}-${String(index).padStart(4, "0")}`;

function controlled(total: number, transform: (body: string) => string = body => body) {
  const fixture = amgenManualWorkdayFixture(total);
  const pending = new Map<string, { request: Request; resolve: (value: Response) => void; reject: (error: Error) => void }>();
  const started: string[] = [], completed: Array<{ url: string; capturedAt: string; body: string }> = [];
  let peak = 0, clock = 0;
  const stamp = (response: Response) => ({ ...response, body: transform(response.body), capturedAt: new Date(Date.parse(AMGEN_TIME) + ++clock).toISOString() });
  const http = async (request: Request): Promise<Response> => {
    started.push(request.url);
    if (!fixture.rows.some(row => row.url === request.url || row.apiUrl === request.url)) return stamp(await fixture.http(request));
    return new Promise((resolve, reject) => {
      pending.set(request.url, { request, resolve, reject }); peak = Math.max(peak, pending.size);
    });
  };
  const release = async (url: string, patch: Partial<Response> = {}) => {
    const entry = pending.get(url); expect(entry).toBeDefined();
    const response = { ...stamp(await fixture.http(entry!.request)), ...patch };
    completed.push({ url, capturedAt: response.capturedAt, body: response.body });
    pending.delete(url); entry!.resolve(response); await setImmediate();
  };
  const reject = async (url: string, error: Error) => {
    const entry = pending.get(url); expect(entry).toBeDefined();
    pending.delete(url); entry!.reject(error); await setImmediate();
  };
  const ready = async () => { for (let i = 0; i < 100 && pending.size < Math.min(2, total); i++) await setImmediate(); expect(pending.size).toBe(Math.min(2, total)); };
  return { fixture, pending, started, completed, http, release, reject, ready, peak: () => peak };
}

it("collects the dynamic full 50-row denominator with at most two chains, retaining real completion order and original row IDs", async () => {
  const c = controlled(50), p = plan();
  const work = runSourceCrawl(p, { fetch: createAmgenManualWorkdaySourceFetch({ http: c.http, now }) });
  await c.ready();
  expect(c.pending.has(c.fixture.rows[0]!.url)).toBe(true);
  expect(c.started).not.toContain(c.fixture.rows[0]!.apiUrl);
  // Hold the first native response while the second worker completes every other chain.
  for (let i = 1; i < c.fixture.rows.length; i++) {
    const row = c.fixture.rows[i]!;
    expect(c.pending.has(row.url)).toBe(true);
    expect(c.started).not.toContain(row.apiUrl);
    await c.release(row.url);
    expect(c.pending.has(row.apiUrl)).toBe(true);
    await c.release(row.apiUrl);
  }
  await c.release(c.fixture.rows[0]!.url);
  await c.release(c.fixture.rows[0]!.apiUrl);
  const result = await work;
  expect(result.status).toBe("SUCCESS");
  expect(c.peak()).toBe(2); expect(c.pending.size).toBe(0);
  expect(c.started).toHaveLength(108);
  expect(result.jobs.map(j => j.sourceJobId)).toEqual(c.fixture.rows.map(row => row.sourceJobId));
  expect(result.jobs.map(j => j.officialUrl)).toEqual(c.fixture.rows.map(row => row.externalUrl));
  expect(c.fixture.catalogueOnlyRows.every(row => !c.started.includes(row.apiUrl))).toBe(true);
  const evidence = result.fetchEvidence!;
  const details = evidence.artifacts.filter(a => a.logicalKey.includes("-identity-") || a.logicalKey.includes("-application-"));
  expect(details.map(a => ({ url: a.requestedUrl, capturedAt: a.capturedAt, body: a.body }))).toEqual(c.completed);
  expect(details.map(a => a.logicalKey)).toEqual([...Array.from({ length: 49 }, (_, i) => [key("identity", i + 1), key("application", i + 1)]).flat(), key("identity", 0), key("application", 0)]);
  expect(details.every(a => a.id === a.logicalKey)).toBe(true);
  const report = evidence.artifacts.at(-1)!;
  expect(report.capturedAt).toBe(c.completed.at(-1)!.capturedAt);
  expect(JSON.parse(String(report.body)).bindings.map((b: { reqId: string }) => b.reqId)).toEqual(c.fixture.rows.map(row => row.req));
  expect(validateStrictAmgenManualWorkdayEvidence(p, evidence, result.jobs)).toBe(true);
  const mutations = [
    (e: typeof evidence) => { e.artifacts.at(-1)!.capturedAt = e.artifacts.find(a => a.logicalKey === key("application", 49))!.capturedAt; },
    (e: typeof evidence) => { e.artifacts.find(a => a.logicalKey === key("identity", 0))!.capturedAt = AMGEN_TIME; },
    (e: typeof evidence) => { e.artifacts.find(a => a.logicalKey === key("application", 0))!.capturedAt = new Date(Date.parse(e.artifacts[0]!.capturedAt) + 600_001).toISOString(); e.artifacts.at(-1)!.capturedAt = e.artifacts.at(-2)!.capturedAt; },
    (e: typeof evidence) => { const a = e.artifacts.find(a => a.logicalKey === key("identity", 1))!, b = e.artifacts.find(a => a.logicalKey === key("application", 1))!; [a.capturedAt, b.capturedAt] = [b.capturedAt, a.capturedAt]; e.artifacts.splice(e.artifacts.indexOf(a), 2, b, a); },
    (e: typeof evidence) => { const start = e.artifacts.findIndex(a => a.logicalKey === key("identity", 1)), times = e.artifacts.slice(start, start + 6).map(a => a.capturedAt);
      const impossible = [1, 2, 3].map(i => e.artifacts.find(a => a.logicalKey === key("identity", i))!).concat([1, 2, 3].map(i => e.artifacts.find(a => a.logicalKey === key("application", i))!));
      impossible.forEach((a, i) => { a.capturedAt = times[i]!; }); e.artifacts.splice(start, 6, ...impossible); },
    (e: typeof evidence) => { e.artifacts.splice(e.artifacts.findIndex(a => a.logicalKey === key("identity", 0)), 1); },
    (e: typeof evidence) => { e.artifacts.splice(8, 0, e.artifacts[8]!); }
  ];
  for (const mutate of mutations) { const changed = structuredClone(evidence); mutate(changed); expect(validateStrictAmgenManualWorkdayEvidence(p, changed, result.jobs)).toBe(false); }
});

it("binds same-title same-city jobs by the Req read from each native detail before issuing its Workday request", async () => {
  const c = controlled(2, body => body.replaceAll("Representative Shanghai 0", "Representative Shanghai").replaceAll("Representative Shanghai 1", "Representative Shanghai"));
  const work = runSourceCrawl(plan(), { fetch: createAmgenManualWorkdaySourceFetch({ http: c.http, now }) });
  await c.ready();
  const [first, second] = c.fixture.rows;
  await c.release(second!.url);
  expect(c.started).toContain(second!.apiUrl); expect(c.started).not.toContain(first!.apiUrl);
  await c.release(second!.apiUrl);
  await c.release(first!.url); await c.release(first!.apiUrl);
  const result = await work;
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs.map(j => j.officialTitle)).toEqual(["Representative Shanghai", "Representative Shanghai"]);
  expect(result.jobs.map(j => j.sourceJobId)).toEqual(c.fixture.rows.map(row => row.sourceJobId));
});

it("accepts legal two-chain interleaving when all responses share the same captured millisecond", async () => {
  const fixture = amgenManualWorkdayFixture(4), p = plan();
  const result = await runSourceCrawl(p, { fetch: createAmgenManualWorkdaySourceFetch({ http: fixture.http, now }) });
  expect(result.status).toBe("SUCCESS");
  const evidence = result.fetchEvidence!;
  const details = evidence.artifacts.filter(a => a.logicalKey.includes("-identity-") || a.logicalKey.includes("-application-"));
  expect(details.slice(0, 4).map(a => a.logicalKey)).toEqual([key("identity", 0), key("identity", 1), key("application", 0), key("application", 1)]);
  expect(evidence.artifacts.every(a => a.capturedAt === AMGEN_TIME)).toBe(true);
  expect(validateStrictAmgenManualWorkdayEvidence(p, evidence, result.jobs)).toBe(true);
});

it.each(["403", "certificate", "UNKNOWN", "429", "identity", "application"])("stops new chains after %s failure and waits for the in-flight peer", async failure => {
  const c = controlled(5);
  let settled = false;
  const work = Promise.resolve(createAmgenManualWorkdaySourceFetch({ http: c.http, now })(plan())).then(result => { settled = true; return result; });
  await c.ready();
  const [first, second, third] = c.fixture.rows;
  if (failure === "certificate" || failure === "UNKNOWN") await c.reject(first!.url, Error(failure));
  else if (failure === "application") { await c.release(first!.url); await c.release(first!.apiUrl, { body: JSON.stringify({ userAuthenticated: false, jobPostingInfo: { ...first!.info, canApply: false } }) }); }
  else await c.release(first!.url, failure === "identity" ? { body: first!.detail.replace(first!.req, "R-999999") } : { status: Number(failure) });
  expect(settled).toBe(false);
  expect(c.pending.has(second!.url)).toBe(true);
  expect(c.started).not.toContain(third!.url);
  await c.release(second!.url);
  const result = await work;
  expect(result.ok).toBe(false); expect(c.pending.size).toBe(0);
  expect(c.started).not.toContain(second!.apiUrl);
  expect(c.started).not.toContain(third!.url);
  expect(c.started.filter(url => url === first!.url)).toHaveLength(1);
});

it("drains an already-running Workday request after peer failure before returning the failure", async () => {
  const c = controlled(4); let settled = false;
  const work = Promise.resolve(createAmgenManualWorkdaySourceFetch({ http: c.http, now })(plan())).then(result => { settled = true; return result; });
  await c.ready();
  const [first, second, third] = c.fixture.rows;
  await c.release(second!.url);
  expect(c.pending.has(second!.apiUrl)).toBe(true);
  await c.reject(first!.url, Error("UNKNOWN"));
  expect(settled).toBe(false); expect(c.started).not.toContain(third!.url);
  await c.release(second!.apiUrl);
  expect((await work).ok).toBe(false); expect(c.pending.size).toBe(0);
  expect(c.started).not.toContain(third!.url);
});

it("rejects duplicate native Req identities racing between workers", async () => {
  const c = controlled(3);
  const work = createAmgenManualWorkdaySourceFetch({ http: c.http, now })(plan());
  await c.ready();
  const [first, second, third] = c.fixture.rows;
  await c.release(first!.url);
  await c.release(second!.url, { body: second!.detail.replace(`"identifier":"${second!.req}"`, `"identifier":"${first!.req}"`) });
  expect(c.started).not.toContain(second!.apiUrl);
  await c.release(first!.apiUrl);
  expect((await work).ok).toBe(false); expect(c.started).not.toContain(third!.url); expect(c.pending.size).toBe(0);
});

it.each([600_000, 600_001])("keeps the exact ten-minute capture boundary at %s ms despite row completion reordering", async elapsed => {
  const c = controlled(2);
  const work = createAmgenManualWorkdaySourceFetch({ http: c.http, now })(plan());
  await c.ready();
  const [first, second] = c.fixture.rows;
  await c.release(second!.url); await c.release(second!.apiUrl); await c.release(first!.url);
  // The first list response is stamped base + 1 ms.
  await c.release(first!.apiUrl, { capturedAt: new Date(Date.parse(AMGEN_TIME) + 1 + elapsed).toISOString() });
  expect((await work).ok).toBe(elapsed === 600_000); expect(c.pending.size).toBe(0);
});
