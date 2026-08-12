import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function bindNpmAuditReport(reportPath: string, packageLockPath: string, outputPath: string): Promise<void> {
  const [reportBytes, lockBytes] = await Promise.all([readFile(reportPath), readFile(packageLockPath)]);
  let report: unknown;
  try { report = JSON.parse(reportBytes.toString("utf8")) as unknown; }
  catch { throw new Error("npm audit report is not valid JSON"); }
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    throw new Error("npm audit report is invalid");
  }
  const bound = {
    schemaVersion: 1,
    npmAuditSha256: createHash("sha256").update(reportBytes).digest("hex"),
    packageLockSha256: createHash("sha256").update(lockBytes).digest("hex")
  };
  const target = resolve(outputPath), temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(bound)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function main(): Promise<void> {
  const [reportPath, packageLockPath, outputPath] = process.argv.slice(2);
  if (!reportPath || !packageLockPath || !outputPath) throw new Error("Usage: bind-npm-audit-report <report> <package-lock> <identity-output>");
  await bindNpmAuditReport(reportPath, packageLockPath, outputPath);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { console.error(error instanceof Error ? error.message : "Binding failed"); process.exitCode = 1; });
}
