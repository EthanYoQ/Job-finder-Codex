import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

interface StaticResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Encode a static file without retaining file bytes or request state. */
export async function encodeStaticResponse(
  request: { method: string; headers: Record<string, string | undefined> },
  relativePath: string,
  content: Buffer
): Promise<StaticResponse> {
  const compressible = /\.(?:js|css)$/.test(relativePath);
  const encoding = negotiateEncoding(request.headers["accept-encoding"], compressible);
  if (encoding === undefined) {
    return { status: 406, headers: { vary: "Accept-Encoding", "cache-control": "no-cache", "content-length": "0" }, body: Buffer.alloc(0) };
  }

  const digest = createHash("sha256").update(content).digest("hex");
  // Vite owns this output directory and emits an eight-character content hash.
  // Public fonts only qualify when their hex filename matches the actual bytes.
  const viteAsset = /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|png|webp|svg|ico|woff2)$/.test(relativePath);
  const fontHash = /^fonts\/([a-f0-9]{20,64})\.woff2$/.exec(relativePath)?.[1];
  const immutable = viteAsset || (fontHash !== undefined && digest.startsWith(fontHash));
  // A weak validator intentionally identifies equivalent identity/gzip content.
  const etag = `W/"${digest}"`;
  const headers: Record<string, string> = {
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    etag,
    vary: "Accept-Encoding"
  };
  if (encoding === "gzip") headers["content-encoding"] = "gzip";

  const condition = request.headers["if-none-match"];
  if (condition?.trim() === "*" || condition?.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag.slice(2))) {
    return { status: 304, headers, body: Buffer.alloc(0) };
  }

  const body = encoding === "gzip" ? await gzipAsync(content) : content;
  headers["content-length"] = String(body.length);
  return { status: 200, headers, body: request.method === "HEAD" ? Buffer.alloc(0) : body };
}

function negotiateEncoding(value: string | undefined, allowGzip: boolean): "gzip" | "identity" | undefined {
  if (value === undefined || value.trim() === "") return "identity";

  const qualities = new Map<string, number>();
  for (const entry of value.split(",")) {
    const [token, ...parameters] = entry.trim().toLowerCase().split(";");
    const coding = token?.trim() === "x-gzip" ? "gzip" : token?.trim();
    if (coding !== "gzip" && coding !== "identity" && coding !== "*") continue;
    const weight = parameters.length === 0 ? undefined : parameters.join(";").trim().match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
    const quality = parameters.length === 0 ? 1 : weight ? Number(weight[1]) : 0;
    // Duplicates and malformed weights must not override an explicit refusal.
    qualities.set(coding, Math.min(qualities.get(coding) ?? 1, quality));
  }

  const gzipQuality = allowGzip ? qualities.get("gzip") ?? qualities.get("*") ?? 0 : 0;
  const identityQuality = qualities.get("identity") ?? (qualities.get("*") === 0 ? 0 : 1);
  if (gzipQuality > 0 && (qualities.get("identity") === undefined || gzipQuality >= identityQuality)) return "gzip";
  return identityQuality > 0 ? "identity" : undefined;
}
