import { PrismaClient } from "@prisma/client";
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { setImmediate as yieldSnapshotWork } from "node:timers/promises";
import { extname, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { handleAdminApi, type AdminApiDeps, type AdminApiResponse } from "./adminApi";
import { handlePublicApi, type PublicApiDeps, type PublicApiResponse } from "./publicApi";
import { encodePublicJsonResponse } from "./publicResponseEncoding";
import { encodeStaticResponse } from "./staticResponse";
import { createCachedPostgresReadiness, DEFAULT_POSTGRES_READINESS_TIMEOUT_MS, normalizePostgresReadinessTimeout } from "./postgresReadiness";
import { createCachedDeploymentReadiness, readDeploymentMigrationManifest } from "./deploymentReadiness";
import { resolveDeploymentBootstrapConfig } from "../ops/deploymentBootstrap";
import { readPortablePublicSnapshot, readPortablePublicSnapshotWithStatus, type PortableSnapshotRead, type PortablePublicSnapshot, type PortableSnapshotDb, type SnapshotReadTiming } from "../db/portablePublicSnapshotRepository";
import { SOURCE_QUALITY_POLICY_ID } from "../crawler/sourceQualityAdmission";
import { PortableSnapshotCache } from "../db/portableSnapshotCache";
import { createSnapshotRefreshChecks } from "./snapshotRefreshCheck";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const STATIC_ROUTES = new Set(["/livez", "/readyz", "/healthz", "/privacy", "/terms", "/robots.txt"]);
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

export interface HttpServerOptions {
  staticRoot?: string;
}

type HttpServerDeps = PublicApiDeps & AdminApiDeps;
type HttpResponse = PublicApiResponse | AdminApiResponse;

export const MAX_PORTABLE_RESPONSE_BARRIERS = 64;

export interface PortableSnapshotRefreshStatus {
  state: "CURRENT" | "UPDATING" | "FAILED";
  failures: number;
  nextRetryAt: string | null;
  lastVerifiedAt: string | null;
}
export interface PortableSnapshotReader {
  (): Promise<PortablePublicSnapshot>;
  readWithStatus(responseFinished?: Promise<void>, check?: string, recordTiming?: SnapshotReadTiming): Promise<PortableSnapshotRead>;
  getRefreshStatus(): PortableSnapshotRefreshStatus;
  close(): Promise<void>;
}

/** Serve an owned verified display; correlate one bounded follow-up with a
 * version check that starts after its original request. Never poll while idle. */
export function createPortableSnapshotReader(db: PortableSnapshotDb): PortableSnapshotReader {
  let inFlight: Promise<PortableSnapshotRead> | undefined;
  let background: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingForResponses = false;
  let closed = false;
  let requested = 0, completed = 0, failed = 0;
  let queuedResponses: Promise<void>[] | undefined;
  let nextResponses: Promise<void>[] | undefined;
  let acceptingQueuedResponses = false, acceptingNextResponses = false;
  let status: PortableSnapshotRefreshStatus = {state: "CURRENT", failures: 0, nextRetryAt: null, lastVerifiedAt: null};
  const cache = new PortableSnapshotCache();
  const checks = createSnapshotRefreshChecks();
  const scheduleRefresh = (delay = 0, responses: readonly Promise<void>[] = []): void => {
    if (closed || background || timer || waitingForResponses) return;
    status = {...status, state: delay ? "FAILED" : "UPDATING", nextRetryAt: delay ? new Date(Date.now() + delay).toISOString() : null};
    // Freeze this synchronous group before waiting. Later traffic can neither
    // extend its response barrier nor start overlapping database work.
    waitingForResponses = true;
    queuedResponses = responses.slice(0, MAX_PORTABLE_RESPONSE_BARRIERS);
    acceptingQueuedResponses = true;
    queueMicrotask(() => {
      acceptingQueuedResponses = false;
      const barrier = queuedResponses!;
      queuedResponses = undefined;
      void Promise.allSettled(barrier).then(() => {
        waitingForResponses = false;
        if (closed) return;
        timer = setTimeout(() => {
          timer = undefined;
          const target = requested;
          status = {...status, state: "UPDATING", nextRetryAt: null};
          const startedAt = Date.now(), previousBuildSequence = cache.getBuildSequence();
          console.info("PORTABLE_SNAPSHOT_REFRESH_STARTED", {...status});
          let retry = false, refreshAgain = false;
          let phase = "VERSION_CHECK_OR_BUILD";
          background = Promise.resolve(inFlight).then(() =>
            closed ? undefined : readPortablePublicSnapshot(db, {}, undefined, cache, undefined, yieldSnapshotWork)).then(async snapshot => {
            if (!snapshot) return;
            status = {state: "UPDATING", failures: 0, nextRetryAt: null, lastVerifiedAt: snapshot.generatedAt};
            // Keep the existing post-build check. An unchanged version-only read
            // already covers its target; later arrivals require a successor below.
            if (!closed && cache.hasSnapshot() && cache.getBuildSequence() !== previousBuildSequence) {
              phase = "POST_BUILD_VERSION_CHECK";
              await readPortablePublicSnapshot(db, {}, undefined, cache, () => {refreshAgain = true;}, yieldSnapshotWork);
            }
            if (!refreshAgain) completed = target;
            status = {...status, state: refreshAgain || requested > target ? "UPDATING" : "CURRENT"};
            console.info("PORTABLE_SNAPSHOT_REFRESH_COMPLETED", {...status, durationMs: Date.now() - startedAt});
          }).catch(() => {
            retry = true;
            failed = requested;
            status = {...status, state: "FAILED", failures: status.failures + 1};
          }).finally(() => {
            background = undefined;
            const responses = nextResponses ?? [];
            nextResponses = undefined;
            acceptingNextResponses = false;
            if (retry) {
              const delay = Math.min(1_000 * 2 ** Math.min(status.failures - 1, 5), 30_000);
              scheduleRefresh(delay, responses);
              console.error("PORTABLE_SNAPSHOT_REFRESH_FAILED", {...status, phase, durationMs: Date.now() - startedAt});
            } else if (refreshAgain || requested > target) scheduleRefresh(0, responses);
          });
        }, delay);
      });
    });
  };
  const readWithStatus = async (responseFinished?: Promise<void>, check?: string, recordTiming?: SnapshotReadTiming): Promise<PortableSnapshotRead> => {
    if (closed) throw new Error("PORTABLE_SNAPSHOT_READER_CLOSED");
    const cloneStartedAt = performance.now();
    const now = Date.now(), previous = cache.getDuringRefreshRead(now);
    if (previous) recordTiming?.(background ? "backgroundClone" : "cacheClone", performance.now() - cloneStartedAt);
    const correlated = check === undefined ? undefined : checks.read(check, requested, now);
    if (check !== undefined && correlated === undefined && !previous) throw new Error("INVALID_PORTABLE_SNAPSHOT_CHECK");
    if (previous) {
      const {snapshot, ...identity} = previous;
      let target: number;
      if (check !== undefined) {
        // Expired, forged and other-process checks terminate this bounded request.
        // They must not invent CURRENT or repeatedly open fresh background work.
        if (correlated === undefined) return {snapshot, snapshotRefresh: {state: "FAILED", ...identity}};
        target = correlated;
      } else {
        if (!Number.isSafeInteger(requested + 1)) throw new Error("PORTABLE_SNAPSHOT_SEQUENCE_EXHAUSTED");
        target = ++requested;
        check = checks.issue(target, now);
        if (background) {
          if (!nextResponses) {
            nextResponses = responseFinished ? [responseFinished] : [];
            acceptingNextResponses = true;
            queueMicrotask(() => {acceptingNextResponses = false;});
          } else if (acceptingNextResponses && responseFinished && nextResponses.length < MAX_PORTABLE_RESPONSE_BARRIERS) nextResponses.push(responseFinished);
        } else if (waitingForResponses || timer) {
          if (acceptingQueuedResponses && responseFinished && queuedResponses!.length < MAX_PORTABLE_RESPONSE_BARRIERS) queuedResponses!.push(responseFinished);
        } else scheduleRefresh(0, responseFinished ? [responseFinished] : []);
        if (status.state === "FAILED") failed = requested;
      }
      const state = target <= completed ? "CURRENT" : target <= failed ? "FAILED" : "UPDATING";
      return {snapshot, snapshotRefresh: {state, ...identity, check}};
    }
    // A projection over the cache size bound is not cached. Finish any existing
    // worker first, then use the original complete verified read path.
    if (background) {
      await background;
      return readWithStatus(responseFinished, check, recordTiming);
    }
    return readStrict(recordTiming);
  };
  const readStrict = async (recordTiming?: SnapshotReadTiming): Promise<PortableSnapshotRead> => {
    if (closed) throw new Error("PORTABLE_SNAPSHOT_READER_CLOSED");
    if (background) await background;
    if (closed) throw new Error("PORTABLE_SNAPSHOT_READER_CLOSED");
    const joined = Boolean(inFlight);
    const waitStartedAt = performance.now();
    if (!inFlight) {
      inFlight = readPortablePublicSnapshotWithStatus(db, {}, undefined, cache, undefined, yieldSnapshotWork,
        recordTiming ? {startedAt: waitStartedAt, record: recordTiming} : undefined)
        .then(result => {status = {...status, lastVerifiedAt: cache.getVerifiedAt() ?? result.snapshot.generatedAt}; return result;})
        .finally(() => {inFlight = undefined;});
    }
    // Startup still waits for complete verification. SQL belongs only to its
    // initiating request; joiners report their own wait and owned clone.
    const result = await inFlight;
    if (joined) recordTiming?.("sharedWait", performance.now() - waitStartedAt);
    const cloneStartedAt = performance.now();
    const owned = structuredClone(result);
    recordTiming?.("clone", performance.now() - cloneStartedAt);
    return owned;
  };
  const read = async (): Promise<PortablePublicSnapshot> => (await readStrict()).snapshot;
  return Object.assign(read, {
    readWithStatus,
    getRefreshStatus: () => ({...status}),
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await Promise.allSettled([inFlight, background].filter(task => task !== undefined));
    }
  });
}

