// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { fetchWithOfficialTimeout } from "../../src/crawler/officialHttpRuntimeLimits";
import { fetchWorkdayMainlandHttp } from "../../src/crawler/workdayMainlandQuality";
vi.mock("../../src/crawler/officialHttpRuntimeLimits", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/crawler/officialHttpRuntimeLimits")>(), fetchWithOfficialTimeout: vi.fn()
}));
afterEach(() => { vi.clearAllMocks(); });

it.each([
  ["5", { value: "5", delayMs: 5_000 }],
  ["60", { value: "60", delayMs: 60_000 }],
  ["untrusted value", { invalid: true }],
  [null, undefined]
])("retains bounded Retry-After metadata from the actual response headers: %s", async (header, expected) => {
  const response = new Response("upstream gateway body", { status: 502, headers: { "content-type": "text/html", ...(header === null ? {} : { "retry-after": header as string }) } });
  vi.mocked(fetchWithOfficialTimeout).mockResolvedValue(response);
  const result = await fetchWorkdayMainlandHttp({ method: "GET", url: "https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/Careers/job/China---Shanghai/Role_R-10001", headers: { Accept: "application/json" } });
  expect(result).toMatchObject({ status: 502, body: "upstream gateway body", contentType: "text/html" });
  expect(result.retryAfter).toEqual(expected);
  expect(fetchWithOfficialTimeout).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchWithOfficialTimeout).mock.calls[0]![1]).toMatchObject({ method: "GET", redirect: "error" });
});
