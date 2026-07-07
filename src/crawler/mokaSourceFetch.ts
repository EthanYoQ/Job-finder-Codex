import { createDecipheriv } from "node:crypto";
import { load } from "cheerio";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface MokaInitData {
  aesIv: string;
  orgId: string;
  siteId: string;
  mode: string;
}

export interface MokaEncryptedResponse {
  data: string;
  necromancer: string;
}

export interface MokaHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface MokaHttpResponse {
  status: number;
  body: string;
}

export type MokaHttpClient = (request: MokaHttpRequest) => Promise<MokaHttpResponse>;

export interface MokaSourceFetchDeps {
  http?: MokaHttpClient;
  now?: () => Date;
}

const MOKA_JOBS_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
const MOKA_PAGE_SIZE = 200;

export function createMokaSourceFetch(deps: MokaSourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.source.atsKind !== "MOKA") {
      return failed(capturedAt, "Moka source fetch only supports MOKA sources");
    }

    try {
      const http = deps.http ?? defaultMokaHttpClient;
      const page = await http({
        url: plan.source.officialEntryUrl,
        method: "GET",
        headers: { "User-Agent": "job-search-crawler/0.1" }
      });
      if (page.status < 200 || page.status >= 300) {
        return failed(capturedAt, `Moka entry page returned HTTP ${page.status}`);
      }

      const initData = extractMokaInitData(page.body);
      if (!initData) {
        return failed(capturedAt, "Moka init-data was not found or incomplete");
      }

      const api = await http({
        url: MOKA_JOBS_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Origin: new URL(plan.source.officialEntryUrl).origin,
          Referer: plan.source.officialEntryUrl,
          "User-Agent": "job-search-crawler/0.1"
        },
        body: {
          orgId: initData.orgId,
          siteId: initData.siteId,
          limit: MOKA_PAGE_SIZE,
          offset: 0,
          needStat: true,
          isCampusJob: false,
          site: initData.mode,
          locale: "zh-CN"
        }
      });
      if (api.status < 200 || api.status >= 300) {
        return failed(capturedAt, `Moka jobs API returned HTTP ${api.status}`);
      }

      const encrypted = parseEncryptedResponse(api.body);
      if (!encrypted) {
        return failed(capturedAt, "Moka jobs API returned an invalid encrypted response");
      }

      return {
        ok: true,
        capturedAt,
        payload: enrichMokaPayload(
          decryptMokaResponse(encrypted, initData.aesIv),
          plan.source.officialEntryUrl
        )
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

export function extractMokaInitData(html: string): MokaInitData | undefined {
  const $ = load(html);
  const rawValue = $("#init-data").attr("value");
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      aesIv?: unknown;
      mode?: unknown;
      siteId?: unknown;
      org?: { id?: unknown; siteId?: unknown };
    };
    const aesIv = typeof parsed.aesIv === "string" ? parsed.aesIv : undefined;
    const orgId = typeof parsed.org?.id === "string" ? parsed.org.id : undefined;
    const siteId = stringValue(parsed.siteId ?? parsed.org?.siteId);
    const mode = typeof parsed.mode === "string" ? parsed.mode : undefined;

    if (!aesIv || !orgId || !siteId || !mode) {
      return undefined;
    }

    return { aesIv, orgId, siteId, mode };
  } catch {
    return undefined;
  }
}

export function decryptMokaResponse(response: MokaEncryptedResponse, aesIv: string): unknown {
  const decipher = createDecipheriv(
    "aes-128-cbc",
    Buffer.from(response.necromancer, "utf8"),
    Buffer.from(aesIv, "utf8")
  );
  let decrypted = decipher.update(response.data, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted);
}

async function defaultMokaHttpClient(request: MokaHttpRequest): Promise<MokaHttpResponse> {
  const init: RequestInit = { method: request.method };
  if (request.headers) {
    init.headers = request.headers;
  }
  if (request.body) {
    init.body = JSON.stringify(request.body);
  }

  const response = await fetch(request.url, init);

  return {
    status: response.status,
    body: await response.text()
  };
}

function parseEncryptedResponse(body: string): MokaEncryptedResponse | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<MokaEncryptedResponse>;
    if (typeof parsed.data !== "string" || typeof parsed.necromancer !== "string") {
      return undefined;
    }

    return {
      data: parsed.data,
      necromancer: parsed.necromancer
    };
  } catch {
    return undefined;
  }
}

function enrichMokaPayload(payload: unknown, officialEntryUrl: string): unknown {
  if (!isObject(payload) || !isObject(payload.data) || !Array.isArray(payload.data.jobs)) {
    return payload;
  }

  return {
    ...payload,
    data: {
      ...payload.data,
      jobs: payload.data.jobs.map((job) => enrichMokaJob(job, officialEntryUrl))
    }
  };
}

function enrichMokaJob(job: unknown, officialEntryUrl: string): unknown {
  if (!isObject(job)) {
    return job;
  }

  const sourceJobId = stringValue(job.id);
  const cities = citiesFromMokaLocations(job.locations);

  return {
    ...job,
    ...(sourceJobId ? { officialUrl: buildMokaJobUrl(officialEntryUrl, sourceJobId) } : {}),
    ...(cities.length > 0 ? { locationRaw: cities.join("、"), cities } : {})
  };
}

function buildMokaJobUrl(officialEntryUrl: string, sourceJobId: string): string {
  const url = new URL(officialEntryUrl);
  url.hash = `/job/${sourceJobId}`;
  return url.toString();
}

function citiesFromMokaLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((location) => {
      if (!isObject(location)) {
        return undefined;
      }

      return stringValue(location.cityName ?? location.provinceName ?? location.country);
    })
    .filter((city): city is string => Boolean(city));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
