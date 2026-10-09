import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRuntimeExposureReceipt } from "../src/security/runtimeExposureQualification";

const [rawPath, trivyPath, imageDigest, outputPath] = process.argv.slice(2);
if (!rawPath || !trivyPath || !imageDigest || !outputPath) {
  throw new Error("Usage: bind-runtime-exposure-report <raw> <trivy> <image-digest> <output>");
}
const receipt = createRuntimeExposureReceipt(await readFile(rawPath), await readFile(trivyPath), imageDigest);
await mkdir(dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rename(temporary, outputPath);
