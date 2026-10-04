import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { PublicApiRequest, PublicApiResponse } from "./publicApi";
import type { SnapshotReadTiming } from "../db/portablePublicSnapshotRepository";

const gzipAsync = promisify(gzip);

// Only these full, public JSON representations participate in compression.
export async function encodePublicJsonResponse(
  request: Pick<PublicApiRequest, "method" | "path" | "headers">,
  result: PublicApiResponse,
  recordTiming?: SnapshotReadTiming
): Promise<PublicApiResponse> {
  if (request.method !== "GET" || result.status !== 200 ||
      (request.path !== "/api/search" && request.path !== "/api/coverage")) return result;

  const headers = Object.fromEntries(Object.entries(result.headers).map(([name, value]) => [name.toLowerCase(), value]));
  if (headers["content-encoding"] !== undefined || headers["set-cookie"] !== undefined ||
      (typeof result.body === "string" && headers["content-type"] === undefined) ||
      (headers["content-type"] !== undefined && headers["content-type"].split(";")[0]?.trim().toLowerCase() !== "application/json")) return result;

  const jsonStartedAt = performance.now();
  const json = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
  if (json === undefined) return result;

  const vary = (headers.vary ?? "").split(",").map((field) => field.trim()).filter(Boolean);
  if (!vary.some((field) => field === "*" || field.toLowerCase() === "accept-encoding")) vary.push("Accept-Encoding");
  headers.vary = vary.join(", ");
  headers["content-type"] ??= "application/json; charset=utf-8";

  const encoding = negotiateEncoding(request.headers["accept-encoding"]);
  // Neither representation is acceptable; never send a coding explicitly refused by the client.
  if (encoding === undefined) return { status: 406, headers: { ...headers, "content-length": "0" }, body: Buffer.alloc(0) };

  const plain = Buffer.from(json, "utf8");
  recordTiming?.("JSON", performance.now() - jsonStartedAt);
  const gzipStartedAt = performance.now();
  const body = encoding === "gzip" ? await gzipAsync(plain, { level: 1 }) : plain;
  if (encoding === "gzip") recordTiming?.("gzip", performance.now() - gzipStartedAt);
  if (encoding === "gzip") headers["content-encoding"] = "gzip";
  headers["content-length"] = String(body.length);
  return { ...result, headers, body };
}

function negotiateEncoding(value: string | undefined): "gzip" | "identity" | undefined {
  // Preserve the existing identity response for clients that do not request compression.
  if (value === undefined || value.trim() === "") return "identity";

  const qualities = new Map<string, number>();
  for (const entry of value.split(",")) {
    const [token, ...parameters] = entry.trim().toLowerCase().split(";");
    const coding = token?.trim() === "x-gzip" ? "gzip" : token?.trim();
    if (coding !== "gzip" && coding !== "identity" && coding !== "*") continue;
    const weight = parameters.length === 0 ? undefined : parameters.join(";").trim().match(/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
    const quality = parameters.length === 0 ? 1 : weight ? Number(weight[1]) : 0;
    // Ambiguous duplicates and malformed weights must not override an explicit refusal.
    qualities.set(coding, Math.min(qualities.get(coding) ?? 1, quality));
  }

  const gzipQuality = qualities.get("gzip") ?? qualities.get("*") ?? 0;
  const identityQuality = qualities.get("identity") ?? (qualities.get("*") === 0 ? 0 : 1);
  if (gzipQuality > 0 && (qualities.get("identity") === undefined || gzipQuality >= identityQuality)) return "gzip";
  return identityQuality > 0 ? "identity" : undefined;
}
