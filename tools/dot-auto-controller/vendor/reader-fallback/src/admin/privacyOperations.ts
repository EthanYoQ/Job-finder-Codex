import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminOperationContext } from "./operations";

type PrivacyAction = "EXPORT" | "DELETE";
type PrivacyRow = {
  id: string;
  issueType: string;
  description: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
  companyId: string | null;
  jobId: string | null;
};

type PrivacyTx = {
  feedback: {
    findUnique(args: unknown): Promise<({ id: string; issueType: string; contact: string | null }) | null>;
    findMany(args: unknown): Promise<PrivacyRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  adminAuditEvent: { create(args: unknown): Promise<unknown> };
};

export interface PrivacyOperationsDb {
  $transaction<T>(callback: (tx: PrivacyTx) => Promise<T> | T): Promise<T>;
}

export async function processPrivacyRequest(
  input: { requestId: string; action: PrivacyAction; verifiedContact: string },
  context: AdminOperationContext,
  deps: { db: PrivacyOperationsDb; now?: () => Date }
) {
  return deps.db.$transaction(async (tx) => {
    const request = await tx.feedback.findUnique({
      where: { id: input.requestId },
      select: { id: true, issueType: true, contact: true }
    });
    if (!request || request.issueType !== `PRIVACY_${input.action}` || !request.contact ||
        !constantTimeExact(request.contact, input.verifiedContact)) {
      throw new Error("PRIVACY_REQUEST_VERIFICATION_FAILED");
    }

    const rows = await tx.feedback.findMany({
      where: { contact: request.contact },
      select: {
        id: true, issueType: true, description: true, status: true, createdAt: true,
        closedAt: true, companyId: true, jobId: true
      },
      orderBy: { createdAt: "asc" }
    });
    const idsSha256 = createHash("sha256").update(rows.map((row) => row.id).sort().join("\n")).digest("hex");

    if (input.action === "EXPORT") {
      await tx.adminAuditEvent.create({ data: auditData(context, input, rows.length, idsSha256) });
      return { action: "EXPORT" as const, requestId: input.requestId, records: rows };
    }

    const now = deps.now?.() ?? new Date();
    const result = await tx.feedback.updateMany({
      where: { contact: request.contact },
      data: {
        contact: null,
        description: "[PRIVACY_REQUEST_ANONYMIZED]",
        ip: "ANONYMIZED",
        userAgent: "ANONYMIZED",
        status: "CLOSED",
        closedAt: now
      }
    });
    await tx.adminAuditEvent.create({ data: auditData(context, input, result.count, idsSha256) });
    return { action: "DELETE" as const, requestId: input.requestId, anonymizedCount: result.count };
  });
}

function auditData(context: AdminOperationContext, input: { requestId: string; action: PrivacyAction }, count: number, idsSha256: string) {
  return {
    adminUserId: context.adminUserId,
    action: `PROCESS_PRIVACY_${input.action}`,
    targetType: "Feedback",
    targetId: input.requestId,
    ip: context.ip,
    userAgent: context.userAgent,
    metadata: { requestId: input.requestId, recordCount: count, idsSha256 }
  };
}

function constantTimeExact(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, Buffer.alloc(left.length));
    return false;
  }
  return timingSafeEqual(left, right);
}
