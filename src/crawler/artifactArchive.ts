import { constants } from "node:fs";
import {
  access,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  rmdir,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  assertEvidenceIdentifier,
  assertWindowsCanonicalSegment,
  parseArtifactArchiveDrafts,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type CaptureTool,
  type SourceFetchArtifactDraft
} from "./sourceFetchEvidence";

export interface ArchivedEvidenceArtifact {
  id: string;
  logicalKey: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
  channelId?: string;
  kind: SourceFetchArtifactDraft["kind"];
  requestedUrl?: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  bodyRepresentation?: "EXACT" | "REDACTED";
  rawBodySha256?: string;
  redactionDescriptors?: Array<{
    kind: "CREDENTIAL_MATERIAL" | "UPSTREAM_ERROR_TEXT";
    count: number;
  }>;
  capturedAt: Date;
  sha256: string;
  byteCount: number;
  path: string;
  extractorLocator: string;
  captureToolName: string;
  captureToolVersion: string;
}

export interface ArtifactArchiveFaults {
  afterStagingWrite?: (context: { artifactId: string; stagingPath: string }) => void | Promise<void>;
  afterFinalPromotion?: (context: { artifact: ArchivedEvidenceArtifact }) => void | Promise<void>;
}

export interface ArtifactArchiveRequest {
  workspaceRoot: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
  evidenceSubdirectory: string;
  captureTool: CaptureTool;
  artifacts: SourceFetchArtifactDraft[];
  zeroByteArtifactKinds?: SourceFetchArtifactDraft["kind"][];
  faults?: ArtifactArchiveFaults;
  formalRelease?: boolean;
}

export interface VerifyArchivedEvidenceRequest {
  workspaceRoot: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
  evidenceSubdirectory: string;
  artifacts: ArchivedEvidenceArtifact[];
  formalRelease?: boolean;
}

export class ArtifactArchiveError extends Error {
  constructor(message: string, readonly orphanedFinalArtifacts: ArchivedEvidenceArtifact[], options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactArchiveError";
  }
}

