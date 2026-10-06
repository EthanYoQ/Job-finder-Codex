import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import logoManifest from "../../src/app/assets/company-logos";
import { candidateCompanies } from "../../src/data/companyRegistry";
import * as publicationApi from "../../src/server/portablePublicationApi";
import { portableDisplayAssetsVersion, portableDisplayDataVersion, portableSnapshotIdentities, PORTABLE_DISPLAY_ASSETS_VERSION } from "../../src/db/portableDisplayIdentity";
import { PortableSnapshotCache, portableSnapshotValidUntil } from "../../src/db/portableSnapshotCache";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortablePublicSnapshot } from "../../src/db/portablePublicSnapshotRepository";
import { accepted, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";
import { chineseBFixture, EXPIRES } from "../helpers/sanofiChinesePublicFixture";

async function snapshot(): Promise<PortablePublicSnapshot> {
  const evidence = accepted();
  const tx = {crawlBatchSourceResult: {findMany: async () => [evidence.result]},
    lifecycleSetEvidenceMember: {findMany: async () => evidence.members}, job: {findMany: async () => [job()]}};
  const db = {$transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx)} as PortableSnapshotDb;
  return readPortablePublicSnapshot(db, {currentTime: NOW}, [plan]);
}
const ownCompany = (s: PortablePublicSnapshot) => s.companies.find(company => company.id === plan.company.id)!;

