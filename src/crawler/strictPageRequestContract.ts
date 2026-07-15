import { createHash } from "node:crypto";

export interface RequestContractV2Input {
  family: "workday" | "moka" | "phenom" | "beisen" | "hcm" | "html" | "xiuzheng";
  role: string;
  method: "GET" | "POST";
  url: string;
  body: unknown;
  coordinate: unknown;
}

export function requestContractV2Locator(baseLocator: string, input: RequestContractV2Input): string {
  const serialized = JSON.stringify(canonicalRequestValue({
    v: 2,
    family: input.family,
    role: input.role,
    method: input.method,
    url: input.url,
    body: input.body,
    coordinate: input.coordinate
  }));
  const hash = createHash("sha256").update(serialized, "utf8").digest("hex");
  return `${baseLocator}|request-contract-v2|sha256:${hash}`;
}

function canonicalRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRequestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => [key, canonicalRequestValue(child)]));
  }
  return value;
}