export async function archiveSourceEvidence(request: ArtifactArchiveRequest): Promise<{
  artifacts: ArchivedEvidenceArtifact[];
  orphanedFinalArtifacts: [];
}> {
  validateTuple(request);
  const canonicalSubdirectory = validateEvidenceSubdirectory(request.evidenceSubdirectory);
  assertStrictDenseArray(request.artifacts, "archive request artifacts");
  for (const artifact of request.artifacts) {
    strictOwnDataRecord(artifact, ARTIFACT_DRAFT_KEYS, "archive request artifact");
  }
  if (request.zeroByteArtifactKinds !== undefined) {
    assertStrictDenseArray(request.zeroByteArtifactKinds, "zero-byte artifact kinds");
  }
  const parsed = parseArtifactArchiveDrafts({
    captureTool: request.captureTool,
    artifacts: request.artifacts
  });
  assertUniqueDrafts(parsed.artifacts);

  const workspaceRoot = path.resolve(request.workspaceRoot);
  const workspaceReal = await realpath(workspaceRoot);
  if (workspaceReal !== workspaceRoot) {
    throw new ArtifactArchiveError("workspace root must not be a symlink or reparse alias", []);
  }
  const rcRoot = path.join(workspaceRoot, "outputs", "p0-rc", request.releaseCandidateId);
  if(request.formalRelease)await prepareAndValidatePrivateArchiveRoot(workspaceRoot,rcRoot);
  const evidenceRoot = resolveRelativeBelow(
    rcRoot,
    canonicalSubdirectory.split("/").join(path.sep),
    "evidence subdirectory"
  );
  const tupleDirectory = path.join(
    evidenceRoot,
    "artifacts",
    request.batchId,
    request.sourceId,
    request.sourceResultId
  );
  const stagingBase = path.join(evidenceRoot, ".staging");
  const stagingRoot = path.join(stagingBase, `${request.batchId}-${request.sourceId}-${request.sourceResultId}`);
  await assertNoLinksOrEscape(workspaceRoot, rcRoot);
  await assertNoLinksOrEscape(workspaceRoot, evidenceRoot);

  const planned = parsed.artifacts.map((draft) => ({
    draft,
    finalPath: path.join(tupleDirectory, `${draft.id}--${draft.logicalKey}${extensionFor(draft)}`),
    stagingPath: path.join(stagingRoot, `${draft.id}.${process.pid}.${randomSuffix()}.tmp`)
  }));
  assertUnique(planned.map((item) => normalizeForComparison(item.finalPath)), "final path");

  for (const item of planned) {
    if (await exists(item.finalPath)) {
      throw new ArtifactArchiveError(`immutable final artifact already exists: ${item.finalPath}`, []);
    }
  }

  await mkdir(tupleDirectory, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await assertNoLinksOrEscape(workspaceRoot, tupleDirectory);
  await assertNoLinksOrEscape(workspaceRoot, stagingRoot);
  const privateRootIdentity=request.formalRelease?await filesystemIdentity(rcRoot):undefined;
  const tupleParentIdentity=request.formalRelease?await filesystemIdentity(tupleDirectory):undefined;

  const orphaned: ArchivedEvidenceArtifact[] = [];
  const stagingPaths = new Set<string>();
  try {
    for (const item of planned) {
      const bytes = typeof item.draft.body === "string"
        ? Buffer.from(item.draft.body, "utf8")
        : Buffer.from(item.draft.body);
      if (bytes.byteLength === 0 && !request.zeroByteArtifactKinds?.includes(item.draft.kind)) {
        throw new Error(`empty artifact body is forbidden for ${item.draft.logicalKey}`);
      }
      const expected = sha256Bytes(bytes);
      const handle = await open(item.stagingPath, "wx");
      stagingPaths.add(item.stagingPath);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const reread = await readFile(item.stagingPath);
      const verified = sha256Bytes(reread);
      if (verified.byteCount !== expected.byteCount || verified.sha256 !== expected.sha256) {
        throw new Error(`staging verification failed for ${item.draft.logicalKey}`);
      }
      await request.faults?.afterStagingWrite?.({ artifactId: item.draft.id, stagingPath: item.stagingPath });

      if(request.formalRelease){
        await assertFilesystemIdentity(rcRoot,privateRootIdentity!);
        await assertFilesystemIdentity(tupleDirectory,tupleParentIdentity!);
        await validatePrivateArchiveRoot(workspaceRoot,rcRoot);
      }

      const metadata = toMetadata(request, parsed.captureTool, item.draft, item.finalPath, verified);
      try {
        await link(item.stagingPath, item.finalPath);
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new Error(`immutable final artifact already exists: ${item.finalPath}`, { cause: error });
        }
        throw error;
      }
      orphaned.push(metadata);
      if(request.formalRelease){
        await assertFilesystemIdentity(rcRoot,privateRootIdentity!);
        await assertFilesystemIdentity(tupleDirectory,tupleParentIdentity!);
      }
      await request.faults?.afterFinalPromotion?.({ artifact: metadata });
      await unlink(item.stagingPath);
      stagingPaths.delete(item.stagingPath);
    }
    const artifacts = [...orphaned];
    orphaned.length = 0;
    await rm(stagingRoot, { recursive: true, force: true });
    await removeEmptyDirectory(stagingBase);
    return { artifacts, orphanedFinalArtifacts: [] };
  } catch (error) {
    await Promise.all([...stagingPaths].map((stagingPath) => unlink(stagingPath).catch(() => undefined)));
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    await removeEmptyDirectory(stagingBase);
    throw new ArtifactArchiveError(
      `artifact archive failed: ${error instanceof Error ? error.message : String(error)}`,
      orphaned,
      { cause: error }
    );
  }
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error) {
    if (!isNotFound(error) && !isDirectoryNotEmpty(error)) throw error;
  }
}

