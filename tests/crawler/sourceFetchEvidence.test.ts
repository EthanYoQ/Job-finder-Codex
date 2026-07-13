import { access, chmod, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPageTraceSha256,
  canonicalStringSetSha256,
  parsePersistentSourceFetchEvidence,
  sha256Bytes
} from "../../src/crawler/sourceFetchEvidence";
import {
  ArtifactArchiveError,
  archiveSourceEvidence,
  verifyArchivedSourceEvidence,
  type ArtifactArchiveRequest
} from "../../src/crawler/artifactArchive";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "job-finder-task5c-"));
  temporaryRoots.push(root);
  return root;
}

function validEvidence() {
  return {
    captureTool: { name: "undici", version: "7.1.0" },
    artifacts: [
      {
        id: "artifact-1",
        logicalKey: "page-1",
        kind: "ATS_API_RESPONSE",
        channelId: "social",
        requestedUrl: "https://jobs.example.test/api?page=1",
        finalUrl: "https://jobs.example.test/api?page=1",
        httpStatus: 200,
        contentType: "application/json; charset=utf-8",
        capturedAt: "2026-07-10T10:00:00.000Z",
        body: "{\"total\":2,\"ids\":[\"a\",\"b\"]}",
        extractorLocator: "$.total"
      }
    ],
    pages: [
      {
        sequence: 0,
        artifactLogicalKey: "page-1",
        channelId: "social",
        requestedPage: 1,
        returnedPage: 1,
        rawJobIds: ["b", "a"],
        validJobIds: ["a", "b"],
        declaredTotal: 2,
        nextPageSignalBefore: "1",
        nextPageSignalAfter: null,
        termination: "DECLARED_TOTAL_REACHED",
        anomalyCodes: [],
        capturedAt: "2026-07-10T10:00:00.000Z"
      }
    ],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT",
      value: 2,
      artifactLogicalKey: "page-1",
      extractorLocator: "$.total",
      scope: "CHANNEL",
      channelId: "social"
    },
    fetchCounts: {
      rawCount: 2,
      parsedCount: 2,
      validCount: 2,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  };
}

function request(root: string): ArtifactArchiveRequest {
  const evidence = parsePersistentSourceFetchEvidence(validEvidence());
  return {
    workspaceRoot: root,
    releaseCandidateId: "p0-rc-test-001",
    batchId: "batch-1",
    sourceId: "source-1",
    sourceResultId: "source-result-1",
    evidenceSubdirectory: "phase-1/task-5c-smoke",
    captureTool: evidence.captureTool,
    artifacts: evidence.artifacts
  };
}

const EVIDENCE_SUBDIRECTORY = "phase-1/task-5c-smoke";

