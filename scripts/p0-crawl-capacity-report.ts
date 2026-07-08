import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CrawlCapacityInput {
  sourceCount: number;
  httpSourceCount: number;
  browserSourceCount: number;
  httpConcurrency: number;
  browserConcurrency: number;
  avgHttpSeconds: number;
  avgBrowserSeconds: number;
}

export interface CrawlCapacityEstimate {
  sourceCount: number;
  estimatedOnePassSeconds: number;
  estimatedTwiceDailySeconds: number;
  notes: string[];
}

export function estimateCrawlCapacity(input: CrawlCapacityInput): CrawlCapacityEstimate {
  const httpBatches = Math.ceil(input.httpSourceCount / input.httpConcurrency);
  const browserBatches = Math.ceil(input.browserSourceCount / input.browserConcurrency);
  const estimatedOnePassSeconds =
    httpBatches * input.avgHttpSeconds + browserBatches * input.avgBrowserSeconds;

  return {
    sourceCount: input.sourceCount,
    estimatedOnePassSeconds,
    estimatedTwiceDailySeconds: estimatedOnePassSeconds * 2,
    notes: [
      `HTTP/API sources are estimated in ${httpBatches} batches at concurrency ${input.httpConcurrency}.`,
      `Browser fallback sources are estimated in ${browserBatches} batches at concurrency ${input.browserConcurrency}.`
    ]
  };
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isDirectRun) {
  const estimate = estimateCrawlCapacity({
    sourceCount: Number(process.env.P0_SOURCE_COUNT ?? 50),
    httpSourceCount: Number(process.env.P0_HTTP_SOURCE_COUNT ?? 45),
    browserSourceCount: Number(process.env.P0_BROWSER_SOURCE_COUNT ?? 5),
    httpConcurrency: Number(process.env.P0_HTTP_CONCURRENCY ?? 6),
    browserConcurrency: Number(process.env.P0_BROWSER_CONCURRENCY ?? 1),
    avgHttpSeconds: Number(process.env.P0_AVG_HTTP_SECONDS ?? 8),
    avgBrowserSeconds: Number(process.env.P0_AVG_BROWSER_SECONDS ?? 45)
  });

  console.log(JSON.stringify(estimate, null, 2));
}