export async function verifyArchivedSourceEvidence(
  request: VerifyArchivedEvidenceRequest
): Promise<ArchivedEvidenceArtifact[]> {
  validateTuple(request);
  const artifacts = validateArchivedEvidenceMetadata(request);
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const workspaceReal = await realpath(workspaceRoot);
  if (workspaceReal !== workspaceRoot) throw new Error("workspace root symlink/reparse alias is forbidden");
  const rcRoot = path.join(workspaceRoot, "outputs", "p0-rc", request.releaseCandidateId);
  if(request.formalRelease)await validatePrivateArchiveRoot(workspaceRoot,rcRoot);

  for (const artifact of artifacts) {
    if (path.isAbsolute(artifact.path)) throw new Error(`absolute artifact path is forbidden: ${artifact.path}`);
    const absolutePath = path.resolve(workspaceRoot, artifact.path);
    assertBelow(rcRoot, absolutePath, "artifact path");
    const tupleFragment = path.join("artifacts", request.batchId, request.sourceId, request.sourceResultId) + path.sep;
    if (!absolutePath.includes(tupleFragment)) throw new Error(`artifact tuple/path mismatch for ${artifact.id}`);
    await assertNoLinksOrEscape(workspaceRoot, absolutePath);
    try {
      await access(absolutePath, constants.R_OK);
    } catch (error) {
      throw new Error(`artifact file is missing: ${artifact.path}`, { cause: error });
    }
    const real = await realpath(absolutePath);
    assertBelow(rcRoot, real, "artifact real path");
    const actual = sha256Bytes(await readFile(real));
    if (actual.byteCount !== artifact.byteCount) throw new Error(`artifact byte count mismatch: ${artifact.path}`);
    if (actual.sha256 !== artifact.sha256) throw new Error(`artifact SHA-256 mismatch: ${artifact.path}`);
  }
  return artifacts;
}

export function assertVerifiedArchivedEvidenceMetadata(
  request: Omit<VerifyArchivedEvidenceRequest, "workspaceRoot">,
  expectedDrafts: readonly SourceFetchArtifactDraft[]
): void {
  validateArchivedEvidenceMetadata(request, expectedDrafts);
}

function validateArchivedEvidenceMetadata(
  request: Omit<VerifyArchivedEvidenceRequest, "workspaceRoot">,
  expectedDrafts?: readonly SourceFetchArtifactDraft[]
): ArchivedEvidenceArtifact[] {
  validateTupleIdentifiers(request);
  const canonicalSubdirectory = validateEvidenceSubdirectory(request.evidenceSubdirectory);
  const artifacts = validateArchivedArtifacts(request.artifacts);
  assertUnique(artifacts.map((artifact) => artifact.id), "artifact id");
  assertUnique(artifacts.map((artifact) => artifact.logicalKey), "artifact logical key");
  assertUnique(artifacts.map((artifact) => normalizeForComparison(artifact.path)), "artifact path");
  if (expectedDrafts !== undefined && artifacts.length !== expectedDrafts.length) {
    throw new Error("verified archive metadata does not match the exact fetch artifact set");
  }
  const drafts = new Map((expectedDrafts ?? []).map((draft) => [draft.logicalKey, draft]));
  for (const artifact of artifacts) {
    if (artifact.releaseCandidateId !== request.releaseCandidateId || artifact.batchId !== request.batchId ||
        artifact.sourceId !== request.sourceId || artifact.sourceResultId !== request.sourceResultId) {
      throw new Error(`artifact tuple mismatch for ${artifact.id}`);
    }
    const draft = expectedDrafts === undefined ? undefined : drafts.get(artifact.logicalKey);
    const digest = draft === undefined ? undefined : sha256Bytes(
      typeof draft.body === "string" ? Buffer.from(draft.body, "utf8") : Buffer.from(draft.body));
    if (expectedDrafts !== undefined && (!draft || artifact.id !== draft.id ||
        artifact.batchId !== request.batchId || artifact.sourceId !== request.sourceId ||
        artifact.sourceResultId !== request.sourceResultId || artifact.kind !== draft.kind ||
        (artifact.channelId ?? null) !== (draft.channelId ?? null) ||
        (artifact.requestedUrl ?? null) !== (draft.requestedUrl ?? null) ||
        (artifact.finalUrl ?? null) !== (draft.finalUrl ?? null) ||
        (artifact.httpStatus ?? null) !== (draft.httpStatus ?? null) ||
        (artifact.contentType ?? null) !== (draft.contentType ?? null) ||
        (artifact.bodyRepresentation ?? null) !== (draft.bodyRepresentation ?? null) ||
        (artifact.rawBodySha256 ?? null) !== (draft.rawBodySha256 ?? null) ||
        JSON.stringify(artifact.redactionDescriptors ?? null) !==
        JSON.stringify(draft.redactionDescriptors ?? null) ||
        artifact.capturedAt.getTime() !== new Date(draft.capturedAt).getTime() ||
        artifact.extractorLocator !== draft.extractorLocator || artifact.sha256 !== digest!.sha256 ||
        artifact.byteCount !== digest!.byteCount)) {
      throw new Error(`verified archive metadata is not bound to fetch artifact ${artifact.logicalKey}`);
    }
    const expectedPath = canonicalArtifactPath({ releaseCandidateId: request.releaseCandidateId,
      evidenceSubdirectory: canonicalSubdirectory, batchId: request.batchId, sourceId: request.sourceId,
      sourceResultId: request.sourceResultId, artifact });
    if (artifact.path !== expectedPath) {
      throw new Error(`artifact metadata does not use the exact canonical evidence path for ${artifact.id}`);
    }
  }
  return artifacts;
}

