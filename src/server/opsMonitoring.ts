export type OpsAlertCode =
  | "WEBSITE_DOWN"
  | "DATABASE_UNREACHABLE"
  | "BACKUP_MISSING"
  | "BACKUP_FAILED"
  | "BACKUP_STALE"
  | "CRAWL_SUCCESS_BELOW_SLO"
  | "CRAWL_PARTIAL_COMPANY_RESULTS"
  | "CRAWL_SUMMARY_MISSING"
  | "CRAWL_SUMMARY_INVALID"
  | "CRAWL_SUMMARY_STALE"
  | "CRAWL_AUTHORITY_INVALID"
  | "CRAWL_ATTEMPT_MISSING"
  | "CRAWL_ATTEMPT_INVALID"
  | "CRAWL_ATTEMPT_FAILED"
  | "CRAWL_ATTEMPT_STALE"
  | "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM"
  | "COMPANY_CONSECUTIVE_FAILURES"
  | "CERTIFICATE_EXPIRING"
  | "HIGH_DISK_USAGE"
  | "HIGH_MEMORY_USAGE"
  | "ABNORMAL_TRAFFIC";

export type OpsAlertSeverity = "warning" | "critical";

export interface OpsAlert {
  code: OpsAlertCode;
  severity: OpsAlertSeverity;
  message: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

export interface OpsAlertInput {
  now: Date;
  health: {
    ok: boolean;
    statusCode?: number;
  };
  backup: {
    latestBackupAt?: string;
    latestBackupSucceeded?: boolean;
  };
  crawl: {
    authorityState: "VALID" | "PAUSED" | "INVALID";
    attemptState: "SUCCESS" | "RUNNING" | "PAUSED" | "MISSING" | "INVALID" | "FAILED" | "STALE";
    summaryState: "VALID" | "MISSING" | "INVALID" | "STALE";
    globalSuccessRate?: number;
    consecutiveFailuresByCompany: Record<string, number>;
    initialQualificationPause?: {
      notificationKey: string;
      releaseCandidateId: string;
      batchId: string;
      completedRoundCount: 2;
      stableCompanyCount: number;
      minimumStableCompanyCount: number;
    };
  };
  certificate?: {
    expiresAt?: string;
  };
  resources?: {
    diskUsedPercent?: number;
    memoryUsedPercent?: number;
  };
  traffic?: {
    requestsLastHour?: number;
    baselineRequestsPerHour?: number;
  };
}

const BACKUP_STALE_HOURS = 26;
const CRAWL_SUCCESS_SLO = 0.8;
const CERT_EXPIRY_WARNING_DAYS = 14;
const HIGH_DISK_THRESHOLD = 90;
const HIGH_MEMORY_THRESHOLD = 90;
const TRAFFIC_SPIKE_MULTIPLIER = 3;

export function evaluateOpsAlerts(input: OpsAlertInput): OpsAlert[] {
  const alerts: OpsAlert[] = [];

  if (input.crawl.authorityState === "INVALID") {
    alerts.push({ code: "CRAWL_AUTHORITY_INVALID", severity: "critical", message: "Pinned crawl release authority is unavailable or invalid." });
  }
  const attemptAlert = {
    MISSING: ["CRAWL_ATTEMPT_MISSING", "No crawl attempt evidence is available."],
    INVALID: ["CRAWL_ATTEMPT_INVALID", "The latest crawl attempt evidence is invalid."],
    FAILED: ["CRAWL_ATTEMPT_FAILED", "The latest crawl attempt failed."],
    STALE: ["CRAWL_ATTEMPT_STALE", "The latest crawl attempt is stale."]
  } as const;
  if (!["SUCCESS", "RUNNING", "PAUSED"].includes(input.crawl.attemptState)) {
    const [code, message] = attemptAlert[input.crawl.attemptState as keyof typeof attemptAlert];
    alerts.push({ code, severity: input.crawl.attemptState === "FAILED" ? "warning" : "critical", message });
  }

  const pause = input.crawl.initialQualificationPause;
  if (pause) {
    if (
      !/^[0-9a-f]{64}$/u.test(pause.notificationKey) || !pause.releaseCandidateId.trim() ||
      !pause.batchId.trim() || pause.completedRoundCount !== 2 ||
      !Number.isSafeInteger(pause.stableCompanyCount) || pause.stableCompanyCount < 0 ||
      !Number.isSafeInteger(pause.minimumStableCompanyCount) || pause.minimumStableCompanyCount < 1 ||
      pause.stableCompanyCount >= pause.minimumStableCompanyCount
    ) throw new Error("Initial qualification pause monitoring input is invalid");
    alerts.push({
      code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM",
      severity: "critical",
      message: `Initial qualification paused after exactly two completed rounds: ${pause.stableCompanyCount}/${pause.minimumStableCompanyCount} stable companies. No third qualification round is allowed.`,
      dedupeKey: `initial-qualification-pause:${pause.notificationKey}`,
      metadata: {
        releaseCandidateId: pause.releaseCandidateId,
        batchId: pause.batchId,
        completedRoundCount: pause.completedRoundCount,
        stableCompanyCount: pause.stableCompanyCount,
        minimumStableCompanyCount: pause.minimumStableCompanyCount
      }
    });
  }

  const summaryAlert = {
    MISSING: ["CRAWL_SUMMARY_MISSING", "No crawl summary is available."],
    INVALID: ["CRAWL_SUMMARY_INVALID", "The crawl summary is malformed or unsupported."],
    STALE: ["CRAWL_SUMMARY_STALE", "The crawl summary is stale."]
  } as const;
  if (input.crawl.summaryState !== "VALID") {
    const [code, message] = summaryAlert[input.crawl.summaryState];
    alerts.push({ code, severity: "critical", message });
  }

  if (!input.health.ok || (input.health.statusCode !== undefined && input.health.statusCode >= 500)) {
    alerts.push({
      code: "WEBSITE_DOWN",
      severity: "critical",
      message: `Health check failed with status ${input.health.statusCode ?? "unknown"}.`
    });
  }

  if (input.backup.latestBackupSucceeded === false) {
    alerts.push({
      code: "BACKUP_FAILED",
      severity: "critical",
      message: "Latest backup run failed."
    });
  }

  const latestBackupAt = toDate(input.backup.latestBackupAt);
  if (!latestBackupAt) {
    alerts.push({
      code: "BACKUP_MISSING",
      severity: "critical",
      message: "No successful backup evidence is available."
    });
  } else {
    const ageHours = (input.now.getTime() - latestBackupAt.getTime()) / 3_600_000;
    if (ageHours > BACKUP_STALE_HOURS) {
      alerts.push({
        code: "BACKUP_STALE",
        severity: "warning",
        message: `Latest backup is ${Math.floor(ageHours)} hours old.`,
        metadata: { latestBackupAt: latestBackupAt.toISOString() }
      });
    }
  }

  const globalSuccessRate = input.crawl.globalSuccessRate;
  if (globalSuccessRate !== undefined && globalSuccessRate < CRAWL_SUCCESS_SLO) {
    alerts.push({
      code: "CRAWL_SUCCESS_BELOW_SLO",
      severity: "warning",
      message: `Global crawl success rate fell to ${(globalSuccessRate * 100).toFixed(1)}%.`,
      metadata: { globalSuccessRate }
    });
  } else if (globalSuccessRate !== undefined && globalSuccessRate < 1) {
    alerts.push({
      code: "CRAWL_PARTIAL_COMPANY_RESULTS",
      severity: "warning",
      message: `Some company sources were unavailable; global crawl success was ${(globalSuccessRate * 100).toFixed(1)}%.`,
      metadata: { globalSuccessRate }
    });
  }

  const failingCompanies = Object.entries(input.crawl.consecutiveFailuresByCompany)
    .filter(([, failures]) => failures >= 3)
    .map(([companyId]) => companyId)
    .sort();
  if (failingCompanies.length > 0) {
    alerts.push({
      code: "COMPANY_CONSECUTIVE_FAILURES",
      severity: "critical",
      message: `${failingCompanies.length} company source(s) have three consecutive crawl failures.`,
      metadata: { companies: failingCompanies }
    });
  }

  const certificateExpiry = toDate(input.certificate?.expiresAt);
  if (certificateExpiry) {
    const daysLeft = (certificateExpiry.getTime() - input.now.getTime()) / 86_400_000;
    if (daysLeft <= CERT_EXPIRY_WARNING_DAYS) {
      alerts.push({
        code: "CERTIFICATE_EXPIRING",
        severity: "warning",
        message: `TLS certificate expires in ${Math.max(0, Math.floor(daysLeft))} day(s).`,
        metadata: { expiresAt: certificateExpiry.toISOString() }
      });
    }
  }

  if ((input.resources?.diskUsedPercent ?? 0) >= HIGH_DISK_THRESHOLD) {
    alerts.push({
      code: "HIGH_DISK_USAGE",
      severity: "critical",
      message: `Disk usage reached ${input.resources?.diskUsedPercent}%.`,
      metadata: { diskUsedPercent: input.resources?.diskUsedPercent }
    });
  }

  if ((input.resources?.memoryUsedPercent ?? 0) >= HIGH_MEMORY_THRESHOLD) {
    alerts.push({
      code: "HIGH_MEMORY_USAGE",
      severity: "critical",
      message: `Memory usage reached ${input.resources?.memoryUsedPercent}%.`,
      metadata: { memoryUsedPercent: input.resources?.memoryUsedPercent }
    });
  }

  const requestsLastHour = input.traffic?.requestsLastHour;
  const baselineRequestsPerHour = input.traffic?.baselineRequestsPerHour;
  if (
    requestsLastHour !== undefined &&
    baselineRequestsPerHour !== undefined &&
    baselineRequestsPerHour > 0 &&
    requestsLastHour / baselineRequestsPerHour >= TRAFFIC_SPIKE_MULTIPLIER
  ) {
    alerts.push({
      code: "ABNORMAL_TRAFFIC",
      severity: "warning",
      message: `Traffic reached ${requestsLastHour} requests/hour against a ${baselineRequestsPerHour} baseline.`,
      metadata: { requestsLastHour, baselineRequestsPerHour }
    });
  }

  return alerts;
}

function toDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