describe("persistent source fetch evidence", () => {
  it("accepts only an explicitly typed supporting-artifact-only failure with no pages or completeness", () => {
    const { declaredCompleteness: _declaredCompleteness, ...base } = validEvidence();
    const supporting = {
      ...base,
      pages: [],
      supportingArtifactOnlyFailure: { code: "ROOT_RESPONSE_FAILED" },
      fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
      fetchLosses: []
    };
    expect(parsePersistentSourceFetchEvidence(supporting)).toMatchObject({
      pages: [], supportingArtifactOnlyFailure: { code: "ROOT_RESPONSE_FAILED" }
    });
    for (const mutation of [
      { supportingArtifactOnlyFailure: undefined },
      { declaredCompleteness: validEvidence().declaredCompleteness },
      { artifacts: [{ ...supporting.artifacts[0], kind: "PAGINATION_PAGE" }] },
      { fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 } },
      { fetchLosses: [{ stage: "PARSE", reason: "bad", rawLocator: "root", details: { code: "BAD" } }] }
    ]) {
      expect(() => parsePersistentSourceFetchEvidence({ ...supporting, ...mutation })).toThrow();
    }
  });
  it("parses truthful fetch evidence without declared completeness", () => {
    const { declaredCompleteness: _declared, ...input } = validEvidence();
    expect(() => parsePersistentSourceFetchEvidence(input)).not.toThrow();
  });

  it("rejects an empty page trace", () => {
    const input = validEvidence();
    input.pages = [];
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/page/i);
  });

  it("rejects the legacy adapter-stage accounting contract", () => {
    const input = validEvidence() as unknown as Record<string, unknown>;
    input.fetchCounts = { ...input.fetchCounts as object, normalizedCount: 2, dedupeOutputCount: 2 };
    expect(() => parsePersistentSourceFetchEvidence(input))
      .toThrow(/normalized|dedupe|fetchCounts|unknown/i);
  });

  it("rejects fetch loss stage and counter mismatches", () => {
    const invalidStage = validEvidence();
    (invalidStage.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "NORMALIZATION",
      reason: "NORMALIZATION_FAILURE",
      rawLocator: "page-1[0]",
      details: { code: "MISSING_REQUIRED_FIELD", field: "officialTitle" }
    });
    expect(() => parsePersistentSourceFetchEvidence(invalidStage)).toThrow(/stage|PARSE|VALIDATION/i);

    const mismatch = validEvidence();
    (mismatch.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE",
      reason: "PARSE_FAILURE",
      rawLocator: "page-1[0]",
      details: { code: "MISSING_REQUIRED_FIELD", field: "officialTitle" }
    });
    expect(() => parsePersistentSourceFetchEvidence(mismatch)).toThrow(/loss|discard|count/i);
  });

  it("requires every page to reference a network artifact with the exact channel", () => {
    const nonNetwork = validEvidence();
    const {
      requestedUrl: _requestedUrl,
      finalUrl: _finalUrl,
      httpStatus: _httpStatus,
      contentType: _contentType,
      ...nonNetworkArtifact
    } = nonNetwork.artifacts[0]!;
    nonNetwork.artifacts.push({
      ...nonNetworkArtifact,
      id: "artifact-ledger",
      logicalKey: "ledger",
      kind: "COMMAND_OUTPUT"
    } as typeof nonNetwork.artifacts[number]);
    nonNetwork.pages[0]!.artifactLogicalKey = "ledger";
    expect(() => parsePersistentSourceFetchEvidence(nonNetwork)).toThrow(/page.*network|network.*page/i);

    const channelMismatch = validEvidence();
    channelMismatch.pages[0]!.channelId = "other-channel";
    expect(() => parsePersistentSourceFetchEvidence(channelMismatch)).toThrow(/page.*channel|channel.*page/i);
  });

  it("rejects duplicate raw or valid page IDs instead of silently canonicalizing", () => {
    const rawDuplicate = validEvidence();
    rawDuplicate.pages[0]!.rawJobIds = ["a", "a", "b"];
    expect(() => parsePersistentSourceFetchEvidence(rawDuplicate)).toThrow(/raw.*duplicate|duplicate.*raw/i);
    const validDuplicate = validEvidence();
    validDuplicate.pages[0]!.validJobIds = ["a", "b", "b"];
    expect(() => parsePersistentSourceFetchEvidence(validDuplicate)).toThrow(/valid.*duplicate|duplicate.*valid/i);
  });

  it("strictly parses transport evidence and preserves explicit global scope", () => {
    const base = validEvidence();
    const { channelId: _channelId, ...completeness } = base.declaredCompleteness;
    const global = {
      ...base,
      artifacts: base.artifacts.map(({ channelId: _artifactChannelId, ...artifact }) => artifact),
      pages: base.pages.map(({ channelId: _pageChannelId, ...page }) => page),
      declaredCompleteness: { ...completeness, scope: "GLOBAL_UNFILTERED" }
    };
    expect(parsePersistentSourceFetchEvidence(global).declaredCompleteness!.scope)
      .toBe("GLOBAL_UNFILTERED");
  });

  it.each(["headers", "requestHeaders", "cookie", "authorization", "secret", "browserStorage"])(
    "rejects unknown persistent secret/header key %s",
    (field) => {
      const input = validEvidence() as Record<string, unknown>;
      input[field] = "must-not-persist";
      expect(() => parsePersistentSourceFetchEvidence(input)).toThrow();
    }
  );

  it("rejects header fields nested inside a persistent artifact", () => {
    const input = validEvidence();
    Object.assign(input.artifacts[0]!, { headers: { "set-cookie": "secret" } });
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow();
  });

  it.each([
    "headers", "requestHeaders", "responseHeaders", "authorization", "proxy-authorization",
    "cookie", "set-cookie", "token", "accessToken", "refreshToken", "password", "secret",
    "browserStorage", "localStorage", "sessionStorage"
  ])("rejects deeply nested sensitive loss detail key %s without echoing its value", (key) => {
    const input = validEvidence();
    (input.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE",
      reason: "invalid record",
      rawLocator: "page-1[0]",
      details: { safe: [{ nested: { [key]: "TOP-SECRET-VALUE" } }] }
    });
    let caught: unknown;
    try { parsePersistentSourceFetchEvidence(input); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain("TOP-SECRET-VALUE");
    expect(String(caught)).toMatch(/forbidden|sensitive|details/i);
  });

  it.each([
    ["undefined", undefined],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["bigint", BigInt(1)],
    ["nonfinite", Number.POSITIVE_INFINITY],
    ["date", new Date("2026-07-10T00:00:00.000Z")]
  ])("rejects non-JSON-safe loss details: %s", (_label, details) => {
    const input = validEvidence();
    (input.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE", reason: "bad", rawLocator: "x", details
    });
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/JSON|details/i);
  });

  it("rejects cyclic and prototype-polluted loss details", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const details of [cyclic, Object.create({ polluted: true }), JSON.parse('{"__proto__":{"polluted":true}}')]) {
      const input = validEvidence();
      (input.fetchLosses as Array<Record<string, unknown>>).push({
        stage: "PARSE", reason: "bad", rawLocator: "x", details
      });
      expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/JSON|details|prototype/i);
    }
  });

  it("rejects hidden, accessor, symbol, and array-extra detail fields", () => {
    const hidden = {};
    Object.defineProperty(hidden, "secret", { value: "TOP-SECRET-VALUE", enumerable: false });
    const accessor = {};
    Object.defineProperty(accessor, "safe", { get: () => "value", enumerable: true });
    const symbolKey = { [Symbol("secret")]: "TOP-SECRET-VALUE" };
    const arrayExtra = [] as unknown as unknown[] & Record<string, unknown>;
    arrayExtra.headers = "TOP-SECRET-VALUE";
    for (const details of [hidden, accessor, symbolKey, arrayExtra]) {
      const input = validEvidence();
      (input.fetchLosses as Array<Record<string, unknown>>).push({
        stage: "PARSE", reason: "bad", rawLocator: "x", details
      });
      expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/JSON|details|secret/i);
    }
  });

  it("accepts only the strict redacted machine-metadata loss DTO", () => {
    const input = validEvidence();
    input.fetchCounts.rawCount = 3;
    input.fetchCounts.parseDiscardCount = 1;
    (input.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE",
      reason: "bad",
      rawLocator: "x",
      details: {
        code: "MISSING_REQUIRED_FIELD",
        field: "officialTitle",
        pageSequence: 0,
        recordIndex: 1,
        noteCode: "FIELD_REQUIRED"
      }
    });
    expect(parsePersistentSourceFetchEvidence(input).fetchLosses[0]!.details).toEqual({
      code: "MISSING_REQUIRED_FIELD",
      field: "officialTitle",
      pageSequence: 0,
      recordIndex: 1,
      noteCode: "FIELD_REQUIRED"
    });
  });

  it.each([
    "bearer", "bearerToken", "authorizationHeader", "clientSecret", "apiKey", "x-access-token"
  ])("strictly rejects non-DTO loss detail field %s", (key) => {
    const input = validEvidence();
    (input.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE", reason: "bad", rawLocator: "x",
      details: { code: "PARSE_FAILURE", [key]: "TOP-SECRET-VALUE" }
    });
    let caught: unknown;
    try { parsePersistentSourceFetchEvidence(input); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain("TOP-SECRET-VALUE");
  });

  it.each([
    { code: "BEARER_SECRET" },
    { code: "PARSE_FAILURE", noteCode: "CLIENT_SECRET_PRESENT" },
    { code: "PARSE_FAILURE", field: "Bearer example-placeholder" }
  ])("rejects sensitive or free-form strings even in allowlisted DTO fields", (details) => {
    const input = validEvidence();
    (input.fetchLosses as Array<Record<string, unknown>>).push({
      stage: "PARSE", reason: "bad", rawLocator: "x", details
    });
    let caught: unknown;
    try { parsePersistentSourceFetchEvidence(input); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain("TOP-SECRET-VALUE");
  });

  it.each([
    ["credential URL", { requestedUrl: "https://user:placeholder@jobs.example.test/api" }],
    ["non-http URL", { finalUrl: "file:///tmp/jobs.json" }],
    ["invalid status", { httpStatus: 99 }],
    ["invalid content type", { contentType: "bad\ncontent-type" }],
    ["invalid time", { capturedAt: "2026-07-10 10:00:00" }],
    ["empty tool", null],
    ["empty locator", { extractorLocator: "  " }]
  ])("rejects %s", (_label, mutation) => {
    const input = validEvidence();
    if (mutation === null) input.captureTool.name = "";
    else Object.assign(input.artifacts[0]!, mutation);
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow();
  });

  it.each(["access_token", "api_key", "client_secret", "authorization", "refresh-token"])(
    "rejects sensitive URL query parameter %s",
    (parameter) => {
      const input = validEvidence();
      input.artifacts[0]!.requestedUrl = `https://jobs.example.test/api?${parameter}=TOP-SECRET-VALUE`;
      expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/URL|query|credential|sensitive/i);
    }
  );

  it.each(["pageToken", "x-api-key", "oauth_state", "sessionId", "signature"])(
    "rejects sensitive URL query key fragment %s",
    (parameter) => {
      const input = validEvidence();
      input.artifacts[0]!.requestedUrl = `https://jobs.example.test/api?${parameter}=opaque`;
      expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/URL|query|credential|sensitive/i);
    }
  );

  it.each([
    "https://jobs.example.test/api?q=Bearer%20TOP-SECRET-VALUE",
    "https://jobs.example.test/api?q=Basic%20dXNlcjpwYXNz",
    "https://jobs.example.test/api?q=client_secret%3DTOP-SECRET-VALUE",
    "https://jobs.example.test/api?q=safe#access_token=TOP-SECRET-VALUE",
    "https://jobs.example.test/api?q=safe#Bearer%20TOP-SECRET-VALUE"
  ])("rejects sensitive URL query or fragment content without echoing it", (url) => {
    const input = validEvidence();
    input.artifacts[0]!.requestedUrl = url;
    let caught: unknown;
    try { parsePersistentSourceFetchEvidence(input); } catch (error) { caught = error; }
    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain("TOP-SECRET-VALUE");
  });

  it("hashes every accepted URL query value and drops fragments in the parsed DTO", () => {
    const input = validEvidence();
    input.artifacts[0]!.requestedUrl =
      "https://jobs.example.test/api?page=1&location=Shanghai&cursor=opaque-value#jobs";
    const artifact = parsePersistentSourceFetchEvidence(input).artifacts[0]!;
    const sanitized = new URL(artifact.requestedUrl!);
    expect(sanitized.hash).toBe("");
    expect(artifact.requestedUrl).not.toContain("Shanghai");
    expect(artifact.requestedUrl).not.toContain("opaque-value");
    expect([...sanitized.searchParams.values()]).toHaveLength(3);
    for (const value of sanitized.searchParams.values()) {
      expect(value).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("requires official totals to reference a network artifact and locator", () => {
    const input = validEvidence();
    input.artifacts[0]!.kind = "COMMAND_OUTPUT";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/network artifact/i);
    input.artifacts[0]!.kind = "ATS_API_RESPONSE";
    input.declaredCompleteness.artifactLogicalKey = "missing";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/artifact/i);
  });

  it("requires the official-total locator to match the referenced artifact", () => {
    const input = validEvidence();
    input.declaredCompleteness.extractorLocator = "$.unrelated";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/locator/i);
  });

  it("rejects source fields on GLOBAL_UNFILTERED completeness", () => {
    const input = validEvidence();
    input.declaredCompleteness.scope = "GLOBAL_UNFILTERED";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/GLOBAL_UNFILTERED/i);
  });

  it("binds SOURCE completeness only to artifacts without channel identity", () => {
    const input = validEvidence();
    const { channelId: _channelId, ...declared } = input.declaredCompleteness;
    input.declaredCompleteness = { ...declared, scope: "SOURCE" } as typeof input.declaredCompleteness;
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/SOURCE.*channel|channel.*SOURCE/i);
  });

  it("binds CHANNEL completeness to the exact artifact channel", () => {
    const input = validEvidence();
    input.declaredCompleteness.channelId = "other-channel";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/CHANNEL.*artifact|artifact.*channel/i);
  });

  it("binds GLOBAL_UNFILTERED completeness to an unchannelled artifact", () => {
    const input = validEvidence();
    const { channelId: _channelId, ...declared } = input.declaredCompleteness;
    input.declaredCompleteness = { ...declared, scope: "GLOBAL_UNFILTERED" } as typeof input.declaredCompleteness;
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/GLOBAL_UNFILTERED.*channel|channel.*GLOBAL_UNFILTERED/i);
  });

  it("validates contiguous page sequence and artifact references", () => {
    const input = validEvidence();
    input.pages[0]!.sequence = 1;
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/contiguous.*zero/i);
    input.pages[0]!.sequence = 0;
    input.pages[0]!.artifactLogicalKey = "missing";
    expect(() => parsePersistentSourceFetchEvidence(input)).toThrow(/page.*artifact/i);
  });

  it("hashes string sets bytewise and page traces in sequence order", () => {
    expect(canonicalStringSetSha256(["é", "a", "中"]))
      .toBe(canonicalStringSetSha256(["中", "é", "a", "a"]));
    const pages = parsePersistentSourceFetchEvidence(validEvidence()).pages;
    const second = { ...pages[0]!, sequence: 1, requestedPage: 2, returnedPage: 2 };
    expect(canonicalPageTraceSha256([pages[0]!, second]))
      .not.toBe(canonicalPageTraceSha256([
        { ...second, sequence: 0 },
        { ...pages[0]!, sequence: 1 }
      ]));
    expect(() => canonicalPageTraceSha256([second, pages[0]!])).toThrow(/contiguous.*zero/i);
  });

  it("rejects unpaired UTF-16 surrogates before canonical hashing", () => {
    expect(() => canonicalStringSetSha256(["safe", "\ud800"])).toThrow(/Unicode|surrogate/i);
    const pages = parsePersistentSourceFetchEvidence(validEvidence()).pages;
    expect(() => canonicalPageTraceSha256([{ ...pages[0]!, rawJobIds: ["\udfff"] }]))
      .toThrow(/Unicode|surrogate/i);
    expect(() => canonicalPageTraceSha256([{ ...pages[0]!, artifactLogicalKey: "page-\ud800" }]))
      .toThrow(/Unicode|surrogate/i);
  });
});

