import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeStaticResponse } from "../../src/server/staticResponse";

const content = Buffer.from('console.log("职位 🌏");\n'.repeat(100));
const path = "assets/App-DZA08wpL.js";
const encode = (headers: Record<string, string | undefined> = {}, relativePath = path, method = "GET", bytes = content) =>
  encodeStaticResponse({ method, headers }, relativePath, bytes);

describe("static response encoding and revalidation", () => {
  it.each([
    "gzip", "br, gzip, deflate", "GZip ; Q=0.5", "gzip;q=0.001", "*", "br;q=1, *;q=0.2",
    "gzip;q=0.8, identity;q=0.5", "gzip;q=0.5, identity;q=0.5", "gzip, identity;q=0", "x-gzip"
  ])("sends lossless gzip when accepted by %s", async (value) => {
    const result = await encode({ "accept-encoding": value });
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ "content-encoding": "gzip", vary: "Accept-Encoding" });
    expect(result.headers["content-length"]).toBe(String(result.body.length));
    expect(result.body.length).toBeLessThan(content.length);
    expect(gunzipSync(result.body)).toEqual(content);
  });

  it.each([
    undefined, "", "identity", "br", "gzip;q=0", "gzip;q=0.000, *;q=1",
    "gzip;q=0.5, identity;q=1", "gzip;q=0, gzip;q=1", "gzip;q=2", "gzip;q=bogus", "gzip;q=0.0001"
  ])("retains identity bytes for %s", async (value) => {
    const result = await encode({ "accept-encoding": value });
    expect(result.status).toBe(200);
    expect(result.headers["content-encoding"]).toBeUndefined();
    expect(result.headers.vary).toBe("Accept-Encoding");
    expect(result.headers["content-length"]).toBe(String(content.length));
    expect(result.body).toEqual(content);
  });

  it.each(["*;q=0", "br, identity;q=0", "gzip;q=0, identity;q=0"])("returns 406 when all available codings are refused by %s", async (value) => {
    const result = await encode({ "accept-encoding": value });
    expect(result).toMatchObject({ status: 406, headers: { "cache-control": "no-cache", vary: "Accept-Encoding", "content-length": "0" } });
    expect(result.body.length).toBe(0);
    expect(result.headers.etag).toBeUndefined();
  });

  it.each(["assets/App-BLE5E0kn.css", "fonts/fonts.css"])("compresses CSS at %s", async (relativePath) => {
    expect((await encode({ "accept-encoding": "gzip" }, relativePath)).headers["content-encoding"]).toBe("gzip");
  });

  it.each(["index.html", "logo.webp", "logo.png", "fonts/008dc87bc80851a41dd5.woff2", "data.json"])("does not compress %s", async (relativePath) => {
    const result = await encode({ "accept-encoding": "gzip" }, relativePath);
    expect(result.body).toEqual(content);
    expect(result.headers["content-encoding"]).toBeUndefined();
    expect((await encode({ "accept-encoding": "gzip, identity;q=0" }, relativePath)).status).toBe(406);
  });

  it.each([path, "assets/legacyBase-5H8CoT8_.css", "assets/company-logos-CnE_ZN9O.png"])("allows immutable caching for Vite output %s", async (relativePath) => {
    expect((await encode({}, relativePath)).headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it.each([
    "index.html", "assets/index-abcdefgh.html", "assets/runtime.js", "assets/app-short.js", "assets/app-123456789.js",
    "fonts/fonts.css", "fonts/008dc87bc80851a41dd5.woff2", "font.woff2", "logo.webp", "App-DZA08wpL.js",
    "brand-logos/logo-ee95f305ade3040c.png", "brand-logos/sources.json"
  ])("requires revalidation for stable or unverified filename %s", async (relativePath) => {
    expect((await encode({}, relativePath)).headers["cache-control"]).toBe("no-cache");
  });

  it("only treats hex font names as immutable when they match the content hash", async () => {
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 20);
    expect((await encode({}, `fonts/${hash}.woff2`)).headers["cache-control"]).toContain("immutable");
    expect((await encode({}, `fonts/${hash}.woff2`, "GET", Buffer.from("changed"))).headers["cache-control"]).toBe("no-cache");
  });

  it.each(["identity", "gzip"])("returns bodyless GET and HEAD 304 responses using %s", async (coding) => {
    const first = await encode();
    const etag = first.headers.etag!;
    expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
    for (const condition of [etag, etag.slice(2), `"other", ${etag}`, "*"]) {
      for (const method of ["GET", "HEAD"]) {
        const result = await encode({ "accept-encoding": coding, "if-none-match": condition }, path, method);
        expect(result.status).toBe(304);
        expect(result.body.length).toBe(0);
        expect(result.headers).toMatchObject({ etag, vary: "Accept-Encoding", "cache-control": first.headers["cache-control"] });
        expect(result.headers["content-length"]).toBeUndefined();
      }
    }
  });

  it("returns new content after a same-length file change or nonmatching validator", async () => {
    const first = await encode();
    const changed = Buffer.from(content);
    changed[0] = 65;
    const result = await encode({ "if-none-match": first.headers.etag }, path, "GET", changed);
    expect(result.status).toBe(200);
    expect(result.headers.etag).not.toBe(first.headers.etag);
    expect(result.body).toEqual(changed);
    expect((await encode({ "if-none-match": '"other"' })).status).toBe(200);
  });

  it.each(["identity", "gzip"])("sends HEAD metadata matching the %s GET with no body", async (coding) => {
    const headers = { "accept-encoding": coding };
    const get = await encode(headers);
    const head = await encode(headers, path, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers).toEqual(get.headers);
    expect(head.body.length).toBe(0);
  });
});
