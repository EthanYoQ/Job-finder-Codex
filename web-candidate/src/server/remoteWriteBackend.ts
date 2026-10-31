import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PublicApiRequest, PublicApiResponse } from "./publicApi";

const ResponseSchema = z.object({status: z.number().int().min(200).max(599),
  headers: z.record(z.string()), body: z.unknown()});
export const PrivateRequestSchema = z.object({
  responseKey: z.string().regex(/^[a-f0-9]{64}$/),
  request: z.object({method: z.enum(["GET", "POST"]), path: z.string(),
    query: z.record(z.union([z.string(), z.array(z.string())])).default({}),
    headers: z.record(z.string()), body: z.unknown(), ip: z.string(), userAgent: z.string().optional()
  }).refine(request => request.path.startsWith("/admin/api/") ||
    request.method === "POST" && ["/api/feedback", "/api/recommend-company"].includes(request.path))
});

// exec history retains stdout. Only ciphertext may leave the private process.
export function sealPrivateResponse(response: PublicApiResponse, key: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(response), "utf8"), cipher.final()]);
  return JSON.stringify({iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("base64")});
}
export function openPrivateResponse(text: string, key: Buffer): PublicApiResponse {
  const envelope = z.object({iv: z.string().regex(/^[a-f0-9]{24}$/), tag: z.string().regex(/^[a-f0-9]{32}$/), data: z.string()}).parse(JSON.parse(text));
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "hex"));
  cipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
  const body = Buffer.concat([cipher.update(Buffer.from(envelope.data, "base64")), cipher.final()]);
  return ResponseSchema.parse(JSON.parse(body.toString("utf8"))) as PublicApiResponse;
}

type Command = (args: string[], input: string | undefined, timeoutMs: number) => Promise<string>;
export function cliCommand(cli: string): Command {
  return (args, input, timeout) => new Promise((resolve, reject) => {
    const child = execFile(cli, args, {timeout, maxBuffer: 2 * 1024 * 1024, env: process.env, windowsHide: true},
      (error, stdout) => error ? reject(new Error("PRIVATE_COMMAND_FAILED")) : resolve(stdout));
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export function createRemoteWriteBackend(options: {machine: string; command?: Command}) {
  const command = options.command ?? cliCommand(process.env.INSTABOX_CLI ?? "instabox");
  let waking: Promise<string> | undefined;
  return async (request: PublicApiRequest): Promise<PublicApiResponse> => {
    const reply = (status: number, error: string, retryable: boolean): PublicApiResponse =>
      ({status, headers: {"cache-control": "no-store"}, body: {error, retryable}});
    if (!options.command && !process.env.INSTABOX_API_KEY) return reply(503, "WRITE_BACKEND_UNAVAILABLE", true);
    const responseKey = randomBytes(32);
    const headers = Object.fromEntries(["authorization", "content-type", "x-job-search-consent", "user-agent"]
      .filter(key => request.headers[key] !== undefined).map(key => [key, request.headers[key]]));
    const payload = PrivateRequestSchema.safeParse({responseKey: responseKey.toString("hex"), request: {...request, headers}});
    if (!payload.success) return reply(400, "INVALID_REQUEST", false);
    const input = JSON.stringify(payload.data);
    // Stay below the CLI's 1 MiB stdin-upload threshold; no private temporary file.
    if (Buffer.byteLength(input) > 512 * 1024) return reply(413, "REQUEST_TOO_LARGE", false);
    try {
      waking ??= command(["wake", options.machine, "--json"], undefined, 45_000).finally(() => { waking = undefined; });
      const machine = JSON.parse(await waking);
      if (machine.state !== "running" || machine.runtime?.ready !== true) throw new Error("PRIVATE_MACHINE_NOT_READY");
    } catch { return reply(503, "WRITE_BACKEND_UNAVAILABLE", true); }
    try {
      const output = JSON.parse(await command(["exec", options.machine, "--stdin", "--json", "--timeout", "20",
        "--cwd", "/data/job-finder/app", "--", "/data/job-finder/app/bin/node",
        "--env-file=/data/job-finder/postgres.env", "--import", "/data/job-finder/app/node_modules/tsx/dist/loader.mjs",
        "/data/job-finder/app/web-candidate/src/server/private-write-main.ts"], input, 25_000));
      if (output.exitCode !== 0 || output.timedOut || output.truncated || output.invalidUtf8 || output.oomKilled || typeof output.stdout !== "string") throw new Error("PRIVATE_RESPONSE_INCOMPLETE");
      const response = openPrivateResponse(output.stdout, responseKey);
      return {...response, headers: {...response.headers, "cache-control": "no-store"}};
    } catch { return reply(504, "WRITE_RESULT_UNKNOWN", false); }
  };
}
