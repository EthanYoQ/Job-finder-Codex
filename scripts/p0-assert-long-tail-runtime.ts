import { readFile } from "node:fs/promises";
import { assertLongTailRuntimeSettled } from "../src/crawler/exactSourceDiagnostic";

async function main(): Promise<void> {
  const [reportPath, telemetryPath] = process.argv.slice(2);
  if (!reportPath || !telemetryPath || process.argv.length !== 4) {
    throw new Error("Expected report and telemetry paths");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const telemetryText = await readFile(telemetryPath, "utf8");
  const telemetry = telemetryText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assertLongTailRuntimeSettled({ report, telemetry });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Long-tail runtime validation failed");
  process.exitCode = 1;
});
