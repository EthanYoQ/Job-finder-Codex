import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("formal compose release authority",()=>{
  const compose=readFileSync("ops/docker-compose.yml","utf8");
  const service=(name:string)=>compose.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9-]*:\\n|^volumes:\\n)`,"mu"))?.[0]??"";
  it("requires one qualified immutable digest for every application image",()=>{
    expect(compose).toMatch(/ghcr\.io\/ethanyoq\/job-finder-rc022-cloud-acceptance@sha256:\$\{JOB_FINDER_IMAGE_DIGEST:\?[^}]+\}/u);
    expect(compose.match(/^    image: \*job-finder-image$/gmu)).toHaveLength(10);
    expect(compose).not.toMatch(/^    build:/gmu);
  });
  it.each(["membership.json","oracle.json"])("does not deploy obsolete file authority %s",name=>{
    const worker=service("worker"),scheduler=service("scheduler"),monitor=service("monitor");
    const authority=name.startsWith("membership")?"MEMBERSHIP":"ORACLE";
    expect(worker).not.toContain(`P0_FULL_RELEASE_${authority}`);
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
    expect(scheduler).not.toMatch(/STAGED_CRAWL_(?:SUMMARY_PATH|ATTEMPT_DIR):\s*\$\{/u);
    expect(monitor).not.toMatch(/STAGED_CRAWL_(?:SUMMARY_PATH|ATTEMPT_DIR):\s*\$\{/u);
    expect(scheduler).not.toMatch(/P0_RELEASE_/u);expect(monitor).not.toMatch(/P0_RELEASE_/u);
  });
  it("uses the zero-input formal CLI contract",()=>{
    expect(compose).not.toMatch(/--release-candidate-id|--commit-sha|--roster-sha256|--batch-kind/u);
  });
  it("inherits the image's non-root service user and does not replace /app with a root-owned bind",()=>{
    const dockerfile=readFileSync("Dockerfile","utf8");
    expect(dockerfile).not.toContain("chown -R node:node /app");
    expect(dockerfile).toMatch(/COPY --chown=node:node --from=identity \/app\/node_modules \.\/node_modules[\s\S]*USER node/u);
    expect(compose).not.toMatch(/target:\s*\/app(?:\s|$)/u);
  });
  it("runs one default formal scheduler and one DB-authority manual worker",()=>{
    const worker=service("worker");
    expect(worker).toMatch(/init:\s*true/u);
    expect(worker).toMatch(/restart:\s*unless-stopped/u);
    expect(worker).toMatch(/command:\s*\["node",\s*"node_modules\/tsx\/dist\/cli\.mjs",\s*"scripts\/p0-manual-crawl-worker\.ts"\]/u);
    expect(compose).toMatch(/scheduler:[\s\S]*init:\s*true[\s\S]*command:\s*\["node",\s*"node_modules\/tsx\/dist\/cli\.mjs",\s*"scripts\/p0-scheduler\.ts"\]/u);
    expect(compose).not.toMatch(/while true; do npm run p0:crawl/u);
    const scheduler=readFileSync("scripts/p0-scheduler.ts","utf8");
    expect(scheduler).toContain("nextP0SchedulerWindow");
    expect(readFileSync("src/crawler/schedule.ts","utf8")).toContain('"00:01"');
    expect(readFileSync("src/crawler/schedule.ts","utf8")).toContain('"12:01"');
    expect(scheduler).toMatch(/no immediate retry/i);
    expect(readFileSync("src/crawler/formalCrawlLock.ts","utf8")).toContain('open(lockPath,"wx",0o600)');
    expect(readFileSync("scripts/p0-formal-crawl-once.ts","utf8"))
      .toContain('productionTsxProcessArgs("scripts/p0-crawl.ts",["--force"])');
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
    expect(readFileSync("Dockerfile","utf8")).toMatch(/install -d -m 0700 -o node -g node \/app\/outputs[\s\S]*USER node/u);
  });
});
