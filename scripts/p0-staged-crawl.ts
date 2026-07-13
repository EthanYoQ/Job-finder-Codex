const args = process.argv.slice(2);
if (args.length > 0) {
  console.error("p0:staged-crawl accepts no arguments");
  process.exit(2);
}

try {
  const { runProductionStagedCrawlCli } = await import("../src/crawler/stagedCrawlCli");
  process.exitCode = await runProductionStagedCrawlCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
