import { PrismaClient } from "@prisma/client";
import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { handlePublicApi, type PublicApiDeps, type PublicApiResponse } from "./publicApi";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const STATIC_ROUTES = new Set(["/healthz", "/privacy", "/terms", "/robots.txt"]);
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

export interface HttpServerOptions {
  staticRoot?: string;
}

export function createServer(deps: PublicApiDeps, options: HttpServerOptions = {}): Server {
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
  const prisma = new PrismaClient();
  const server = createServer({ db: prisma });
  const host = process.env.HOST ?? DEFAULT_HOST;
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  await new Promise<void>((resolvePromise) => {
    server.listen(port, host, () => resolvePromise());
  });

  const shutdown = async () => {
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
  deps: PublicApiDeps,
  staticRoot: string
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (shouldRouteToPublicApi(url.pathname)) {
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
      deps
    );
    writeResponse(response, publicApiResponse);
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
    response.statusCode = 200;
    response.setHeader("content-type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
    response.end(request.method === "HEAD" ? undefined : content);
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
  const forwardedFor = request.headers["x-forwarded-for"];
  const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

  return headerValue?.split(",")[0]?.trim() ?? request.socket.remoteAddress ?? "";
}

function resolveStaticPath(staticRoot: string, pathname: string): string | undefined {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = resolve(staticRoot, relativePath);

  return filePath.startsWith(staticRoot) ? filePath : undefined;
}

function writeResponse(response: ServerResponse, publicApiResponse: PublicApiResponse): void {
  response.statusCode = publicApiResponse.status;

  for (const [key, value] of Object.entries(publicApiResponse.headers)) {
    response.setHeader(key, value);
  }

  if (typeof publicApiResponse.body === "string") {
    response.end(publicApiResponse.body);
    return;
  }

  if (!response.hasHeader("content-type")) {
    response.setHeader("content-type", "application/json; charset=utf-8");
  }

  response.end(JSON.stringify(publicApiResponse.body));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void startServer();
}
