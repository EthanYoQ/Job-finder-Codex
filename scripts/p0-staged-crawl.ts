const args = process.argv.slice(2);
const { parseStagedCrawlArgs, runProductionStagedCrawlCli } = await import("../src/crawler/stagedCrawlCli");
let options: ReturnType<typeof parseStagedCrawlArgs>;
try {
  options = parseStagedCrawlArgs(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

try {
  process.exitCode = await runProductionStagedCrawlCli(process.env, options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
