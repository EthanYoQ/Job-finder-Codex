import { createHash } from "node:crypto";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officialHttpRequestDiagnostics } from "../../src/crawler/officialHttpRequestDiagnostics";
import { fetchWithOfficialTimeout } from "../../src/crawler/officialHttpRuntimeLimits";

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }));
});
function diagnostics() {
  const directory = mkdtempSync(join(tmpdir(), "official-http-error-test-"));
  directories.push(directory);
  const path = join(directory, "requests.jsonl");
  vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", path);
  return { raw: () => readFileSync(path, "utf8"),
    read: () => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) };
}

describe("bounded official HTTP failure diagnostics (no network)", () => {
  it("strips BI signed queries before telemetry without changing the request", async () => {
    const log = diagnostics(), url = "https://coapi.51job.com/job_list.php?sign=synthetic&key=1&params=test";
    let requested: unknown;
    await fetchWithOfficialTimeout(url, {}, { fetchImpl: async input => {
      requested = input; return new Response("ok", { status: 200 });
    } });
    expect(requested).toBe(url);
    expect(log.read()[0].url).toMatchObject({ hasQuery: false,
      requestUrlSha256: createHash("sha256").update("https://coapi.51job.com/job_list.php").digest("hex") });
    expect(log.raw()).not.toContain(createHash("sha256").update(url).digest("hex"));
    expect(log.raw()).not.toContain("synthetic");
  });

  it("records a nested network cause and preserves the exact original fetch error", async () => {
    const log = diagnostics();
    const reason = new TypeError("fetch failed SECRET", {
      cause: new Error("wrapper SECRET", { cause: Object.assign(new Error("socket SECRET"), { code: "ECONNRESET" }) })
    });
    await expect(fetchWithOfficialTimeout("https://jobs.example.test/path?token=SECRET", {}, {
      fetchImpl: async () => { throw reason; }
    })).rejects.toBe(reason);
    expect(log.read().at(-1)).toMatchObject({ event: "REQUEST_FAILED", errorName: "TypeError", causeCode: "ECONNRESET" });
    expect(log.raw()).not.toContain("SECRET");
    expect(log.raw()).not.toContain("stack");
    expect(log.raw()).not.toContain("message");
  });

  it.each([
    "EAI_AGAIN", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH",
    "ENOTFOUND", "ETIMEDOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "ABORT_ERR"
  ])("records the explicit safe code %s", (code) => {
    const log = diagnostics();
    officialHttpRequestDiagnostics("https://jobs.example.test", 1000)!("BODY_FAILED", {
      error: Object.assign(new Error("private"), { code }), failureKind: "TRANSPORT_OR_BODY_ERROR"
    });
    expect(log.read()[0]).toMatchObject({ errorName: "Error", errorCode: code });
  });

  it("omits arbitrary names and token-like codes at every inspected level", () => {
    const log = diagnostics(), secret = "ECONNRESET_SECRET_TOKEN";
    officialHttpRequestDiagnostics("https://jobs.example.test", 1000)!("REQUEST_FAILED", {
      error: { name: secret, code: secret, message: secret, stack: secret,
        cause: { name: secret, code: secret, message: secret, cause: { code: "ENOTFOUND" } } }
    });
    expect(log.read()[0]).toMatchObject({ causeCode: "ENOTFOUND" });
    expect(log.read()[0]).not.toHaveProperty("errorName");
    expect(log.read()[0]).not.toHaveProperty("errorCode");
    expect(log.raw()).not.toContain(secret);
  });

  it("does not invoke arbitrary accessors and preserves hostile thrown objects", async () => {
    const log = diagnostics(), getter = vi.fn(() => { throw new Error("SECRET"); });
    const reason = Object.defineProperties({}, {
      name: { get: getter }, code: { get: getter }, cause: { get: getter },
      message: { get: getter }, stack: { get: getter }, toJSON: { get: getter }
    });
    await expect(fetchWithOfficialTimeout("https://jobs.example.test", {}, {
      fetchImpl: async () => { throw reason; }
    })).rejects.toBe(reason);
    expect(getter).not.toHaveBeenCalled();
    expect(log.read().at(-1)).toMatchObject({ event: "REQUEST_FAILED" });
    expect(log.raw()).not.toContain("SECRET");
  });

  it("stops at cycles and bounds causes to four levels below the thrown error", () => {
    const log = diagnostics(), cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    const write = officialHttpRequestDiagnostics("https://jobs.example.test", 1000)!;
    write("BODY_FAILED", { error: cycle });
    let deep: unknown = { code: "ECONNRESET" };
    for (let i = 0; i < 5; i += 1) deep = { cause: deep };
    write("BODY_FAILED", { error: deep });
    const boundary = { cause: { cause: { cause: { cause: { code: "ENOTFOUND" } } } } };
    write("BODY_FAILED", { error: boundary });
    expect(log.read()[0]).not.toHaveProperty("causeCode");
    expect(log.read()[1]).not.toHaveProperty("causeCode");
    expect(log.read()[2]).toHaveProperty("causeCode", "ENOTFOUND");
  });

  it("survives throwing proxy traps and never serializes the error", async () => {
    const log = diagnostics();
    const reason = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("SECRET"); } });
    await expect(fetchWithOfficialTimeout("https://jobs.example.test", {}, {
      fetchImpl: async () => { throw reason; }
    })).rejects.toBe(reason);
    expect(log.read().at(-1)).toMatchObject({ event: "REQUEST_FAILED" });
    expect(log.raw()).not.toContain("SECRET");
  });
});
