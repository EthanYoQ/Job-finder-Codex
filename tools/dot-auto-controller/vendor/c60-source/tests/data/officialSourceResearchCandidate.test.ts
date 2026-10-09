import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { candidateCompanies, CONFIRMED_V3_TO_RUNTIME_COMPANY_ID } from "../../src/data/companyRegistry";
import {
  canonicalCandidateHash,
  canonicalEvidenceRecordHash,
  mergeOfficialSourceResearchCandidateBatches,
  parseOfficialSourceResearchCandidateBatch,
  validateOfficialSourceResearchCandidateJson
} from "../../src/data/officialSourceResearchCandidate";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const ids = Object.keys(CONFIRMED_V3_TO_RUNTIME_COMPANY_ID);
const partitions = {
  F01: ids.slice(0, 15), F02: ids.slice(15, 30), D01: ids.slice(30, 45), D02: ids.slice(45, 60)
} as const;

function company(confirmedV3Id: string, ordinal: number) {
  const runtimeId = CONFIRMED_V3_TO_RUNTIME_COMPANY_ID[confirmedV3Id]!;
  const registry = candidateCompanies.find((item) => item.id === runtimeId)!;
  const baseUrl = registry.officialWebsiteUrl!.replace(/^http:/, "https:");
  const careersUrl = new URL("careers", baseUrl).toString();
  const evidence = { evidenceId: `${confirmedV3Id}-official-link`, url: baseUrl, sourceRole: "COMPANY_OFFICIAL_PAGE" as const,
    capturedAt: "2026-07-11T00:00:00.000Z", httpStatus: 200, finalUrl: careersUrl,
    fact: "Official company page links to careers." };
  return {
    confirmedV3Id, runtimeId, ordinal,
    category: confirmedV3Id.startsWith("foreign-") ? "FOREIGN_PHARMA" : "DOMESTIC_PHARMA",
    officialChineseName: registry.officialChineseName, globalName: `Global ${ordinal}`,
    officialWebsiteUrls: [baseUrl],
    officialDomainProvenance: [{ websiteUrl: baseUrl, confirmedHost: new URL(baseUrl).hostname, evidenceId: evidence.evidenceId }],
    surfaces: [{
      surfaceId: `${confirmedV3Id}-social`, kind: "SOCIAL", candidateStatus: "PENDING",
      officialEntryUrl: careersUrl, finalUrl: careersUrl,
      entryHopId: `${confirmedV3Id}-hop-1`,
      officialChainEvidence: [evidence],
      officialChainHops: [{ hopId: `${confirmedV3Id}-hop-1`, evidenceId: evidence.evidenceId,
        evidenceSha256: canonicalEvidenceRecordHash(evidence), fromUrl: baseUrl, fromRole: "COMPANY_OFFICIAL_PAGE",
        toUrl: careersUrl, toRole: "CAREERS_OFFICIAL_PAGE", mechanism: "LINK" }],
      legalEntityScope: [{ status: "UNRESOLVED", reason: "Legal entity proof pending." }],
      businessUnitScope: [{ status: "UNRESOLVED", reason: "Business unit proof pending." }],
      brandScope: [{ status: "UNRESOLVED", reason: "Brand proof pending." }],
      chinaScope: { status: "UNRESOLVED", reason: "China filter proof pending." },
      ats: { kind: "UNKNOWN", tenant: { status: "UNRESOLVED", reason: "Tenant proof pending." } },
      channels: [{ channelId: `${confirmedV3Id}-social-pending`, kind: "SOCIAL", discoveryStatus: "PENDING" }]
    }],
    unresolvedRisks: [{ code: "OFFICIAL_CHAIN_PENDING", detail: "Independent reopening is pending.", followUp: "Reopen the official chain." }]
  };
}

function batch(batchId: keyof typeof partitions) {
  const batchIds = partitions[batchId];
  const offset = batchId.endsWith("02") ? 16 : 1;
  return {
    schemaVersion: "phase2-task2-canonical-candidate-v1", batchId,
    captureStartedAt: "2026-07-11T00:00:00.000Z", captureCompletedAt: "2026-07-11T01:00:00.000Z",
    discoveryOnly: true, oracleStatus: "RESEARCH_PENDING_INDEPENDENT_VERIFICATION", promotionCount: 0,
    companies: batchIds.map((id, index) => company(id, offset + index))
  };
}

