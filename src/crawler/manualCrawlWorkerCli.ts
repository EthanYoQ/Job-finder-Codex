export type ManualCrawlWorkerOptions = {
  help: boolean;
  stopWhenIdle: boolean;
};

export function parseManualCrawlWorkerArgs(args: readonly string[]): ManualCrawlWorkerOptions {
  let stopWhenIdle = false;
  for (const argument of args) {
    if (argument === "--help") return { help: true, stopWhenIdle: false };
    if (argument === "--once") {
      stopWhenIdle = true;
      continue;
    }
    throw new Error("Unknown manual crawl worker argument");
  }
  return { help: false, stopWhenIdle };
}
