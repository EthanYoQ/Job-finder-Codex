import {spawnSync} from "node:child_process";
const result=spawnSync("npm",["run","p0:crawl","--","--force"],{stdio:"inherit",env:process.env});
if(result.error)throw result.error;
if(result.status!==0)throw new Error(`Formal crawl exited with status ${String(result.status)}`);