type FilesystemIdentity={dev:bigint;ino:bigint;uid:number;mode:number;real:string};
async function filesystemIdentity(target:string):Promise<FilesystemIdentity>{
  const value=await stat(target,{bigint:true});
  return {dev:value.dev,ino:value.ino,uid:Number(value.uid),mode:Number(value.mode)&0o777,real:await realpath(target)};
}
async function assertFilesystemIdentity(target:string,expected:FilesystemIdentity):Promise<void>{
  const actual=await filesystemIdentity(target);
  if(actual.dev!==expected.dev||actual.ino!==expected.ino||actual.uid!==expected.uid||actual.mode!==expected.mode||actual.real!==expected.real){
    throw new Error(`private archive filesystem identity drift detected: ${target}`);
  }
}
async function prepareAndValidatePrivateArchiveRoot(workspaceRoot:string,rcRoot:string):Promise<void>{
  if(process.platform!=="linux"||process.getuid===undefined)throw new Error("FULL_RELEASE artifact archive requires the production Linux trust boundary");
  await mkdir(rcRoot,{recursive:true,mode:0o700});
  await validatePrivateArchiveRoot(workspaceRoot,rcRoot);
}
async function validatePrivateArchiveRoot(workspaceRoot:string,rcRoot:string):Promise<void>{
  if(process.platform!=="linux"||process.getuid===undefined)throw new Error("FULL_RELEASE artifact archive requires the production Linux trust boundary");
  let cursor=rcRoot;
  while(true){
    const links=await lstat(cursor);
    if(links.isSymbolicLink())throw new Error(`private archive ancestor is a symlink: ${cursor}`);
    const value=await filesystemIdentity(cursor);
    if(value.uid!==process.getuid())throw new Error(`private archive ancestor owner mismatch: ${cursor}`);
    if((value.mode&0o022)!==0)throw new Error(`private archive ancestor is group/world writable: ${cursor}`);
    if(cursor===workspaceRoot)break;
    const parent=path.dirname(cursor);
    if(parent===cursor||!path.resolve(cursor).startsWith(`${path.resolve(workspaceRoot)}${path.sep}`))throw new Error("private archive root escapes application root");
    cursor=parent;
  }
  const root=await filesystemIdentity(rcRoot);
  if(root.mode!==0o700)throw new Error("private archive root must have mode 0700");
}

