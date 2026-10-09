const DAY_MS = 24 * 60 * 60 * 1000;

type CountResult = { count: number };
export interface PrivacyRetentionDb {
  accessEvent: { deleteMany(args: unknown): Promise<CountResult> };
  feedback: { updateMany(args: unknown): Promise<CountResult> };
  recommendedCompany: { updateMany(args: unknown): Promise<CountResult> };
  adminAuditEvent: { deleteMany(args: unknown): Promise<CountResult> };
}

export async function runPrivacyRetention(db: PrivacyRetentionDb, now = new Date()) {
  const accessCutoff = new Date(now.getTime() - 90 * DAY_MS);
  const closedCutoff = new Date(now.getTime() - 180 * DAY_MS);
  const auditCutoff = new Date(now);
  auditCutoff.setUTCFullYear(auditCutoff.getUTCFullYear() - 2);

  const [access, feedback, recommendations, audits] = await Promise.all([
    db.accessEvent.deleteMany({ where: { occurredAt: { lt: accessCutoff } } }),
    db.feedback.updateMany({
      where: {
        status: "CLOSED", closedAt: { lt: closedCutoff },
        OR: [
          { contact: { not: null } }, { description: { not: "[RETENTION_ANONYMIZED]" } },
          { ip: { not: "ANONYMIZED" } }, { userAgent: { not: "ANONYMIZED" } }
        ]
      },
      data: { contact: null, description: "[RETENTION_ANONYMIZED]", ip: "ANONYMIZED", userAgent: "ANONYMIZED" }
    }),
    db.recommendedCompany.updateMany({
      where: {
        status: "CLOSED", closedAt: { lt: closedCutoff },
        OR: [
          { companyName: { not: "[RETENTION_ANONYMIZED]" } }, { officialWebsiteUrl: { not: null } },
          { recruitmentEntryUrl: { not: null } }, { reason: { not: null } },
          { ip: { not: "ANONYMIZED" } }, { userAgent: { not: "ANONYMIZED" } }
        ]
      },
      data: {
        companyName: "[RETENTION_ANONYMIZED]", officialWebsiteUrl: null, recruitmentEntryUrl: null,
        reason: null, ip: "ANONYMIZED", userAgent: "ANONYMIZED"
      }
    }),
    db.adminAuditEvent.deleteMany({ where: { createdAt: { lt: auditCutoff } } })
  ]);
  return {
    accessEventsDeleted: access.count,
    feedbackAnonymized: feedback.count,
    recommendationsAnonymized: recommendations.count,
    adminAuditEventsDeleted: audits.count
  };
}
