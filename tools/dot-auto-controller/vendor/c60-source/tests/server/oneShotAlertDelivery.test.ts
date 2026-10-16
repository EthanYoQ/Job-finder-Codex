import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpsAlert } from "../../src/server/opsMonitoring";
import {
  acknowledgeDeliveredOneShotAlerts,
  filterAcknowledgedOneShotAlerts
} from "../../src/server/oneShotAlertDelivery";

const pauseAlert: OpsAlert = {
  code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM",
  severity: "critical",
  message: "Initial qualification paused at 44/45.",
  dedupeKey: `initial-qualification-pause:${"a".repeat(64)}`,
  metadata: {
    releaseCandidateId: "rc-pause",
    batchId: "batch-two",
    stableCompanyCount: 44,
    minimumStableCompanyCount: 45
  }
};

describe("one-shot operations alert delivery", () => {
  it("persists a successful pause-alert acknowledgement across monitor invocations", async () => {
    const stateDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitor-state-"));

    await expect(filterAcknowledgedOneShotAlerts([pauseAlert], stateDir)).resolves.toEqual([pauseAlert]);
    await acknowledgeDeliveredOneShotAlerts([pauseAlert], stateDir, new Date("2026-07-15T00:10:00.000Z"));
    await expect(filterAcknowledgedOneShotAlerts([pauseAlert], stateDir)).resolves.toEqual([]);
  });

  it("never suppresses ordinary recurring alerts or a distinct pause key", async () => {
    const stateDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitor-state-"));
    const recurring: OpsAlert = {
      code: "WEBSITE_DOWN",
      severity: "critical",
      message: "Website is down."
    };
    await acknowledgeDeliveredOneShotAlerts([pauseAlert], stateDir, new Date("2026-07-15T00:10:00.000Z"));

    const nextPause = {
      ...pauseAlert,
      dedupeKey: `initial-qualification-pause:${"b".repeat(64)}`
    } satisfies OpsAlert;
    await expect(filterAcknowledgedOneShotAlerts([recurring, nextPause], stateDir))
      .resolves.toEqual([recurring, nextPause]);
  });
});