export function createServer(deps: HttpServerDeps, options: HttpServerOptions = {}): Server {
  const staticRoot = resolve(options.staticRoot ?? resolve(process.cwd(), "dist"));

  return createNodeServer((request, response) => {
    void handleRequest(request, response, deps, staticRoot).catch((error: unknown) => {
      console.error("HTTP_SERVER_ERROR", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json; charset=utf-8");
      }
      response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
    });
  });
}

export async function startServer(): Promise<Server> {
  const policy=process.env.JOBFINDER_PUBLICATION_POLICY;
  if(policy!==undefined&&policy!==SOURCE_QUALITY_POLICY_ID)throw new Error("UNKNOWN_PUBLICATION_POLICY");
  const prisma = new PrismaClient();
  const bootstrapConfig = resolveDeploymentBootstrapConfig(process.env);
  const readinessTimeoutMs = normalizePostgresReadinessTimeout(
    Number(process.env.POSTGRES_READINESS_TIMEOUT_MS ?? DEFAULT_POSTGRES_READINESS_TIMEOUT_MS)
  );
  // Portable receipts validate their own source policy; exact global history stays in deployment preflight.
  const checkDatabaseReadiness = policy===SOURCE_QUALITY_POLICY_ID
    ? createCachedPostgresReadiness(bootstrapConfig.databaseUrl,{timeoutMs:readinessTimeoutMs})
    : createCachedDeploymentReadiness({
    databaseUrl: bootstrapConfig.databaseUrl,
    expectedMigrations: readDeploymentMigrationManifest(process.cwd()),
    adminEmail: bootstrapConfig.adminEmail,
    adminPasswordHash: bootstrapConfig.adminPasswordHash,
    timeoutMs: readinessTimeoutMs
  });
  const readPortableSnapshot = policy === SOURCE_QUALITY_POLICY_ID ? createPortableSnapshotReader(prisma) : undefined;
  // Warm the verified display before listening/readiness and before the deployer switches
  // traffic. This is a public DB read only; startup never launches a source crawl.
  if (readPortableSnapshot) {
    try { await readPortableSnapshot(); }
    catch (error) { await prisma.$disconnect(); throw error; }
  }
  const server = createServer({
    db: prisma,
    checkDatabaseReadiness,
    readinessTimeoutMs,
    ...(readPortableSnapshot ? {readPortableSnapshot} : {})
  });
  const host = process.env.HOST ?? DEFAULT_HOST;
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  await new Promise<void>((resolvePromise) => {
    server.listen(port, host, () => resolvePromise());
  });

  const shutdown = async () => {
    await readPortableSnapshot?.close();
    await prisma.$disconnect();
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePromise();
      });
    });
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }

  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: HttpServerDeps,
  staticRoot: string
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (shouldRouteToPublicApi(url.pathname)) {
    const publicRequestStartedAt = performance.now();
    const timedPublicGet = (request.method ?? "GET") === "GET" && (url.pathname === "/api/search" || url.pathname === "/api/coverage");
    const timings = new Map<string, number>();
    const allowedTimings = new Set(["read", "planPrep", "txAcquire", "versionSQL", "cacheClone", "tx", "rebuild", "clone", "backgroundClone", "sharedWait", "project", "JSON", "gzip"]);
    const recordTiming: SnapshotReadTiming | undefined = timedPublicGet ? (phase, durationMs) => {
      if (allowedTimings.has(phase) && Number.isFinite(durationMs) && durationMs >= 0) timings.set(phase, durationMs);
    } : undefined;
    const responseFinished = timedPublicGet && deps.readPortableSnapshot?.readWithStatus
      ? new Promise<void>(resolve => {
        // A disconnected client may have reached a terminal state before this
        // handler was dispatched; its finish/close event will not fire again.
        if (response.destroyed || response.writableFinished) { resolve(); return; }
        const settled = () => {
          response.off("finish", settled);
          response.off("close", settled);
          resolve();
        };
        response.once("finish", settled);
        // Client disconnection must not cancel or indefinitely postpone refresh.
        response.once("close", settled);
      }) : undefined;
    const publicApiResponse = await handlePublicApi(
      {
        method: request.method ?? "GET",
        path: url.pathname,
        query: toQueryRecord(url),
        headers: toHeaderRecord(request),
        body: await readRequestBody(request),
        ip: getRequestIp(request),
        ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] })
      },
      {...deps, ...(responseFinished ? {responseFinished} : {}), ...(recordTiming ? {recordTiming} : {})}
    );
    const encoded = await encodePublicJsonResponse({
      method: request.method ?? "GET",
      path: url.pathname,
      headers: toHeaderRecord(request)
    }, publicApiResponse, recordTiming);
    writeResponse(response, encoded, timedPublicGet ? publicRequestStartedAt : undefined, timings);
    return;
  }

  if (url.pathname.startsWith("/admin/api/")) {
    const adminApiResponse = await handleAdminApi(
      {
        method: request.method ?? "GET",
        path: url.pathname,
        headers: toHeaderRecord(request),
        body: await readRequestBody(request),
        ip: getRequestIp(request),
        ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] })
      },
      deps
    );
    writeResponse(response, adminApiResponse);
    return;
  }

  if ((request.method ?? "GET") !== "GET" && request.method !== "HEAD") {
    writeResponse(response, {
      status: 405,
      headers: { allow: "GET, HEAD" },
      body: "Method Not Allowed"
    });
    return;
  }

  const filePath = resolveStaticPath(staticRoot, url.pathname);
  if (!filePath) {
    writeResponse(response, { status: 404, headers: {}, body: "Not Found" });
    return;
  }

  try {
    const content = await readFile(filePath);
    const encoded = await encodeStaticResponse({
      method: request.method ?? "GET",
      headers: toHeaderRecord(request)
    }, relative(staticRoot, filePath).split(sep).join("/"), content);
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      response.setHeader("x-robots-tag", "noindex, nofollow");
    }
    response.setHeader("content-type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
    writeResponse(response, encoded);
  } catch {
    writeResponse(response, { status: 404, headers: {}, body: "Not Found" });
  }
}

