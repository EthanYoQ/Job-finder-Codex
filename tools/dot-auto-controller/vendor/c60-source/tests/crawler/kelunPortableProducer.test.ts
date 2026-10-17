// @vitest-environment node
/** Entire normal portable producer, archive/restore, issuer and delta SQL
 * compiler. Synthetic HTTP/context/build only; the relay refuses dispatch. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
vi.hoisted(() => { process.env.JOBFINDER_CLOUD_SOURCE_ID = "source-kelun-social"; });
vi.mock("../../src/readiness/buildIdentity", () => ({resolveCurrentBuildIdentity: () => build}));
import { runCloudPortableSourcePilot } from "../../scripts/p0-cloud-portable-source-pilot";
import { deriveCurrentStagedScheduleExpectation, STAGED_SCHEDULE_ORACLE_VERSION } from "../../src/crawler/stagedScheduleAuthority";
import { FilePilotRelay, PilotSqlFailure } from "../../src/crawler/cloudSourcePilotRelay";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import * as repository from "../../src/db/ingestionRepository";
import { JOB_DELTA_MIGRATION_NAME } from "../../src/db/jobProjectionDeltaProfile";
import { parseJobProjectionDeltaReceipt } from "../../src/domain/jobProjectionDeltaReceipt";
import { syntheticKelunRow as row, syntheticKelunPage as page } from "../helpers/kelunQualityFixture";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const base = {schemaVersion: 2 as const, commitSha: "a".repeat(40), sourceTreeSha256: "b".repeat(64), runtimeTreeSha256: "c".repeat(64)};
const build = {...base, contentSha256: digest(JSON.stringify(base))};
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(path => rm(path, {recursive:true,force:true}))); });

describe("Kelun normal portable producer with synthetic boundaries", () => {
  it.each(["mixed", "allOutside"])("compiles %s through the existing producer and delta contract without a DB connection", async kind => {
    const root = await mkdtemp(join(tmpdir(), "kelun-normal-producer-synthetic-")); dirs.push(root);
    const expected = deriveCurrentStagedScheduleExpectation(build), plan = expected.plans.find(p => p.source.id === "source-kelun-social")!;
    const candidate = {id: `synthetic-kelun-${kind}`, goalId: "jobfinder-portable-required-40", version: 999};
    const databaseIdentity = {migrationVersion: JOB_DELTA_MIGRATION_NAME, schemaHash: "d".repeat(64), dbSnapshotHash: "e".repeat(64)};
    const candidateRow = {...candidate, ...databaseIdentity, commitSha: expected.commitSha, rosterHash: expected.rosterSha256,
      sourcePlanHash: expected.sourcePlanSha256, sourceConfigHash: expected.sourceConfigSha256, adapterBundleHash: expected.adapterBundleSha256,
      sourceTreeHash: expected.sourceTreeSha256, runtimeTreeHash: expected.runtimeTreeSha256,
      oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION, minimumStableCompanyCount: expected.minimumStableCompanyCount, status: "BUILDING"};
    const context = {checkedAt: new Date().toISOString(), sourceId: plan.source.id, sourceConfigSha256: sourcePlanConfigSha256(plan), jobs: [],
      latestAccepted: null, firstAccepted: null, candidateRow, sourceRow: {...plan.source}, companyRow: {...plan.company}};
    const bodies = kind === "mixed" ? [page([row("990080001", "上海市"),row("990080002", "香港")],2),page([row("990080003", "北京市")],2)]
      : [page([row("990080001", "香港"),row("990080002", "澳门")])];
    const requests: string[] = [], relayStages: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), coordinate = new URL(url), number = Number(coordinate.searchParams.get("PageIndex") ?? "1");
      requests.push(url);
      if (coordinate.origin !== "https://kelun.zhiye.com" || coordinate.pathname !== "/social" || coordinate.searchParams.get("p") !== "1^2" ||
        !bodies[number-1] || requests.length > bodies.length || (init?.method ?? "GET") !== "GET") throw Error("SYNTHETIC_HTTP_UNEXPECTED_REQUEST");
      const response = new Response(bodies[number-1], {status:200,headers:{"content-type":"text/html"}});Object.defineProperty(response,"url",{value:url});return response;
    }));
    vi.spyOn(FilePilotRelay.prototype, "request").mockImplementation(async kind => {
      relayStages.push(kind); if (kind !== "READ_CONTEXT") throw Error("SYNTHETIC_RELAY_UNEXPECTED_REQUEST");
      return {...context, checkedAt: new Date().toISOString()} as never;
    });
    let compiledSql = "";
    vi.spyOn(FilePilotRelay.prototype, "sql").mockImplementation(async (kind, sql) => {
      relayStages.push(kind);
      if (kind === "READ_PUBLICATION_CONTEXT") return [{context:{...context,checkedAt:new Date().toISOString()}}];
      if (kind === "PUBLISH") { compiledSql = sql; throw new PilotSqlFailure("NOT_DISPATCHED", "SYNTHETIC_NO_DATABASE"); }
      if (kind === "READ_OUTCOME") return [{row:null,batch:null,holderId:""}];
      throw Error("SYNTHETIC_RELAY_UNEXPECTED_SQL");
    });
    const realCompile = repository.compileDbStartedCloudSourcePublication;
    let packet: Awaited<ReturnType<typeof realCompile>> | undefined;
    vi.spyOn(repository, "compileDbStartedCloudSourcePublication").mockImplementation(async input => {
      expect(input.jobProjectionDelta).toBe(true);
      expect(input.source.sourceAdmissionPolicy).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
      packet = await realCompile(input); return packet;
    });
    const bootstrap = JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[candidateRow],batchId:`synthetic-kelun-${kind}-batch`});
    const bootstrapPath = join(root,"bootstrap.json"), controlPath = join(root,"control.json");
    await writeFile(bootstrapPath,bootstrap);
    await writeFile(controlPath,JSON.stringify({projectId:"yiopvxysxrtrnvqxwgbx",build,candidate,databaseIdentity}));
    const outcome = await runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:digest(bootstrap),workspaceRoot:root,relayDirectory:join(root,"synthetic-unused-relay"),
      dbStartedControlPath:controlPath,overallDeadline:Date.now()+30*60_000});
    expect(outcome.publishAcknowledged).toBe(false); expect(outcome.state).not.toBe("COMMITTED_EXACT");
    if (!("publicationMode" in outcome)) throw Error("EXPECTED_DB_STARTED_OUTCOME");
    expect(outcome.publicationMode).toBe("DB_STARTED_JOB_PROJECTION_DELTA_V1");
    expect(relayStages).toEqual(["READ_CONTEXT","READ_PUBLICATION_CONTEXT","PUBLISH","READ_OUTCOME"]);
    expect(requests).toHaveLength(bodies.length); expect(packet).toBeDefined();
    const p = packet!;
    expect(compiledSql).toBe(p.sql); expect(p.sql).toContain("KELUN_EXPLICIT_OUTSIDE_MAINLAND");
    expect(p.sql).toContain("job-projection-delta-receipt-v1"); expect(p.sql).toContain('"LossLedgerEntry"');
    const receipt = parseJobProjectionDeltaReceipt(p.commit.sourceResult.completenessCertificate,p.commit.sourceResult.completenessCertificateSha256!);
    expect(receipt.legacyCertificate.schemaVersion).toBe("plan-bound-source-quality-v1");
    expect(receipt.legacyCertificate).not.toHaveProperty("grade");
    expect(p.commit.sourceResult).toMatchObject({rawCount:kind === "mixed" ? 3 : 2,validCount:kind === "mixed" ? 2 : 0,
      validationDiscardCount:kind === "mixed" ? 1 : 2,completenessState:"VERIFIED",atomicCommitState:"COMMITTED"});
    expect(receipt.members.filter(m=>m.setKind === "CURRENT").map(m=>m.jobKey).sort()).toEqual(kind === "mixed" ? ["source-kelun-social:990080001","source-kelun-social:990080003"] : []);
    expect(p.commit.artifacts.map(a=>a.sha256)).toEqual(bodies.map(digest));
    const archiveText = await readFile(outcome.bundlePath,"utf8");
    expect(digest(archiveText)).toBe(outcome.bundleSha256);
    if (process.env.KELUN_SYNTHETIC_PROOF_DIR) {
      const folder=resolve(process.env.KELUN_SYNTHETIC_PROOF_DIR);await mkdir(folder,{recursive:true});
      await writeFile(join(folder,`${kind}.sql`),p.sql);
      await writeFile(join(folder,`${kind}.archive.json`),archiveText);
      await writeFile(join(folder,`${kind}.json`),JSON.stringify({syntheticOnly:true,networkRequests:0,databaseCalls:0,
        path:"runCloudPortableSourcePilot → owned fetch → full archive → restore → issuer → actual DB-started delta SQL compiler → synthetic NOT_DISPATCHED boundary",
        sourceConfigSha256:sourcePlanConfigSha256(plan),requests,relayStages,sourceResult:p.commit.sourceResult,
        lossLedger:p.commit.lossLedger,receipt,sqlSha256:digest(p.sql),archiveSha256:outcome.bundleSha256,publishAcknowledged:false},null,2));
    }
  });
});