describe("independent portable display, status and verification identities", () => {
  it("keeps the full legacy hash while separating fresh verification from unchanged data/status", async () => {
    const old = await snapshot(), newer = structuredClone(old);
    newer.generatedAt = new Date(NOW.getTime() + 1_000).toISOString();
    const a = portableSnapshotIdentities(old), b = portableSnapshotIdentities(newer);
    expect(a.version).toBe(createHash("sha256").update(JSON.stringify(old)).digest("hex"));
    expect(b.displayDataVersion).toBe(a.displayDataVersion);
    expect(b.statusVersion).toBe(a.statusVersion);
    expect(b.version).not.toBe(a.version);
    expect(b.verificationVersion).not.toBe(a.verificationVersion);
    expect(b.verifiedAt).toBe(newer.generatedAt);
  });

  it("excludes receipt identities and original observation-only times from data", async () => {
    const old = await snapshot(), newer = structuredClone(old);
    newer.lastUpdatedAt = SECOND;
    for (const source of newer.sources) {
      source.lastAttemptAt = SECOND; source.lastAcceptedAt = SECOND; source.lastSuccessAt = SECOND;
      source.selectedSourceResultId = "next-result";
      for (const job of source.jobs) Object.assign(job, {sourceResultId: "next-result", lastSeenAt: SECOND, lastConfirmedObservedAt: SECOND});
    }
    const a = portableSnapshotIdentities(old), b = portableSnapshotIdentities(newer);
    expect(b.displayDataVersion).toBe(a.displayDataVersion);
    expect(b.statusVersion).not.toBe(a.statusVersion);
  });

  it.each([
    ["title", "人工修正标题"], ["officialTitle", "Original title revised"],
    ["officialPublishedAt", SECOND], ["city", "北京"], ["cities", ["上海", "广东-广州"]],
    ["locationRaw", "广东·广州市·天河区"], ["category", "医学事务"],
    ["isNew", true], ["officialUrl", "https://example.test/updated-application"], ["id", "changed-id"]
  ])("changes the data identity for final job %s", async (field, value) => {
    const old = await snapshot(), newer = structuredClone(old);
    Object.assign(ownCompany(newer).jobs[0]!, {[String(field)]: value});
    expect(portableDisplayDataVersion(newer)).not.toBe(portableDisplayDataVersion(old));
  });

  it.each([["companyName", "新公司名称"], ["pinyin", "new-name"], ["category", "FOREIGN_PHARMA"]])(
    "changes the data identity for company %s, including the directory search inputs", async (field, value) => {
      const old = await snapshot(), newer = structuredClone(old);
      Object.assign(ownCompany(newer), {[field!]: value});
      expect(portableDisplayDataVersion(newer)).not.toBe(portableDisplayDataVersion(old));
    });

  it("binds the directory's real official and recruitment URLs", async () => {
    const display = await snapshot(), registry = candidateCompanies.find(company => company.id === plan.company.id)!;
    const project = publicationApi.coverageFromPortableSnapshot;
    const actual = project({keyword: "", limit: display.companies.length}, display).companies.find(company => company.id === registry.id)!;
    expect(actual.officialWebsiteUrl).toBe(registry.officialWebsiteUrl);
    expect(actual.officialCareersUrl).toBe(registry.sources.find(source => source.id === plan.source.id)!.officialEntryUrl);
    const before = portableDisplayDataVersion(display);
    for (const field of ["officialWebsiteUrl", "officialCareersUrl"] as const) {
      const spy = vi.spyOn(publicationApi, "coverageFromPortableSnapshot").mockImplementationOnce((request, snapshot) => {
        const result = project(request, snapshot);
        result.companies.find(company => company.id === registry.id)![field] = "https://example.test/changed-official-link";
        return result;
      });
      try { expect(portableDisplayDataVersion(display)).not.toBe(before); }
      finally { spy.mockRestore(); }
    }
  });

  it("binds source scope notes and the actual published source set", async () => {
    const old = await snapshot(), newer = structuredClone(old);
    const sanofi = newer.sources.find(source => source.sourceId === "source-sanofi-china-social");
    // This fixture only plans Hansoh, so add the exact source metadata consumed
    // by the production directory projector for the existing Sanofi roster row.
    if (!sanofi) newer.sources.push({...newer.sources[0]!, companyId: "company-sanofi-china", sourceId: "source-sanofi-china-social", jobs: []});
    const source = newer.sources.find(source => source.sourceId === "source-sanofi-china-social")!;
    source.selectedSourceResultId = "reviewed-snapshot";
    source.policyId = "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1";
    expect(portableDisplayDataVersion(newer)).not.toBe(portableDisplayDataVersion(old));
    const removed = structuredClone(old);
    ownCompany(removed).publishingSourceIds = [];
    expect(portableDisplayDataVersion(removed)).not.toBe(portableDisplayDataVersion(old));
  });

  it("hashes both real logo formats and sprite coordinates", async () => {
    const png = readFileSync(new NodeURL("../../src/app/assets/company-logos.png", import.meta.url));
    const webp = readFileSync(new NodeURL("../../src/app/assets/company-logos.webp", import.meta.url));
    const base = {png, webp, manifest: logoManifest};
    expect(portableDisplayAssetsVersion(base)).toBe(PORTABLE_DISPLAY_ASSETS_VERSION);
    const pngChanged = Buffer.from(png); pngChanged[0] = pngChanged[0]! ^ 1;
    const webpChanged = Buffer.from(webp); webpChanged[0] = webpChanged[0]! ^ 1;
    const mappingChanged = {...logoManifest, positions: {...logoManifest.positions, [plan.company.id]: [0, 0]}};
    const display = await snapshot(), original = portableDisplayDataVersion(display);
    for (const modified of [{...base, png: pngChanged}, {...base, webp: webpChanged}, {...base, manifest: mappingChanged}]) {
      const assetsVersion = portableDisplayAssetsVersion(modified);
      expect(assetsVersion).not.toBe(PORTABLE_DISPLAY_ASSETS_VERSION);
      expect(portableDisplayDataVersion(display, assetsVersion)).not.toBe(original);
    }
  });

  it("ignores object insertion order in an otherwise identical logo mapping", () => {
    const png = Buffer.from("same png bytes"), webp = Buffer.from("same webp bytes");
    const a = {png, webp, manifest: {columns: 8, positions: {first: [0, 1], second: [2, 3]}}};
    const b = {png, webp, manifest: {positions: {second: [2, 3], first: [0, 1]}, columns: 8}};
    expect(portableDisplayAssetsVersion(a)).toBe(portableDisplayAssetsVersion(b));
    expect(portableDisplayAssetsVersion(a)).not.toBe(portableDisplayAssetsVersion({...b, manifest: {positions: {first: [1, 0], second: [2, 3]}, columns: 8}}));
  });

  it("changes status alone at 30 hours, while accepted jobs remain publishing", async () => {
    const evidence = accepted(), tx = {crawlBatchSourceResult: {findMany: async () => [evidence.result]},
      lifecycleSetEvidenceMember: {findMany: async () => evidence.members}, job: {findMany: async () => [job()]}};
    const db = {$transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx)} as PortableSnapshotDb;
    const boundary = Date.parse(FIRST) + 30 * 60 * 60_000;
    const old = await readPortablePublicSnapshot(db, {currentTime: new Date(boundary - 1)}, [plan]);
    const newer = await readPortablePublicSnapshot(db, {currentTime: new Date(boundary)}, [plan]);
    const a = portableSnapshotIdentities(old), b = portableSnapshotIdentities(newer);
    expect(newer.sources[0]).toMatchObject({state: "PUBLISHING", freshness: "STALE", visibleJobCount: 1});
    expect(b.displayDataVersion).toBe(a.displayDataVersion);
    expect(b.statusVersion).not.toBe(a.statusVersion);
    expect(newer.sources[0]!.lastSuccessAt).toBe(old.sources[0]!.lastSuccessAt);
  });

  it("changes data as well as status when B certificate expiry withdraws jobs", async () => {
    const fixture = await chineseBFixture();
    const tx = {crawlBatchSourceResult: {findMany: async () => [fixture.result]},
      evidenceArtifact: {findMany: async () => fixture.result.sanofiArtifacts},
      lifecycleSetEvidenceMember: {findMany: async () => fixture.members}, job: {findMany: async () => fixture.jobs}};
    const db = {$transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx)} as PortableSnapshotDb;
    const boundary = Date.parse(EXPIRES);
    const old = await readPortablePublicSnapshot(db, {currentTime: new Date(boundary - 1)}, [fixture.plan]);
    const newer = await readPortablePublicSnapshot(db, {currentTime: new Date(boundary)}, [fixture.plan]);
    expect(old.totalJobs).toBeGreaterThan(0);
    expect(newer.totalJobs).toBe(0);
    const a = portableSnapshotIdentities(old), b = portableSnapshotIdentities(newer);
    expect(b.displayDataVersion).not.toBe(a.displayDataVersion);
    expect(b.statusVersion).not.toBe(a.statusVersion);
  });

  it("owns all returned identities and keeps build sequence independent of every hash", async () => {
    const display = await snapshot(), cache = new PortableSnapshotCache();
    const identity = cache.setRead("database-a", "scope", Infinity, display);
    const old = cache.getDuringRefreshRead(NOW.getTime())!;
    expect(old).toEqual({snapshot: display, ...portableSnapshotIdentities(display)});
    expect(cache.getBuildSequence()).toBe(1);
    identity.displayDataVersion = "caller-mutation";
    cache.setRead("database-b", "scope", Infinity, structuredClone(display));
    expect(cache.getBuildSequence()).toBe(2);
    expect(cache.getDuringRefreshRead(NOW.getTime())).toEqual(old);
    const future = cache.getPreviousRead("scope", NOW.getTime() + 30 * 60 * 60_000)!;
    expect(future.verifiedAt).toBe(display.generatedAt);
    expect(future.snapshot.lastUpdatedAt).toBe(display.lastUpdatedAt);
  });

  it("expires at the true confirmed observation's freshness boundary", async () => {
    const display = await snapshot(), observedAt = new Date(NOW.getTime() - 60_000).toISOString();
    Object.assign(display.sources[0]!.jobs[0]!, {lastConfirmedObservedAt: observedAt});
    display.sources[0]!.lastSuccessAt = NOW.toISOString();
    expect(portableSnapshotValidUntil({}, NOW.getTime(), 120_000, display)).toBe(Date.parse(observedAt) + 120_000);
  });
});
