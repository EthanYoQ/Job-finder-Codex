import { PrismaClient } from "@prisma/client";
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { handleAdminApi, type AdminApiDeps, type AdminApiResponse } from "./adminApi";
import { handlePublicApi, type PublicApiDeps, type PublicApiResponse } from "./publicApi";
import { encodePublicJsonResponse } from "./publicResponseEncoding";
import { encodeStaticResponse } from "./staticResponse";
import type { SnapshotReadTiming } from "../db/portablePublicSnapshotRepository";
import { createSavedSnapshotReader } from "./savedPublicSnapshot";
import { createRefreshStatusReader } from "./savedRefreshStatus";
import { createRemoteWriteBackend } from "./remoteWriteBackend";

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
  writeTimeoutMs?: number;
}

type HttpServerDeps = Omit<PublicApiDeps & AdminApiDeps, "db"> & {db?: PublicApiDeps["db"] & AdminApiDeps["db"]};
type HttpResponse = PublicApiResponse | AdminApiResponse;

export function createServer(deps: HttpServerDeps, options: HttpServerOptions = {}): Server {
  const staticRoot = resolve(options.staticRoot ?? resolve(process.cwd(), "dist"));
  const writeTimeoutMs = options.writeTimeoutMs ?? 8_000;
  if (!Number.isFinite(writeTimeoutMs) || writeTimeoutMs <= 0) throw new Error("INVALID_WRITE_TIMEOUT");

  return createNodeServer((request, response) => {
    void handleRequest(request, response, deps, staticRoot, writeTimeoutMs).catch((error: unknown) => {
      console.error("HTTP_SERVER_ERROR");
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json; charset=utf-8");
      }
      response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
    });
  });
}

export async function startServer(): Promise<Server> {
  const snapshotFile = process.env.JOBFINDER_PUBLIC_SNAPSHOT_FILE;
  if (!snapshotFile) throw new Error("JOBFINDER_PUBLIC_SNAPSHOT_FILE_REQUIRED");
  const readPortableSnapshot = await createSavedSnapshotReader(snapshotFile);
  if (process.env.JOBFINDER_REMOTE_WRITE_MACHINE && process.env.DATABASE_URL) throw new Error("CHOOSE_ONE_WRITE_BACKEND");
  const forwardWrite = process.env.JOBFINDER_REMOTE_WRITE_MACHINE
    ? createRemoteWriteBackend({machine: process.env.JOBFINDER_REMOTE_WRITE_MACHINE}) : undefined;
  // Prisma connects lazily. Database availability never gates public snapshot startup.
  const db = process.env.DATABASE_URL ? new PrismaClient() : undefined;
  const readRefreshStatus = createRefreshStatusReader(snapshotFile, process.env.JOBFINDER_SCHEDULE_STATE_FILE);
  const server = createServer({readPortableSnapshot, readRefreshStatus, ...(db ? {db} : {}), ...(forwardWrite ? {forwardWrite} : {})});
  server.once("close", () => { void db?.$disconnect().catch(() => console.error("WRITE_DATABASE_DISCONNECT_FAILED")); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env.PORT ?? DEFAULT_PORT), process.env.HOST ?? DEFAULT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: HttpServerDeps,
  staticRoot: string,
  writeTimeoutMs: number
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
    const body = await readRequestBody(request);
    const operation = () => handlePublicApi(
      {
        method: request.method ?? "GET",
        path: url.pathname,
        query: toQueryRecord(url),
        headers: toHeaderRecord(request),
        body,
        ip: getRequestIp(request),
        ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] })
      },
      {...deps, ...(recordTiming ? {recordTiming} : {})}
    );
    const publicApiResponse = request.method === "POST" && !deps.forwardWrite
      ? await boundedDatabaseRequest(operation, writeTimeoutMs)
      : await operation();
    const encoded = await encodePublicJsonResponse({
      method: request.method ?? "GET",
      path: url.pathname,
      headers: toHeaderRecord(request)
    }, publicApiResponse, recordTiming);
    writeResponse(response, encoded, timedPublicGet ? publicRequestStartedAt : undefined, timings);
    return;
  }

  if (url.pathname.startsWith("/admin/api/")) {
    if (deps.forwardWrite) {
      const result = await deps.forwardWrite({method: request.method ?? "GET", path: url.pathname,
        query: toQueryRecord(url), headers: toHeaderRecord(request), body: await readRequestBody(request),
        ip: getRequestIp(request)});
      writeResponse(response, result);
      return;
    }
    const db = deps.db;
    if (!db) {
      writeResponse(response, {status: 503, headers: {"cache-control": "no-store"}, body: {error: "WRITE_BACKEND_UNAVAILABLE"}});
      return;
    }
    const body = await readRequestBody(request);
    const adminApiResponse = await boundedDatabaseRequest(() => handleAdminApi(
      {
        method: request.method ?? "GET",
        path: url.pathname,
        headers: toHeaderRecord(request),
        body,
        ip: getRequestIp(request),
        ...(request.headers["user-agent"] === undefined ? {} : { userAgent: request.headers["user-agent"] })
      },
      {...deps, db}
    ), writeTimeoutMs);
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

export async function boundedDatabaseRequest(operation: () => Promise<HttpResponse>, timeoutMs: number): Promise<HttpResponse> {
  let timer: NodeJS.Timeout | undefined;
  const unknown = (status: number): HttpResponse => ({status, headers: {"cache-control": "no-store"},
    body: {error: "WRITE_RESULT_UNKNOWN", retryable: false}});
  try {
    return await Promise.race([operation(), new Promise<HttpResponse>(resolve => {
      timer = setTimeout(() => resolve(unknown(504)), timeoutMs);
    })]);
  } catch {
    // A lost connection can follow a commit. Never retry automatically or log private request data.
    return unknown(503);
  } finally {
    if (timer) clearTimeout(timer);
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
