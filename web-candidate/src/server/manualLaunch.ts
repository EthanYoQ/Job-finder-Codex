import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PublicApiRequest, PublicApiResponse } from "./publicApi";

const execute = promisify(execFile);
export async function launchQueuedManual(request: Pick<PublicApiRequest, "method" | "path">, response: PublicApiResponse,
  start: (unit: string) => Promise<unknown> = unit => execute("sudo", ["-n", "systemctl", "start", "--no-block", unit], {timeout: 2_000})) {
  if (request.method !== "POST" || request.path !== "/admin/api/manual-crawl" || response.status !== 202) return response;
  const receipt = response.body as {id?: unknown; status?: unknown};
  if (!receipt || receipt.status !== "QUEUED" || typeof receipt.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(receipt.id)) return response;
  let launchStatus = "START_REQUESTED";
  try { await start(`jobfinder-manual@${receipt.id}.service`); }
  catch (error) {
    // A killed client may have already asked systemd to start; never enqueue again.
    const failure = error as {killed?: boolean; signal?: unknown};
    launchStatus = failure.killed || failure.signal ? "START_UNCONFIRMED" : "NOT_STARTED";
  }
  return {...response, body: {...receipt, launchStatus}};
}
