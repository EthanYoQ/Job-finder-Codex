import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("formal compose release authority",()=>{
  const compose=readFileSync("ops/docker-compose.yml","utf8");
  const service=(name:string)=>compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9-]*:\\n|^volumes:\\n)`,"mu"))?.[0]??"";
  it("requires build provenance for every application image",()=>{
    expect(compose).toMatch(/BUILD_COMMIT_SHA:\s*\$\{BUILD_COMMIT_SHA:\?[^}]+\}/u);
    expect(compose).toMatch(/BUILD_SOURCE_CLEAN:\s*\$\{BUILD_SOURCE_CLEAN:\?[^}]+\}/u);
    expect(compose).toMatch(/BUILD_SOURCE_TREE_SHA256:\s*\$\{BUILD_SOURCE_TREE_SHA256:\?[^}]+\}/u);
  });
  it.each(["membership.json","oracle.json"])("keeps %s only on the historical strict worker",name=>{
    const worker=service("worker"),scheduler=service("scheduler"),monitor=service("monitor");
    expect(worker).toContain(`target: /run/release-authority/${name}`);
    expect(worker).toContain("read_only: true");
    const authority=name.startsWith("membership")?"MEMBERSHIP":"ORACLE";
    expect(worker).toContain(`P0_FULL_RELEASE_${authority}_FILE_SHA256:`);
    expect(scheduler).not.toContain(`P0_FULL_RELEASE_${authority}`);
    expect(monitor).not.toContain(`P0_FULL_RELEASE_${authority}`);
    expect(scheduler).not.toContain(`/run/release-authority/${name}`);
    expect(monitor).not.toContain(`/run/release-authority/${name}`);
  });
  it("uses one shared staged summary and attempt path for scheduler and monitor",()=>{
    const scheduler=service("scheduler"),monitor=service("monitor");
    for(const value of ["/app/outputs/staged-crawl-summary.json","/app/outputs/staged-crawl-attempts"]){
      expect(scheduler).toContain(value);expect(monitor).toContain(value);
    }
    expect(scheduler).not.toMatch(/P0_RELEASE_/u);expect(monitor).not.toMatch(/P0_RELEASE_/u);
  });
  it("uses the zero-input formal CLI contract",()=>{
    expect(compose).not.toMatch(/--release-candidate-id|--commit-sha|--roster-sha256|--batch-kind/u);
  });
  it("inherits the image's non-root service user and does not replace /app with a root-owned bind",()=>{
    expect(readFileSync("Dockerfile","utf8")).toMatch(/chown -R node:node \/app[\s\S]*USER node/u);
    expect(compose).not.toMatch(/target:\s*\/app(?:\s|$)/u);
  });
  it("runs one default formal scheduler while the worker is manual-only",()=>{
    expect(compose).toMatch(/worker:[\s\S]*profiles:\s*\["manual"\][\s\S]*restart:\s*"no"/u);
    expect(compose).toMatch(/scheduler:[\s\S]*command:\s*\["npm",\s*"run",\s*"p0:scheduler"\]/u);
    expect(compose).not.toMatch(/while true; do npm run p0:crawl/u);
    const scheduler=readFileSync("scripts/p0-scheduler.ts","utf8");
    expect(scheduler).toContain("nextP0CrawlWindow");
    expect(readFileSync("src/crawler/schedule.ts","utf8")).toContain('["08:00", "20:00"]');
    expect(scheduler).toMatch(/no immediate retry/i);
    expect(readFileSync("src/crawler/formalCrawlLock.ts","utf8")).toContain('open(lockPath,"wx",0o600)');
    expect(readFileSync("scripts/p0-formal-crawl-once.ts","utf8")).toContain('"p0:crawl"');
    const recovery=readFileSync("scripts/p0-recover-formal-crawl-lock.ts","utf8");
    expect(recovery.indexOf("loadCurrentReleaseIdentity()")) .toBeLessThan(recovery.indexOf('import("@prisma/client")'));
    expect(recovery).not.toMatch(/release-candidate-id|commit-sha|roster-sha256|ack-no-active/u);
    const crawl=readFileSync("scripts/p0-crawl.ts","utf8");
    expect(crawl.indexOf("acquireFormalAdvisoryLock")).toBeLessThan(crawl.indexOf("acquireFormalCrawlLock()"));
    expect(recovery.indexOf("acquireFormalAdvisoryLock")).toBeLessThan(recovery.indexOf("new PrismaClient"));
  });
  it("persists the private archive at the exact runtime path with writer and verifier permissions",()=>{
    expect(compose).toMatch(/formal-artifacts:\s*$/mu);
    expect(compose.match(/source:\s*formal-artifacts/g)?.length).toBeGreaterThanOrEqual(4);
    expect(compose).toMatch(/target:\s*\/app\/outputs[\s\S]*read_only:\s*true/u);
    expect(readFileSync("Dockerfile","utf8")).toMatch(/mkdir -p \/app\/outputs[\s\S]*chmod 0700 \/app\/outputs/u);
  });
});