describe("RC-bound artifact archive", () => {
  it.runIf(process.platform==="linux")("detects same-process parent replacement before formal promotion",async()=>{
    const root=await workspace();
    const base=request(root);
    await expect(archiveSourceEvidence({...base,formalRelease:true,faults:{afterStagingWrite:async()=>{
      const tuple=path.join(root,"outputs","p0-rc",base.releaseCandidateId,EVIDENCE_SUBDIRECTORY,"artifacts",base.batchId,base.sourceId,base.sourceResultId);
      await rename(tuple,`${tuple}.replaced`);
      await mkdir(tuple,{mode:0o700});
    }}})).rejects.toThrow(/identity drift/i);
  });

  it.runIf(process.platform==="linux")("rejects a world-writable formal private archive root",async()=>{
    const root=await workspace();
    const base=request(root);
    const rcRoot=path.join(root,"outputs","p0-rc",base.releaseCandidateId);
    await mkdir(rcRoot,{recursive:true,mode:0o700});
    await chmod(rcRoot,0o777);
    await expect(archiveSourceEvidence({...base,formalRelease:true})).rejects.toThrow(/writable|0700/i);
  });
  it("writes exact UTF-8 bytes and verifies repository metadata", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const bytes = Buffer.from(validEvidence().artifacts[0]!.body, "utf8");
    expect(archived.artifacts[0]).toMatchObject(sha256Bytes(bytes));
    await expect(verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: archived.artifacts
    })).resolves.toEqual(archived.artifacts);
    expect(await readFile(path.join(root, archived.artifacts[0]!.path))).toEqual(bytes);
    await expect(access(path.join(
      root, "outputs", "p0-rc", "p0-rc-test-001", "phase-1", "task-5c-smoke", ".staging"
    ))).rejects.toThrow();
  });

  it("archives validated exact and redacted body provenance without opening the metadata boundary", async () => {
    const exact = request(await workspace());
    Object.assign(exact.artifacts[0]!, { bodyRepresentation: "EXACT" as const });
    await expect(archiveSourceEvidence(exact)).resolves.toMatchObject({
      artifacts: [{ byteCount: Buffer.byteLength(String(exact.artifacts[0]!.body), "utf8") }]
    });

    const redacted = request(await workspace());
    Object.assign(redacted.artifacts[0]!, {
      body: "[REDACTED_CREDENTIAL_MATERIAL]",
      bodyRepresentation: "REDACTED" as const,
      rawBodySha256: "a".repeat(64),
      redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: 1 }]
    });
    const redactedArchived = await archiveSourceEvidence(redacted);
    expect(redactedArchived).toMatchObject({ artifacts: [{
      byteCount: Buffer.byteLength(String(redacted.artifacts[0]!.body), "utf8"),
      bodyRepresentation: "REDACTED",
      rawBodySha256: "a".repeat(64),
      redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: 1 }]
    }] });
    await expect(verifyArchivedSourceEvidence({
      workspaceRoot: redacted.workspaceRoot,
      releaseCandidateId: redacted.releaseCandidateId,
      batchId: redacted.batchId,
      sourceId: redacted.sourceId,
      sourceResultId: redacted.sourceResultId,
      evidenceSubdirectory: redacted.evidenceSubdirectory,
      artifacts: redactedArchived.artifacts
    })).resolves.toEqual(redactedArchived.artifacts);

    const attacked = request(await workspace());
    attacked.artifacts = [{ ...attacked.artifacts[0]!, headers: { authorization: "forbidden" } } as never];
    await expect(archiveSourceEvidence(attacked)).rejects.toThrow(/unknown own property/i);
  });

  it("rejects traversal, duplicate IDs, logical keys, and final paths before writes", async () => {
    const root = await workspace();
    const base = request(root);
    await expect(archiveSourceEvidence({ ...base, evidenceSubdirectory: "../escape" }))
      .rejects.toThrow(/subdirectory|traversal/i);
    const duplicate = { ...base.artifacts[0]!, logicalKey: "other" };
    await expect(archiveSourceEvidence({ ...base, artifacts: [...base.artifacts, duplicate] }))
      .rejects.toThrow(/artifact id/i);
    const duplicateKey = { ...base.artifacts[0]!, id: "artifact-2" };
    await expect(archiveSourceEvidence({ ...base, artifacts: [...base.artifacts, duplicateKey] }))
      .rejects.toThrow(/logical key/i);
    await expect(access(path.join(root, "outputs"))).rejects.toThrow();
  });

  it.each([".", "./child", "child/.", "child//nested", "child/../nested", "child/", "/absolute"])(
    "rejects non-canonical evidence subdirectory %s",
    async (evidenceSubdirectory) => {
      const root = await workspace();
      await expect(archiveSourceEvidence({ ...request(root), evidenceSubdirectory }))
        .rejects.toThrow(/subdirectory|canonical|segment|absolute/i);
    }
  );

  it.each(["phase/child.", "phase/CON", "phase/x:y"])(
    "rejects Windows-unsafe evidence segment %s before any write",
    async (evidenceSubdirectory) => {
      const root = await workspace();
      await expect(archiveSourceEvidence({ ...request(root), evidenceSubdirectory }))
        .rejects.toThrow(/Windows|canonical|segment|reserved|forbidden/i);
      await expect(access(path.join(root, "outputs"))).rejects.toThrow();
    }
  );

  it.each([
    ["artifact id", { artifactId: "CON" }],
    ["logical key", { logicalKey: "NUL.txt" }],
    ["tuple source", { sourceId: "COM1" }],
    ["trailing dot", { artifactId: "artifact." }]
  ])("rejects Windows-unsafe %s before any write", async (_label, mutation) => {
    const root = await workspace();
    const base = request(root);
    const unsafe = mutation as { artifactId?: string; logicalKey?: string; sourceId?: string };
    if (unsafe.artifactId) base.artifacts[0]!.id = unsafe.artifactId;
    if (unsafe.logicalKey) base.artifacts[0]!.logicalKey = unsafe.logicalKey;
    if (unsafe.sourceId) base.sourceId = unsafe.sourceId;
    await expect(archiveSourceEvidence(base)).rejects.toThrow(/invalid|Windows|reserved|canonical/i);
    await expect(access(path.join(root, "outputs"))).rejects.toThrow();
  });

  it.each([
    ["artifact id with spaces", { artifactId: "artifact id" }],
    ["non-ASCII logical key", { logicalKey: "职位" }],
    ["percent-encoded tuple", { sourceId: "%2e%2e" }]
  ])("rejects non-grammar identifier %s before any write", async (_label, mutation) => {
    const root = await workspace();
    const base = request(root);
    const invalid = mutation as { artifactId?: string; logicalKey?: string; sourceId?: string };
    if (invalid.artifactId) base.artifacts[0]!.id = invalid.artifactId;
    if (invalid.logicalKey) base.artifacts[0]!.logicalKey = invalid.logicalKey;
    if (invalid.sourceId) base.sourceId = invalid.sourceId;
    await expect(archiveSourceEvidence(base)).rejects.toThrow(/identifier|grammar|canonical|invalid/i);
    await expect(access(path.join(root, "outputs"))).rejects.toThrow();
  });

  it("never overwrites or reuses an existing immutable final path", async () => {
    const root = await workspace();
    const first = await archiveSourceEvidence(request(root));
    const original = await readFile(path.join(root, first.artifacts[0]!.path));
    await expect(archiveSourceEvidence(request(root))).rejects.toThrow(/exists|immutable/i);
    expect(await readFile(path.join(root, first.artifacts[0]!.path))).toEqual(original);
  });

  it("rejects empty bodies unless the artifact kind is explicitly allowed", async () => {
    const root = await workspace();
    const base = request(root);
    const empty = {
      ...base.artifacts[0]!,
      kind: "COMMAND_OUTPUT" as const,
      body: ""
    };
    delete empty.requestedUrl;
    delete empty.finalUrl;
    delete empty.httpStatus;
    delete empty.contentType;
    await expect(archiveSourceEvidence({ ...base, artifacts: [empty] })).rejects.toThrow(/empty/i);
    await expect(archiveSourceEvidence({
      ...base,
      artifacts: [empty],
      zeroByteArtifactKinds: ["COMMAND_OUTPUT"]
    })).resolves.toMatchObject({ artifacts: [{ byteCount: 0 }] });
  });

  it("cleans staging on write failure and reports retained final orphans after promotion", async () => {
    const root = await workspace();
    const base = request(root);
    await expect(archiveSourceEvidence({ ...base, faults: { afterStagingWrite: () => { throw new Error("write fault"); } } }))
      .rejects.toMatchObject({ orphanedFinalArtifacts: [] });
    const staging = path.join(root, "outputs", "p0-rc", base.releaseCandidateId, base.evidenceSubdirectory, ".staging");
    expect(await readFile(staging).catch(() => null)).toBeNull();

    try {
      await archiveSourceEvidence({ ...base, faults: { afterFinalPromotion: () => { throw new Error("rename fault"); } } });
      throw new Error("expected injected fault");
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactArchiveError);
      const archiveError = error as ArtifactArchiveError;
      expect(archiveError.orphanedFinalArtifacts).toHaveLength(1);
      const orphan = archiveError.orphanedFinalArtifacts[0]!;
      expect(await readFile(path.join(root, orphan.path))).toHaveLength(orphan.byteCount);
    }
  });

  it("rejects tamper, missing file, tuple mismatch, duplicate metadata, and symlink escape", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const verify = (artifacts = archived.artifacts, overrides = {}) => verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts,
      ...overrides
    });
    const final = path.join(root, archived.artifacts[0]!.path);
    await writeFile(final, "tampered");
    await expect(verify()).rejects.toThrow(/byte count|sha/i);
    await rm(final);
    await expect(verify()).rejects.toThrow(/missing/i);
    await expect(verify(archived.artifacts, { sourceId: "other" })).rejects.toThrow(/tuple|path/i);
    await expect(verify([...archived.artifacts, archived.artifacts[0]!])).rejects.toThrow(/duplicate/i);

    const outside = await mkdtemp(path.join(tmpdir(), "job-finder-outside-"));
    temporaryRoots.push(outside);
    const tupleDirectory = path.dirname(final);
    await rm(tupleDirectory, { recursive: true, force: true });
    await writeFile(path.join(outside, path.basename(final)), "outside");
    await symlink(outside, tupleDirectory, process.platform === "win32" ? "junction" : "dir");
    await expect(verify()).rejects.toThrow(/symlink|reparse|escape/i);
  });

  it("rejects non-canonical and unbound metadata paths before reading", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const artifact = archived.artifacts[0]!;
    const verify = (pathValue: string) => verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: [{ ...artifact, path: pathValue }]
    });
    await expect(verify(artifact.path.replace("/artifacts/", "/ghost/../artifacts/")))
      .rejects.toThrow(/canonical|exact path/i);
    await expect(verify(artifact.path.replace(EVIDENCE_SUBDIRECTORY, "phase-1/unbound-root")))
      .rejects.toThrow(/canonical|exact path|evidence/i);
    await expect(verify(artifact.path.replaceAll("/", "\\")))
      .rejects.toThrow(/canonical|exact path/i);
    await expect(verify(artifact.path.replace(/[^/]+$/, "other--basename.json")))
      .rejects.toThrow(/canonical|exact path/i);
  });

  it("strictly validates archived metadata before reading", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const verify = (artifacts: unknown[]) => verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: artifacts as never
    });
    const missing = { ...archived.artifacts[0] } as Record<string, unknown>;
    delete missing.sha256;
    await expect(verify([missing])).rejects.toThrow(/metadata.*sha256/i);
    const unknown = { ...archived.artifacts[0], headers: { authorization: "example-placeholder" } };
    await expect(verify([unknown])).rejects.toThrow(/metadata.*unknown.*property/i);
  });

  it("rejects archived metadata array own-property attacks", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const verify = (artifacts: unknown) => verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: artifacts as never
    });
    for (const attack of ["extra", "symbol", "hidden"] as const) {
      const artifacts = [...archived.artifacts] as unknown[] & Record<PropertyKey, unknown>;
      if (attack === "extra") artifacts.extra = "value";
      if (attack === "symbol") artifacts[Symbol("extra")] = "value";
      if (attack === "hidden") Object.defineProperty(artifacts, "hidden", { value: "value" });
      await expect(verify(artifacts)).rejects.toThrow(/array|own|property|metadata/i);
    }
  });

  it("rejects archived metadata object hidden, symbol, accessor, and unknown properties", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const verify = (artifact: unknown) => verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: [artifact] as never
    });
    const hidden = { ...archived.artifacts[0] };
    Object.defineProperty(hidden, "hidden", { value: "value" });
    await expect(verify(hidden)).rejects.toThrow(/metadata|property|unknown/i);
    const symbol = { ...archived.artifacts[0], [Symbol("hidden")]: "value" };
    await expect(verify(symbol)).rejects.toThrow(/metadata|property|unknown/i);
    const accessor = { ...archived.artifacts[0] };
    Object.defineProperty(accessor, "sha256", { enumerable: true, get: () => archived.artifacts[0]!.sha256 });
    await expect(verify(accessor)).rejects.toThrow(/metadata|accessor|property/i);
  });

  it("returns sanitized metadata clones rather than caller references", async () => {
    const root = await workspace();
    const archived = await archiveSourceEvidence(request(root));
    const inputArray = archived.artifacts;
    const inputArtifact = inputArray[0]!;
    const inputDate = inputArtifact.capturedAt;
    const verified = await verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: inputArray
    });
    expect(verified).not.toBe(inputArray);
    expect(verified[0]).not.toBe(inputArtifact);
    expect(verified[0]!.capturedAt).not.toBe(inputDate);
    expect(verified[0]!.capturedAt).toEqual(inputDate);
  });

  it("rejects archive request array own-property attacks before any write", async () => {
    const root = await workspace();
    const base = request(root);
    const attacked = base.artifacts as unknown as typeof base.artifacts & Record<PropertyKey, unknown>;
    attacked.extra = "value";
    await expect(archiveSourceEvidence(base)).rejects.toThrow(/array|own|property/i);
    await expect(access(path.join(root, "outputs"))).rejects.toThrow();
  });

  it("archives and verifies only sanitized URL metadata clones", async () => {
    const root = await workspace();
    const base = request(root);
    base.artifacts[0]!.requestedUrl =
      "https://jobs.example.test/api?page=1&location=Shanghai#jobs";
    base.artifacts[0]!.finalUrl =
      "https://jobs.example.test/api?page=1&location=Shanghai#jobs";
    const archived = await archiveSourceEvidence(base);
    expect(archived.artifacts[0]!.requestedUrl).not.toContain("Shanghai");
    expect(new URL(archived.artifacts[0]!.requestedUrl!).hash).toBe("");
    const verified = await verifyArchivedSourceEvidence({
      workspaceRoot: root,
      releaseCandidateId: "p0-rc-test-001",
      batchId: "batch-1",
      sourceId: "source-1",
      sourceResultId: "source-result-1",
      evidenceSubdirectory: EVIDENCE_SUBDIRECTORY,
      artifacts: archived.artifacts
    });
    expect(verified[0]!.requestedUrl).not.toContain("Shanghai");
    expect(verified[0]!.requestedUrl).toBe(archived.artifacts[0]!.requestedUrl);
  });
});
