import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { handlePublicApi, type PublicApiDeps, type PublicApiRequest } from "./publicApi";
import { handleAdminApi, type AdminApiDeps } from "./adminApi";
import { boundedDatabaseRequest } from "./httpServer";
import { PrivateRequestSchema, sealPrivateResponse } from "./remoteWriteBackend";
import { launchQueuedManual } from "./manualLaunch";

export async function handlePrivateRequest(request: PublicApiRequest, db: AdminApiDeps["db"] & NonNullable<PublicApiDeps["db"]>) {
  const response = await boundedDatabaseRequest(() => request.path.startsWith("/admin/api/")
    ? handleAdminApi(request, {db})
    : handlePublicApi(request, {db, readPortableSnapshot: async () => {throw new Error("PRIVATE_PUBLIC_GET_FORBIDDEN");}}), 8_000);
  return launchQueuedManual(request, response);
}

async function main() {
  // Neither handlers nor runtime diagnostics may write plaintext into exec history.
  console.log = console.info = console.warn = console.error = () => {};
  let db: PrismaClient | undefined;
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 512 * 1024) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    const envelope = PrivateRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const response = await boundedDatabaseRequest(async () => {
      if (!process.env.POSTGRES_PASSWORD) throw new Error("POSTGRES_PASSWORD_REQUIRED");
      const {stdout} = await promisify(execFile)("docker", ["inspect", "--format", "{{.NetworkSettings.Networks.bridge.IPAddress}}", "jobfinder-postgres"], {timeout: 5_000});
      const address = stdout.trim();
      if (isIP(address) !== 4) throw new Error("POSTGRES_CONTAINER_ADDRESS_UNAVAILABLE");
      const url = new URL(`postgresql://jobfinder@${address}:5432/jobfinder`);
      url.password = process.env.POSTGRES_PASSWORD;
      url.searchParams.set("connection_limit", "1");
      url.searchParams.set("connect_timeout", "5");
      url.searchParams.set("pool_timeout", "5");
      db = new PrismaClient({datasources: {db: {url: url.href}}, log: []});
      const {userAgent, ...request} = envelope.request;
      return handlePrivateRequest({...request, body: request.body, ...(userAgent === undefined ? {} : {userAgent})}, db);
    }, 17_000);
    await new Promise<void>((resolve, reject) => process.stdout.write(sealPrivateResponse(response, Buffer.from(envelope.responseKey, "hex")) + "\n", error => error ? reject(error) : resolve()));
  } catch { process.exitCode = 1; }
  finally {
    // A timeout cannot prove rollback. The caller receives UNKNOWN and never replays it.
    if (db) await Promise.race([db.$disconnect().catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]);
    process.exit(process.exitCode ?? 0);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