function shouldRouteToPublicApi(pathname: string): boolean {
  return STATIC_ROUTES.has(pathname) || pathname.startsWith("/api/");
}

function toQueryRecord(url: URL): Record<string, string | string[] | undefined> {
  const query = new Map<string, string[]>();

  for (const [key, value] of url.searchParams.entries()) {
    const values = query.get(key) ?? [];
    values.push(value);
    query.set(key, values);
  }

  return Object.fromEntries(
    Array.from(query.entries(), ([key, values]) => [key, values.length === 1 ? values[0] ?? "" : values])
  );
}

function toHeaderRecord(request: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])
  );
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") {
    return undefined;
  }

  const contentType = request.headers["content-type"] ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function getRequestIp(request: IncomingMessage): string {
  const remoteAddress = normalizeIpAddress(request.socket.remoteAddress ?? "");
  if (!isTrustedProxyAddress(remoteAddress, process.env.TRUSTED_PROXY_CIDRS ?? "")) {
    return remoteAddress;
  }

  const forwardedFor = request.headers["x-forwarded-for"];
  const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

  return normalizeIpAddress(headerValue?.split(",")[0]?.trim() ?? remoteAddress);
}

function isTrustedProxyAddress(remoteAddress: string, trustedCidrs: string): boolean {
  if (remoteAddress === "" || trustedCidrs.trim() === "") {
    return false;
  }

  return trustedCidrs
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .some((cidr) => isIpInCidr(remoteAddress, cidr));
}

