import {spawnSync} from "node:child_process";
import {productionTsxProcessArgs} from "../src/ops/productionTsxProcess";

const result=spawnSync(process.execPath,productionTsxProcessArgs("scripts/p0-crawl.ts",["--force"]),{
  stdio:"inherit",env:process.env
});
if(result.error)throw result.error;
if(result.status!==0)throw new Error(`Formal crawl exited with status ${String(result.status)}`);
