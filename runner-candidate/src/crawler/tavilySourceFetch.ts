import type { SourceFetchFunction } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  extractOfficialSourceWithTavily,
  type TavilyExtractDeps
} from "./tavily";

export interface TavilySourceFetchDeps extends TavilyExtractDeps {
  now?: () => Date;
}

export function createTavilySourceFetch(deps: TavilySourceFetchDeps): SourceFetchFunction {
  return async (plan) => fetchSourcePlan(plan, deps);
}

async function fetchSourcePlan(
  plan: SourceCrawlPlan,
  deps: TavilySourceFetchDeps
) {
  const capturedAt = (deps.now ?? (() => new Date()))().toISOString();
  const officialEntryUrl = plan.source.officialEntryUrl;

  try {
    const result = await extractOfficialSourceWithTavily(
      {
        urls: [officialEntryUrl],
        query: `${plan.company.officialChineseName} 社会招聘 职位`,
        extractDepth: "advanced",
        chunksPerSource: 3
      },
      deps
    );

    const rawContent = result.results.find((item) => item.url === officialEntryUrl)?.rawContent;
    const normalizedContent = rawContent?.trim();
    if (rawContent === undefined || !normalizedContent) {
      return {
        ok: false,
        capturedAt,
        failureReason: `Tavily returned no content for ${officialEntryUrl}`
      } as const;
    }

    if (plan.adapterId === "official-json") {
      const payload = parseJsonContent(normalizedContent);
      if (payload === undefined) {
        return {
          ok: false,
          capturedAt,
          failureReason: `Tavily returned invalid JSON content for ${officialEntryUrl}`
        } as const;
      }

      return {
        ok: true,
        capturedAt,
        payload
      } as const;
    }

    return {
      ok: true,
      capturedAt,
      html: rawContent
    } as const;
  } catch (error) {
    return {
      ok: false,
      capturedAt,
      failureReason: error instanceof Error ? error.message : String(error)
    } as const;
  }
}

function parseJsonContent(rawContent: string): unknown | undefined {
  const normalized = unwrapJsonFence(rawContent);
  try {
    return JSON.parse(normalized);
  } catch {
    return undefined;
  }
}

function unwrapJsonFence(rawContent: string): string {
  const fencedMatch = rawContent.match(/^```json\s*([\s\S]*?)\s*```$/i);
  if (!fencedMatch) {
    return rawContent;
  }

  return fencedMatch[1] ?? rawContent;
}
