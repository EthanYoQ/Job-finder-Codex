import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildUnsignedOracleV2Migration } from "../src/crawler/independentOracleMigration";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: tsx scripts/migrate-independent-oracle-v2.ts <legacy.json> <unsigned-v2.json>");
const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const migrated = buildUnsignedOracleV2Migration(input);
await writeFile(resolve(outputPath), `${JSON.stringify(migrated, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