function rebindFirstHop(value: any): void {
  const surface = value.companies[0].surfaces[0];
  surface.officialChainHops[0].evidenceSha256 = canonicalEvidenceRecordHash(surface.officialChainEvidence[0]);
}

function configureRedsea(surface: any, url: string): void {
  surface.ats = { kind: "REDSEA", tenant: { status: "RESOLVED", value: "CSPC/RedseaPlatform" } };
  surface.officialEntryUrl = url;
  surface.finalUrl = url;
  surface.officialChainEvidence[0].finalUrl = url;
  surface.officialChainHops[0].toUrl = url;
  surface.officialChainHops[0].toRole = "ATS_FINAL";
  surface.officialChainHops[0].evidenceSha256 = canonicalEvidenceRecordHash(surface.officialChainEvidence[0]);
}

describe("official source research candidate canonical contract", () => {
  it("accepts and merges the exact four confirmed V3 partitions", () => {
    const batches = (["F01", "F02", "D01", "D02"] as const).map((id) =>
      parseOfficialSourceResearchCandidateBatch(batch(id), NOW)
    );
    const merged = mergeOfficialSourceResearchCandidateBatches(batches);
    expect(merged.companies).toHaveLength(60);
    expect(merged.companies.map((item) => item.confirmedV3Id).sort()).toEqual([...ids].sort());
    expect(merged.promotionCount).toBe(0);
  });

  it.each([
    ["unknown top key", (value: any) => { value.active = true; }],
    ["schema drift", (value: any) => { value.records = value.companies; delete value.companies; }],
    ["name mapping drift", (value: any) => { value.companies[0].officialChineseName = "replacement"; }],
    ["unknown ATS kind", (value: any) => { value.companies[0].surfaces[0].ats.kind = "MADE_UP"; }],
    ["empty channels", (value: any) => { value.companies[0].surfaces[0].channels = []; }],
    ["promotion", (value: any) => { value.promotionCount = 1; }],
    ["active surface", (value: any) => { value.companies[0].surfaces[0].candidateStatus = "ACTIVE"; }],
    ["expected channel", (value: any) => { value.companies[0].surfaces[0].channels[0].discoveryStatus = "EXPECTED"; }],
    ["empty blocker", (value: any) => { value.companies[0].unresolvedRisks[0].detail = ""; }],
    ["future capture", (value: any) => { value.captureCompletedAt = "2026-07-13T00:00:00.000Z"; }],
    ["reversed capture", (value: any) => { value.captureStartedAt = "2026-07-11T02:00:00.000Z"; }]
  ])("rejects %s", (_label, mutate) => {
    const value: any = structuredClone(batch("F01")); mutate(value);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each([
    ["2026-07-11T00:00:00.000Z", true],
    ["2026-07-11T01:00:00.000Z", true],
    ["2026-07-10T23:59:59.999Z", false],
    ["2026-07-11T01:00:00.001Z", false]
  ])("binds evidence time %s to the inclusive batch window", (capturedAt, accepted) => {
    const value: any = structuredClone(batch("F01"));
    value.companies[0].surfaces[0].officialChainEvidence[0].capturedAt = capturedAt;
    rebindFirstHop(value);
    const parse = () => parseOfficialSourceResearchCandidateBatch(value, NOW);
    if (accepted) expect(parse).not.toThrow(); else expect(parse).toThrow();
  });

  it.each(["https://google.com/", "https://www.bing.com/", "https://linkedin.com/jobs/"]) (
    "rejects denied third-party host as an official website: %s", (url) => {
      const value: any = structuredClone(batch("F01"));
      value.companies[0].officialWebsiteUrls[0] = url;
      value.companies[0].officialDomainProvenance[0].websiteUrl = url;
      value.companies[0].officialDomainProvenance[0].confirmedHost = new URL(url).hostname;
      expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
    });

  it("rejects official-domain provenance that is not bound to its official evidence", () => {
    const value: any = structuredClone(batch("F01"));
    value.companies[0].officialDomainProvenance[0].evidenceId = "unrelated";
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each([
    "http://example.com/careers",
    "https://user:placeholder@example.com/careers",
    "https://example.com/careers?apiKey=secret"
  ])("rejects unsafe evidence URL %s", (url) => {
    const value: any = structuredClone(batch("F01"));
    value.companies[0].surfaces[0].officialChainEvidence[0].url = url;
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("requires an official company backlink or redirect before accepting an ATS entry", () => {
    const value: any = structuredClone(batch("F01"));
    value.companies[0].surfaces[0].ats = { kind: "WORKDAY", tenant: { status: "RESOLVED", value: "tenant/site" } };
    value.companies[0].surfaces[0].officialChainEvidence[0].sourceRole = "ATS_FINAL";
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("rejects an ATS backlink role hosted outside the company's official websites", () => {
    const value: any = structuredClone(batch("F01"));
    value.companies[0].surfaces[0].ats = { kind: "WORKDAY", tenant: { status: "RESOLVED", value: "tenant/site" } };
    value.companies[0].surfaces[0].officialChainEvidence[0].url = "https://unrelated.example/careers";
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("accepts an external ATS only through a bound ordered official chain", () => {
    const value: any = structuredClone(batch("F01"));
    const surface = value.companies[0].surfaces[0];
    const atsUrl = "https://acme.wd3.myworkdayjobs.com/jobs";
    surface.ats = { kind: "WORKDAY", tenant: { status: "RESOLVED", value: "acme/jobs" } };
    surface.officialEntryUrl = atsUrl; surface.finalUrl = atsUrl;
    surface.officialChainEvidence[0].finalUrl = atsUrl;
    surface.officialChainHops[0].toUrl = atsUrl;
    surface.officialChainHops[0].toRole = "ATS_FINAL";
    rebindFirstHop(value);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).not.toThrow();
  });

  it("rejects a fake Workday chain terminating on an unrelated host", () => {
    const value: any = structuredClone(batch("F01"));
    const surface = value.companies[0].surfaces[0];
    const fakeAtsUrl = "https://careers.example.org/jobs";
    surface.ats = { kind: "WORKDAY", tenant: { status: "RESOLVED", value: "fake/jobs" } };
    surface.officialEntryUrl = fakeAtsUrl; surface.finalUrl = fakeAtsUrl;
    surface.officialChainEvidence[0].finalUrl = fakeAtsUrl;
    surface.officialChainHops[0].toUrl = fakeAtsUrl;
    surface.officialChainHops[0].toRole = "ATS_FINAL";
    rebindFirstHop(value);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("accepts only the observed CSPC company-controlled Redsea deployment", () => {
    const value: any = structuredClone(batch("D01"));
    const cspc = value.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc");
    const url = "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob";
    configureRedsea(cspc.surfaces[0], url);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).not.toThrow();
  });

  it.each([
    ["wrong company", "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob", "F01"],
    ["sibling subdomain", "https://fake.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob", "D01"],
    ["http", "http://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob", "D01"],
    ["wrong path", "https://ehr.e-cspc.com:8081/OtherPlatform/zhaopin/officeWebsite.mob", "D01"],
    ["encoded traversal", "https://ehr.e-cspc.com:8081/RedseaPlatform/%2e%2e/OtherPlatform/jobs", "D01"],
    ["missing observed port", "https://ehr.e-cspc.com/RedseaPlatform/zhaopin/officeWebsite.mob", "D01"],
    ["different port", "https://ehr.e-cspc.com:8080/RedseaPlatform/zhaopin/officeWebsite.mob", "D01"]
  ])("rejects CSPC Redsea taxonomy exception with %s", (_label, url, batchId) => {
    const value: any = structuredClone(batch(batchId as "F01" | "D01"));
    const target = batchId === "D01"
      ? value.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc")
      : value.companies[0];
    configureRedsea(target.surfaces[0], url);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each([
    ["double encoded dot", "https://ehr.e-cspc.com:8081/RedseaPlatform/%252e%252e/Other/jobs"],
    ["triple encoded dot", "https://ehr.e-cspc.com:8081/RedseaPlatform/%25252e%25252e/Other/jobs"],
    ["double encoded slash", "https://ehr.e-cspc.com:8081/RedseaPlatform%252f..%252fOther/jobs"],
    ["triple encoded backslash", "https://ehr.e-cspc.com:8081/RedseaPlatform/%25255c..%25255cOther/jobs"],
    ["encoded separator", "https://ehr.e-cspc.com:8081/RedseaPlatform/%25E2%2588%2595Other/jobs"],
    ["malformed percent", "https://ehr.e-cspc.com:8081/RedseaPlatform/%zz/jobs"],
    ["overlong encoding", "https://ehr.e-cspc.com:8081/RedseaPlatform/%c0%ae%c0%ae/jobs"],
    ["encoded control", "https://ehr.e-cspc.com:8081/RedseaPlatform/%2500/jobs"],
    ["NFKC fullwidth slash", "https://ehr.e-cspc.com:8081/RedseaPlatform/%25EF%25BC%258FOther/jobs"],
    ["query path", "https://ehr.e-cspc.com:8081/RedseaPlatform/jobs?path=/Other"],
    ["query next", "https://ehr.e-cspc.com:8081/RedseaPlatform/jobs?next=https://evil.example/"],
    ["fragment", "https://ehr.e-cspc.com:8081/RedseaPlatform/jobs#next"]
  ])("rejects non-canonical CSPC Redsea URL: %s", (_label, url) => {
    const value: any = structuredClone(batch("D01"));
    const cspc = value.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc");
    configureRedsea(cspc.surfaces[0], url);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("rejects CSPC Redsea with a fake official backlink chain", () => {
    const value: any = structuredClone(batch("D01"));
    const cspc = value.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc");
    configureRedsea(cspc.surfaces[0], "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob");
    cspc.surfaces[0].officialChainEvidence[0].url = "https://unrelated.example/";
    cspc.surfaces[0].officialChainHops[0].fromUrl = "https://unrelated.example/";
    cspc.surfaces[0].officialChainHops[0].evidenceSha256 = canonicalEvidenceRecordHash(cspc.surfaces[0].officialChainEvidence[0]);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("includes the exact CSPC Redsea URL semantics in the canonical hash", () => {
    const value: any = structuredClone(batch("D01"));
    const cspc = value.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc");
    configureRedsea(cspc.surfaces[0], "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/officeWebsite.mob");
    const parsed = parseOfficialSourceResearchCandidateBatch(value, NOW);
    const replaced: any = structuredClone(parsed);
    const replacedCspc = replaced.companies.find((item: any) => item.confirmedV3Id === "domestic-cspc");
    replacedCspc.surfaces[0].finalUrl = "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/other.mob";
    expect(canonicalCandidateHash(replaced)).not.toBe(canonicalCandidateHash(parsed));
  });

  it("rejects replacing entry with another URL on the same Workday host", () => {
    const value: any = structuredClone(batch("F01"));
    const surface = value.companies[0].surfaces[0];
    const atsUrl = "https://acme.wd3.myworkdayjobs.com/jobs";
    surface.ats = { kind: "WORKDAY", tenant: { status: "RESOLVED", value: "acme/jobs" } };
    surface.officialEntryUrl = "https://acme.wd3.myworkdayjobs.com/evil";
    surface.finalUrl = atsUrl;
    surface.officialChainEvidence[0].finalUrl = atsUrl;
    surface.officialChainHops[0].toUrl = atsUrl;
    surface.officialChainHops[0].toRole = "ATS_FINAL";
    rebindFirstHop(value);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each([
    ["redirect mechanism from a company page", (hop: any) => { hop.mechanism = "REDIRECT"; }],
    ["link mechanism from a redirect role", (hop: any, evidence: any) => { hop.fromRole = "OFFICIAL_REDIRECT"; evidence.sourceRole = "OFFICIAL_REDIRECT"; }]
  ])("rejects role/mechanism mismatch: %s", (_label, mutate) => {
    const value: any = structuredClone(batch("F01"));
    const surface = value.companies[0].surfaces[0];
    mutate(surface.officialChainHops[0], surface.officialChainEvidence[0]);
    rebindFirstHop(value);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each(["evidenceId", "hopId"])("rejects duplicate %s across companies", (field) => {
    const value: any = structuredClone(batch("F01"));
    const first = value.companies[0].surfaces[0];
    const second = value.companies[1].surfaces[0];
    if (field === "evidenceId") {
      second.officialChainEvidence[0].evidenceId = first.officialChainEvidence[0].evidenceId;
      second.officialChainHops[0].evidenceId = first.officialChainEvidence[0].evidenceId;
      value.companies[1].officialDomainProvenance[0].evidenceId = first.officialChainEvidence[0].evidenceId;
      rebindFirstHop({ companies: [value.companies[1]] });
    } else {
      second.officialChainHops[0].hopId = first.officialChainHops[0].hopId;
      second.entryHopId = first.officialChainHops[0].hopId;
    }
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each(["evidenceId", "hopId"])("rejects duplicate %s across surfaces", (_field) => {
    const value: any = structuredClone(batch("F01"));
    const duplicate = structuredClone(value.companies[0].surfaces[0]);
    duplicate.surfaceId = `${duplicate.surfaceId}-second`;
    duplicate.channels[0].channelId = `${duplicate.channels[0].channelId}-second`;
    value.companies[0].surfaces.push(duplicate);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it.each([
    ["discontinuous", (surface: any) => { surface.officialChainHops.push({ ...surface.officialChainHops[0], hopId: "hop-2", fromUrl: "https://unrelated.example/", fromRole: "CAREERS_OFFICIAL_PAGE" }); }],
    ["wrong terminal", (surface: any) => { surface.officialChainHops[0].toUrl = "https://unrelated.example/"; }],
    ["tampered evidence", (surface: any) => { surface.officialChainEvidence[0].fact = "tampered"; }],
    ["fake evidence id", (surface: any) => { surface.officialChainHops[0].evidenceId = "fake"; }]
  ])("rejects %s official chain", (_label, mutate) => {
    const value: any = structuredClone(batch("F01"));
    mutate(value.companies[0].surfaces[0]);
    expect(() => parseOfficialSourceResearchCandidateBatch(value, NOW)).toThrow();
  });

  it("rejects raw candidate schema variants instead of silently normalizing them", () => {
    const rawVariants = [
      { companies: [] },
      { batchId: "F01", companies: [] },
      { schemaVersion: "raw-candidate-v0", batchId: "F01", companies: [] },
      { schemaVersion: "phase2-official-source-research-candidate-v1", batchId: "D02", companies: [], unknown: true },
    ];
    for (const value of rawVariants) expect(validateOfficialSourceResearchCandidateJson(JSON.stringify(value), NOW)).toMatchObject({ ok: false });
  });

  it("hashes reordering identically and replacements differently", () => {
    const canonical = parseOfficialSourceResearchCandidateBatch(batch("F01"), NOW);
    const reordered: any = structuredClone(canonical);
    reordered.companies.reverse();
    reordered.companies[0].surfaces.reverse();
    reordered.companies[0].surfaces[0].channels.reverse();
    reordered.companies[0].surfaces[0].officialChainEvidence.reverse();
    expect(canonicalCandidateHash(reordered)).toBe(canonicalCandidateHash(canonical));
    const replaced: any = structuredClone(canonical);
    replaced.companies[0].surfaces[0].channels[0].channelId = "replacement";
    expect(canonicalCandidateHash(replaced)).not.toBe(canonicalCandidateHash(canonical));
    for (const mutate of [
      (value: any) => { value.companies[0].globalName = "replacement"; },
      (value: any) => { value.companies[0].surfaces[0].surfaceId = "replacement"; },
      (value: any) => { value.companies[0].surfaces[0].officialChainEvidence[0].fact = "replacement"; }
    ]) {
      const value: any = structuredClone(canonical); mutate(value);
      expect(canonicalCandidateHash(value)).not.toBe(canonicalCandidateHash(canonical));
    }
  });

  it("hashes equal-prefix evidence records independently of input order", () => {
    const canonical: any = parseOfficialSourceResearchCandidateBatch(batch("F01"), NOW);
    const surface = canonical.companies[0].surfaces[0];
    const extra = { ...surface.officialChainEvidence[0], evidenceId: `${surface.officialChainEvidence[0].evidenceId}-z`,
      fact: `${surface.officialChainEvidence[0].fact} z` };
    surface.officialChainEvidence.push(extra);
    const reversed = structuredClone(canonical);
    reversed.companies[0].surfaces[0].officialChainEvidence.reverse();
    expect(canonicalCandidateHash(reversed)).toBe(canonicalCandidateHash(canonical));
    reversed.companies[0].surfaces[0].officialChainEvidence[0].httpStatus = 201;
    expect(canonicalCandidateHash(reversed)).not.toBe(canonicalCandidateHash(canonical));
  });

  it("returns safe diagnostics without echoing credential-bearing input", () => {
    const result = validateOfficialSourceResearchCandidateJson('{"password":"secret-value"}', NOW);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