function isIpInCidr(ipAddress: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split("/");
  if (!range || !prefixText) {
    return ipAddress === normalizeIpAddress(cidr);
  }

  const ip = ipv4ToNumber(ipAddress);
  const rangeIp = ipv4ToNumber(normalizeIpAddress(range));
  const prefix = Number(prefixText);

  if (ip === undefined || rangeIp === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return ipAddress === normalizeIpAddress(range);
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (rangeIp & mask);
}

function ipv4ToNumber(ipAddress: string): number | undefined {
  const parts = ipAddress.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    return undefined;
  }

  return (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>> 0;
}

function normalizeIpAddress(value: string): string {
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }

  return value;
}

function resolveStaticPath(staticRoot: string, pathname: string): string | undefined {
  const relativePath = pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/")
    ? "index.html"
    : pathname.slice(1);
  const filePath = resolve(staticRoot, relativePath);

  return filePath.startsWith(`${staticRoot}${sep}`) ? filePath : undefined;
}

function writeResponse(response: ServerResponse, publicApiResponse: HttpResponse, publicRequestStartedAt?: number, timings?: ReadonlyMap<string, number>): void {
  response.statusCode = publicApiResponse.status;

  for (const [key, value] of Object.entries(publicApiResponse.headers)) {
    response.setHeader(key, value);
  }

  const encoded = typeof publicApiResponse.body === "string" || Buffer.isBuffer(publicApiResponse.body);
  const body = encoded ? publicApiResponse.body as string | Buffer : JSON.stringify(publicApiResponse.body);
  if (!encoded && !response.hasHeader("content-type")) {
    response.setHeader("content-type", "application/json; charset=utf-8");
  }
  if (publicRequestStartedAt !== undefined) {
    // Include reads, projection, JSON encoding and compression through this send
    // boundary. Network/proxy/TLS latency is outside the monotonic app duration.
    const stages = [...timings ?? []].map(([phase, duration]) => `${phase};dur=${duration.toFixed(1)}`);
    response.setHeader("server-timing", [`app;dur=${(performance.now() - publicRequestStartedAt).toFixed(1)}`, ...stages].join(", "));
  }
  response.end(body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startServer();
}
