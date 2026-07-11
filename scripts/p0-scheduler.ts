import {setTimeout as delay} from "node:timers/promises";
import {spawnSync} from "node:child_process";
import {nextP0CrawlWindow} from "../src/crawler/schedule";

for(;;){
  const window=nextP0CrawlWindow(new Date());
  const wait=Math.max(0,new Date(window.startsAt).getTime()-Date.now());
  console.log(`Next formal crawl window ${window.label} at ${window.startsAt}`);
  await delay(wait);
  const result=spawnSync("npm",["run","p0:formal-crawl-once"],{stdio:"inherit",env:process.env});
  if(result.error)console.error(result.error);
  else if(result.status!==0)console.error(`Formal window ${window.label} blocked with status ${String(result.status)}; no immediate retry`);
  await delay(60_000);
}
