export const MANUAL_RECOVERY_INSTANCE = "recover.queued";
export const MANUAL_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function assertFreshManualRequest(input: {
  request: { id: string; sourceId: string; createdAt: Date; status: string };
  registeredAt: Date; sourceIds: string[]; unresolvedRequests: Array<{ kind?: string; id?: string }>;
}) {
  if (input.unresolvedRequests.some(row => row.kind === "MANUAL_REQUEST" && row.id === input.request.id) ||
      !(input.request.createdAt.getTime() > input.registeredAt.getTime())) throw Error("LEGACY_MANUAL_REQUEST_FORBIDDEN");
  if (!input.sourceIds.includes(input.request.sourceId)) throw Error("MANUAL_SOURCE_OUT_OF_SCOPE");
  if (input.request.status !== "QUEUED") throw Error("MANUAL_REQUEST_NOT_FRESH_QUEUED");
}