const ARCHIVED_METADATA_KEYS = new Set([
  "id", "logicalKey", "releaseCandidateId", "batchId", "sourceId", "sourceResultId",
  "channelId", "kind", "requestedUrl", "finalUrl", "httpStatus", "contentType",
  "bodyRepresentation", "rawBodySha256", "redactionDescriptors", "capturedAt", "sha256",
  "byteCount", "path", "extractorLocator", "captureToolName", "captureToolVersion"
]);
const ARCHIVED_REQUIRED_KEYS = [
  "id", "logicalKey", "releaseCandidateId", "batchId", "sourceId", "sourceResultId",
  "kind", "capturedAt", "sha256", "byteCount", "path", "extractorLocator",
  "captureToolName", "captureToolVersion"
] as const;
const ARTIFACT_KINDS = new Set([
  "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE",
  "PAGINATION_PAGE", "SCREENSHOT", "DEDUPE_LEDGER", "ORACLE_RESULT", "COMMAND_OUTPUT"
]);
const NETWORK_KINDS = new Set([
  "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"
]);
const ARTIFACT_DRAFT_KEYS = new Set([
  "id", "logicalKey", "kind", "channelId", "requestedUrl", "finalUrl", "httpStatus",
  "contentType", "capturedAt", "body", "bodyRepresentation", "rawBodySha256",
  "redactionDescriptors", "extractorLocator"
]);
const REDACTION_DESCRIPTOR_KEYS = new Set(["kind", "count"]);
const REDACTION_DESCRIPTOR_KINDS = new Set(["CREDENTIAL_MATERIAL", "UPSTREAM_ERROR_TEXT"]);

function assertStrictDenseArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const keys = Reflect.ownKeys(value);
  const expected = new Set<string>(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (keys.length !== expected.size || keys.some((key) => typeof key !== "string" || !expected.has(key))) {
    throw new Error(`${label} has a forbidden own property`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const isLength = key === "length";
    if (
      !descriptor || !("value" in descriptor) ||
      (isLength ? descriptor.enumerable : !descriptor.enumerable)
    ) {
      throw new Error(`${label} has an accessor, sparse index, or non-canonical own property`);
    }
  }
}

function strictOwnDataRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain metadata object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} has a forbidden prototype`);
  }
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new Error(`${label} has an unknown own property`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label} has an accessor or hidden own property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function validateArchivedArtifacts(input: unknown): ArchivedEvidenceArtifact[] {
  assertStrictDenseArray(input, "archived metadata array");
  if (input.length === 0) {
    throw new Error("archived metadata must contain at least one artifact");
  }
  const artifacts: ArchivedEvidenceArtifact[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const metadata = strictOwnDataRecord(input[index], ARCHIVED_METADATA_KEYS, `archived metadata at index ${index}`);
    for (const key of ARCHIVED_REQUIRED_KEYS) {
      if (!(key in metadata) || metadata[key] === undefined || metadata[key] === null) {
        throw new Error(`archived metadata missing ${key}`);
      }
    }
    for (const key of [
      "id", "logicalKey", "releaseCandidateId", "batchId", "sourceId", "sourceResultId"
    ]) {
      if (typeof metadata[key] !== "string") {
        throw new Error(`archived metadata has invalid ${key}`);
      }
      assertEvidenceIdentifier(metadata[key], `archived metadata ${key}`);
    }
    for (const key of ["path", "extractorLocator", "captureToolName", "captureToolVersion"]) {
      if (typeof metadata[key] !== "string" || !metadata[key].trim()) {
        throw new Error(`archived metadata has invalid ${key}`);
      }
    }
    if (metadata.channelId !== undefined && (typeof metadata.channelId !== "string" || !metadata.channelId.trim())) {
      throw new Error("archived metadata has invalid channelId");
    }
    if (typeof metadata.kind !== "string" || !ARTIFACT_KINDS.has(metadata.kind)) {
      throw new Error("archived metadata has invalid kind");
    }
    if (!(metadata.capturedAt instanceof Date) || !Number.isFinite(metadata.capturedAt.getTime())) {
      throw new Error("archived metadata has invalid capturedAt");
    }
    if (typeof metadata.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.sha256)) {
      throw new Error("archived metadata has invalid sha256");
    }
    if (typeof metadata.byteCount !== "number" || !Number.isSafeInteger(metadata.byteCount) || metadata.byteCount < 0) {
      throw new Error("archived metadata has invalid byteCount");
    }
    for (const key of ["requestedUrl", "finalUrl"] as const) {
      if (metadata[key] !== undefined) metadata[key] = validateHttpUrlMetadata(metadata[key], key);
    }
    if (metadata.httpStatus !== undefined && (
      typeof metadata.httpStatus !== "number" || !Number.isInteger(metadata.httpStatus) ||
      metadata.httpStatus < 100 || metadata.httpStatus > 599
    )) {
      throw new Error("archived metadata has invalid httpStatus");
    }
    if (metadata.contentType !== undefined && (
      typeof metadata.contentType !== "string" || !metadata.contentType.trim() ||
      /[\u0000-\u001f\u007f]/.test(metadata.contentType)
    )) {
      throw new Error("archived metadata has invalid contentType");
    }
    validateArchivedRedactionMetadata(metadata);
    if (NETWORK_KINDS.has(metadata.kind as string)) {
      for (const key of ["requestedUrl", "finalUrl", "httpStatus", "contentType"]) {
        if (metadata[key] === undefined) throw new Error(`archived network metadata missing ${key}`);
      }
    }
    artifacts.push({
      ...(metadata as unknown as ArchivedEvidenceArtifact),
      capturedAt: new Date((metadata.capturedAt as Date).getTime())
    });
  }
  return artifacts;
}

function validateArchivedRedactionMetadata(metadata: Record<string, unknown>): void {
  const representation = metadata.bodyRepresentation;
  if (representation !== undefined && representation !== "EXACT" && representation !== "REDACTED") {
    throw new Error("archived metadata has invalid bodyRepresentation");
  }
  if (metadata.rawBodySha256 !== undefined && (
    typeof metadata.rawBodySha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.rawBodySha256)
  )) {
    throw new Error("archived metadata has invalid rawBodySha256");
  }
  if (metadata.redactionDescriptors !== undefined) {
    assertStrictDenseArray(metadata.redactionDescriptors, "archived redaction descriptors");
    if (metadata.redactionDescriptors.length < 1 || metadata.redactionDescriptors.length > 16) {
      throw new Error("archived metadata has invalid redactionDescriptors");
    }
    metadata.redactionDescriptors = metadata.redactionDescriptors.map((value, index) => {
      const descriptor = strictOwnDataRecord(value, REDACTION_DESCRIPTOR_KEYS,
        `archived redaction descriptor at index ${index}`);
      if (typeof descriptor.kind !== "string" || !REDACTION_DESCRIPTOR_KINDS.has(descriptor.kind) ||
          typeof descriptor.count !== "number" || !Number.isInteger(descriptor.count) ||
          descriptor.count < 1 || descriptor.count > 10_000) {
        throw new Error("archived metadata has invalid redaction descriptor");
      }
      return { kind: descriptor.kind, count: descriptor.count };
    });
  }
  if (representation === "REDACTED") {
    if (metadata.rawBodySha256 === undefined || metadata.redactionDescriptors === undefined) {
      throw new Error("archived redacted metadata requires raw hash and descriptors");
    }
  } else if (representation === "EXACT") {
    if (metadata.rawBodySha256 !== undefined || metadata.redactionDescriptors !== undefined) {
      throw new Error("archived exact metadata forbids redaction provenance");
    }
  } else if (metadata.rawBodySha256 !== undefined || metadata.redactionDescriptors !== undefined) {
    throw new Error("archived redaction provenance requires bodyRepresentation");
  }
}

function validateHttpUrlMetadata(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`archived metadata has invalid ${field}`);
  try {
    return sanitizeEvidenceHttpUrl(value);
  } catch (error) {
    throw new Error(`archived metadata has invalid ${field}`, { cause: error });
  }
}

function validateTuple(request: {
  workspaceRoot: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
}): void {
  if (!path.isAbsolute(request.workspaceRoot)) throw new Error("workspaceRoot must be absolute");
  validateTupleIdentifiers(request);
}

function validateTupleIdentifiers(request: {
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
}): void {
  for (const [name, value] of Object.entries({
    releaseCandidateId: request.releaseCandidateId,
    batchId: request.batchId,
    sourceId: request.sourceId,
    sourceResultId: request.sourceResultId
  })) {
    assertEvidenceIdentifier(value, name);
  }
}

function assertUniqueDrafts(drafts: readonly SourceFetchArtifactDraft[]): void {
  assertUnique(drafts.map((draft) => draft.id), "artifact id");
  assertUnique(drafts.map((draft) => draft.logicalKey), "artifact logical key");
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function resolveRelativeBelow(root: string, subpath: string, label: string): string {
  if (!subpath.trim() || path.isAbsolute(subpath)) throw new Error(`${label} must be a non-empty relative path`);
  const result = path.resolve(root, subpath);
  assertBelow(root, result, label);
  return result;
}

function validateEvidenceSubdirectory(subpath: string): string {
  if (
    typeof subpath !== "string" || !subpath || subpath !== subpath.trim() ||
    path.posix.isAbsolute(subpath) || path.win32.isAbsolute(subpath) || subpath.includes("\\")
  ) {
    throw new Error("evidence subdirectory must be a canonical relative path");
  }
  const segments = subpath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("evidence subdirectory contains a non-canonical segment");
  }
  for (const segment of segments) assertWindowsCanonicalSegment(segment, "evidence subdirectory segment");
  return segments.join("/");
}

function canonicalArtifactPath(input: {
  releaseCandidateId: string;
  evidenceSubdirectory: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
  artifact: Pick<ArchivedEvidenceArtifact, "id" | "logicalKey" | "contentType">;
}): string {
  return [
    "outputs", "p0-rc", input.releaseCandidateId, input.evidenceSubdirectory, "artifacts",
    input.batchId, input.sourceId, input.sourceResultId,
    `${input.artifact.id}--${input.artifact.logicalKey}${extensionFor(input.artifact)}`
  ].join("/");
}

function assertBelow(root: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    if (!relative && path.resolve(root) !== path.resolve(candidate)) return;
    if (!relative) return;
    throw new Error(`${label} escapes the required root`);
  }
}

async function assertNoLinksOrEscape(workspaceRoot: string, target: string): Promise<void> {
  assertBelow(workspaceRoot, target, "filesystem path");
  const relative = path.relative(workspaceRoot, target);
  let cursor = workspaceRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch (error) {
      if (isNotFound(error)) break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`symlink/reparse path is forbidden: ${cursor}`);
  }
  const existing = await nearestExisting(target);
  const existingReal = await realpath(existing);
  assertBelow(workspaceRoot, existingReal, "real filesystem path");
}

async function nearestExisting(target: string): Promise<string> {
  let cursor = target;
  while (!(await exists(cursor))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`no existing parent for ${target}`);
    cursor = parent;
  }
  return cursor;
}

function toMetadata(
  request: ArtifactArchiveRequest,
  captureTool: CaptureTool,
  draft: SourceFetchArtifactDraft,
  finalPath: string,
  digest: { sha256: string; byteCount: number }
): ArchivedEvidenceArtifact {
  return {
    id: draft.id,
    logicalKey: draft.logicalKey,
    releaseCandidateId: request.releaseCandidateId,
    batchId: request.batchId,
    sourceId: request.sourceId,
    sourceResultId: request.sourceResultId,
    ...(draft.channelId === undefined ? {} : { channelId: draft.channelId }),
    kind: draft.kind,
    ...(draft.requestedUrl === undefined ? {} : { requestedUrl: draft.requestedUrl }),
    ...(draft.finalUrl === undefined ? {} : { finalUrl: draft.finalUrl }),
    ...(draft.httpStatus === undefined ? {} : { httpStatus: draft.httpStatus }),
    ...(draft.contentType === undefined ? {} : { contentType: draft.contentType }),
    ...(draft.bodyRepresentation === undefined ? {} : { bodyRepresentation: draft.bodyRepresentation }),
    ...(draft.rawBodySha256 === undefined ? {} : { rawBodySha256: draft.rawBodySha256 }),
    ...(draft.redactionDescriptors === undefined ? {} : {
      redactionDescriptors: draft.redactionDescriptors.map((descriptor) => ({ ...descriptor }))
    }),
    capturedAt: new Date(draft.capturedAt),
    ...digest,
    path: path.relative(path.resolve(request.workspaceRoot), finalPath).split(path.sep).join("/"),
    extractorLocator: draft.extractorLocator,
    captureToolName: captureTool.name,
    captureToolVersion: captureTool.version
  };
}

function extensionFor(draft: { contentType?: string | undefined }): string {
  if (draft.contentType?.toLowerCase().includes("json")) return ".json";
  if (draft.contentType?.toLowerCase().includes("html")) return ".html";
  return ".bin";
}

function normalizeForComparison(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isDirectoryNotEmpty(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOTEMPTY";
}
