import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePublicJsonResponse } from "../../src/server/publicResponseEncoding";
import type { PublicApiResponse } from "../../src/server/publicApi";

const json = { companies: [{ companyName: "药企", jobs: [{ title: "销售职位 🌏", location: "上海" }] }] };
const plain = Buffer.from(JSON.stringify(json));
const request = { method: "GET", path: "/api/search", headers: { "accept-encoding": "gzip" } };
const result: PublicApiResponse = { status: 200, headers: { "x-robots-tag": "noindex, nofollow" }, body: json };

describe("public JSON content negotiation", () => {
  it.each([
    "gzip", "br, gzip, deflate", "GZip ; Q=0.5", "gzip;q=0.001", "*", "br;q=1, *;q=0.2",
    "gzip;q=0.8, identity;q=0.5", "gzip;q=0.5, identity;q=0.5", "gzip, identity;q=0", "x-gzip"
  ])("sends lossless gzip when accepted by %s", async (acceptEncoding) => {
    const encoded = await encodePublicJsonResponse({ ...request, headers: { "accept-encoding": acceptEncoding } }, result);
    expect(encoded.headers).toMatchObject({ "content-encoding": "gzip", vary: "Accept-Encoding", "x-robots-tag": "noindex, nofollow", "content-type": "application/json; charset=utf-8" });
    expect(encoded.headers["content-length"]).toBe(String((encoded.body as Buffer).length));
    expect(gunzipSync(encoded.body as Buffer)).toEqual(plain);
    expect(result.body).toEqual(json);
    expect(result.headers).toEqual({ "x-robots-tag": "noindex, nofollow" });
  });

  it.each([
    undefined, "", "identity", "br", "deflate", "gzip;q=0", "gzip;q=0.000, *;q=1",
    "gzip;q=0.5, identity;q=1", "gzip;q=0, gzip;q=1", "gzip;q=2", "gzip;q=bogus", "gzip;q=0.0001"
  ])("retains identical identity bytes for %s", async (acceptEncoding) => {
    const encoded = await encodePublicJsonResponse({ ...request, headers: { "accept-encoding": acceptEncoding } }, result);
    expect(encoded.status).toBe(200);
    expect(encoded.headers["content-encoding"]).toBeUndefined();
    expect(encoded.headers.vary).toBe("Accept-Encoding");
    expect(encoded.headers["content-length"]).toBe(String(plain.length));
    expect(encoded.body).toEqual(plain);
  });

  it.each(["*;q=0", "br, identity;q=0", "gzip;q=0, identity;q=0"]) ("returns an empty 406 if both available representations are refused by %s", async (acceptEncoding) => {
    const encoded = await encodePublicJsonResponse({ ...request, headers: { "accept-encoding": acceptEncoding } }, result);
    expect(encoded).toMatchObject({ status: 406, headers: { vary: "Accept-Encoding", "content-length": "0" }, body: Buffer.alloc(0) });
    expect(encoded.headers["content-encoding"]).toBeUndefined();
  });

  it.each([
    ["Origin", "Origin, Accept-Encoding"], ["Origin, accept-ENCODING", "Origin, accept-ENCODING"], ["*", "*"]
  ])("merges existing Vary %s without losing fields or adding duplicates", async (vary, expected) => {
    for (const acceptEncoding of ["gzip", "identity"]) {
      const encoded = await encodePublicJsonResponse({ ...request, headers: { "accept-encoding": acceptEncoding } }, { ...result, headers: { Vary: vary!, "Content-Length": "9999" } });
      expect(encoded.headers.vary).toBe(expected);
      expect(encoded.headers["content-length"]).toBe(String((encoded.body as Buffer).length));
    }
  });

  it.each(["POST", "HEAD", "PUT"])("leaves %s responses untouched", async (method) => {
    expect(await encodePublicJsonResponse({ ...request, method }, result)).toBe(result);
  });

  it.each(["/api/feedback", "/api/recommend-company", "/admin/api/dashboard", "/admin/api/login", "/api/search/", "/healthz", "/privacy"])("leaves %s outside the compression whitelist", async (path) => {
    expect(await encodePublicJsonResponse({ ...request, path }, result)).toBe(result);
  });

  it.each([204, 206, 301, 400, 401, 403, 404, 429, 500])("preserves status %s responses untouched", async (status) => {
    const response = { ...result, status };
    expect(await encodePublicJsonResponse(request, response)).toBe(response);
  });

  it.each([
    { "Content-Type": "text/plain" }, { "Content-Encoding": "br" }, { "Set-Cookie": "session=private" }
  ])("does not encode non-JSON, pre-encoded, or session-setting responses: %j", async (headers) => {
    const response: PublicApiResponse = { ...result, headers };
    expect(await encodePublicJsonResponse(request, response)).toBe(response);
  });

  it("retains existing JSON text byte-for-byte, including whitespace", async () => {
    const body = '{ "name": "药企" }\n';
    const encoded = await encodePublicJsonResponse(request, { ...result, headers: { "content-type": "application/json; charset=utf-8" }, body });
    expect(gunzipSync(encoded.body as Buffer)).toEqual(Buffer.from(body));
  });
});
