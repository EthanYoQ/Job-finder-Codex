import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export type OfficialJsonFetchConfig =
  | {
      kind: "innovent";
      endpointUrl: string;
    }
  | {
      kind: "novo-nordisk";
      endpointUrl: string;
    }
  | {
      kind: "phenom";
      detailBaseUrl: string;
    };

export interface OfficialJsonHttpRequest {
  url: string;
  headers: Record<string, string>;
}

export interface OfficialJsonHttpResponse {
  status: number;
  body: string;
}

export type OfficialJsonHttpClient = (
  request: OfficialJsonHttpRequest
) => Promise<OfficialJsonHttpResponse>;

export interface OfficialJsonSourceFetchDeps {
  http?: OfficialJsonHttpClient;
  now?: () => Date;
}

interface NormalizedOfficialJsonJob {
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

const CITY_MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"],
  ["Beijing", "北京"],
  ["Suzhou", "苏州"],
  ["Dongguan", "东莞"],
  ["Shenzhen", "深圳"],
  ["Guangzhou", "广州"],
  ["Hangzhou", "杭州"],
  ["Nanjing", "南京"],
  ["Wuhan", "武汉"],
  ["Chengdu", "成都"],
  ["Tianjin", "天津"],
  ["Lanzhou", "兰州"],
  ["上海", "上海"],
  ["北京", "北京"],
  ["苏州", "苏州"],
  ["东莞", "东莞"],
  ["深圳", "深圳"],
  ["广州", "广州"],
  ["杭州", "杭州"],
  ["南京", "南京"],
  ["武汉", "武汉"],
  ["成都", "成都"],
  ["天津", "天津"],
  ["兰州", "兰州"]
];

export function createOfficialJsonSourceFetch(
  deps: OfficialJsonSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.adapterId !== "official-json" || !plan.officialJsonFetch) {
      return failed(capturedAt, `Official JSON source ${plan.source.id} is missing fetch config`);
    }

    try {
      const http = deps.http ?? defaultHttpClient;
      const url =
        plan.officialJsonFetch.kind === "phenom"
          ? plan.source.officialEntryUrl
          : plan.officialJsonFetch.endpointUrl;
      const response = await http({
        url,
        headers: {
          Accept: "application/json,text/html",
          "User-Agent": "job-search-crawler/0.1"
        }
      });

      if (response.status < 200 || response.status >= 300) {
        return failed(capturedAt, `Official JSON source returned HTTP ${response.status}`);
      }

      return {
        ok: true,
        capturedAt,
        payload: { jobs: normalizePayload(plan.officialJsonFetch, response.body) }
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

function normalizePayload(
  config: OfficialJsonFetchConfig,
  body: string
): NormalizedOfficialJsonJob[] {
  if (config.kind === "innovent") {
    const parsed = JSON.parse(body) as { data?: unknown };
    const jobs = Array.isArray(parsed.data) ? parsed.data : [];
    return jobs.flatMap((job) => {
      if (!isObject(job)) {
        return [];
      }

      const id = stringValue(job.id);
      const title = stringValue(job.title);
      const locationRaw = stringValue(job.city);
      if (!id || !title || !locationRaw) {
        return [];
      }

      return [
        {
          sourceJobId: id,
          title,
          officialUrl: `https://www.innoventbio.com/cn/recruit/${id}`,
          locationRaw,
          cities: citiesFromLocation(locationRaw)
        }
      ];
    });
  }

  if (config.kind === "novo-nordisk") {
    const parsed = JSON.parse(body) as { data?: { jobs?: unknown } };
    const jobs = Array.isArray(parsed.data?.jobs) ? parsed.data.jobs : [];
    return jobs.flatMap((job) => {
      if (!isObject(job)) {
        return [];
      }

      const sourceJobId = stringValue(job.jobId);
      const title = stringValue(job.jobTitle);
      const locationRaw = stringValue(job.jobLocationLabel);
      const city = isObject(job.jobCity) ? stringValue(job.jobCity.label) : undefined;
      if (!sourceJobId || !title || !locationRaw) {
        return [];
      }

      return [
        {
          sourceJobId,
          title,
          officialUrl: `https://www.novonordisk.com/careers/find-a-job/job-ad.${sourceJobId}.html`,
          locationRaw,
          cities: citiesFromLocation(city ?? locationRaw)
        }
      ];
    });
  }

  const phenom = extractPhenomRefineSearch(body);
  const jobs = Array.isArray(phenom.data?.jobs) ? phenom.data.jobs : [];
  return jobs.flatMap((job) => normalizePhenomJob(config, job));
}

function normalizePhenomJob(
  config: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>,
  job: unknown
): NormalizedOfficialJsonJob[] {
  if (!isObject(job)) {
    return [];
  }

  const country = stringValue(job.country);
  const locationRaw = stringValue(job.location);
  if (country !== "China" && !locationRaw?.includes("China")) {
    return [];
  }

  const sourceJobId = stringValue(job.jobSeqNo) ?? stringValue(job.reqId);
  const title = stringValue(job.title);
  if (!sourceJobId || !title || !locationRaw) {
    return [];
  }

  const applyUrl = stringValue(job.applyUrl);
  return [
    {
      sourceJobId,
      title,
      officialUrl: applyUrl || `${config.detailBaseUrl}/${sourceJobId}`,
      locationRaw,
      cities: citiesFromLocation(locationRaw)
    }
  ];
}

function extractPhenomRefineSearch(body: string): { data?: { jobs?: unknown } } {
  const marker = '"eagerLoadRefineSearch":';
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) {
    return {};
  }

  const start = body.indexOf("{", markerIndex + marker.length);
  if (start < 0) {
    return {};
  }

  const json = balancedJsonObject(body, start);
  return json ? (JSON.parse(json) as { data?: { jobs?: unknown } }) : {};
}

function balancedJsonObject(input: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

async function defaultHttpClient(request: OfficialJsonHttpRequest): Promise<OfficialJsonHttpResponse> {
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: "follow"
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

function citiesFromLocation(locationRaw: string): string[] {
  const lowerLocation = locationRaw.toLowerCase();
  const cities = CITY_MATCHES.flatMap(([needle, city]) =>
    lowerLocation.includes(needle.toLowerCase()) ? [city] : []
  );

  return [...new Set(cities)];
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
