import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { OpsAlert } from "./opsMonitoring";

const ACK_SCHEMA_VERSION = "ops-one-shot-alert-ack-v1" as const;
const PAUSE_KEY = /^initial-qualification-pause:([0-9a-f]{64})$/u;

interface OneShotAlertAcknowledgement {
  schemaVersion: typeof ACK_SCHEMA_VERSION;
  dedupeKey: string;
  acknowledgedAt: string;
}

export async function filterAcknowledgedOneShotAlerts(
  alerts: readonly OpsAlert[],
  stateDirectory: string
): Promise<OpsAlert[]> {
  assertUniqueOneShotKeys(alerts);
  const result: OpsAlert[] = [];
  for (const alert of alerts) {
    const key = oneShotKey(alert);
    if (key === null || !(await acknowledgementExists(stateDirectory, key))) result.push(alert);
  }
  return result;
}

export async function acknowledgeDeliveredOneShotAlerts(
  alerts: readonly OpsAlert[],
  stateDirectory: string,
  acknowledgedAt: Date = new Date()
): Promise<void> {
  assertUniqueOneShotKeys(alerts);
  if (Number.isNaN(acknowledgedAt.getTime())) throw new Error("One-shot alert acknowledgement time is invalid");
  const keys = alerts.map(oneShotKey).filter((key): key is string => key !== null);
  if (keys.length === 0) return;
  const root = resolve(stateDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const key of keys) {
    if (await acknowledgementExists(root, key)) continue;
    const acknowledgement: OneShotAlertAcknowledgement = {
      schemaVersion: ACK_SCHEMA_VERSION,
      dedupeKey: key,
      acknowledgedAt: acknowledgedAt.toISOString()
    };
    const target = acknowledgementPath(root, key);
    const temporary = resolve(root, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(acknowledgement)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await link(temporary, target);
      await unlink(temporary);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await acknowledgementExists(root, key))) throw error;
    }
  }
  if (process.platform !== "win32") {
    const directoryHandle = await open(root, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  }
}

function oneShotKey(alert: OpsAlert): string | null {
  if (alert.code !== "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM") return null;
  if (typeof alert.dedupeKey !== "string" || !PAUSE_KEY.test(alert.dedupeKey)) {
    throw new Error("Initial qualification pause alert has no valid deterministic dedupe key");
  }
  return alert.dedupeKey;
}

function assertUniqueOneShotKeys(alerts: readonly OpsAlert[]): void {
  const keys = alerts.map(oneShotKey).filter((key): key is string => key !== null);
  if (new Set(keys).size !== keys.length) throw new Error("One-shot alert dedupe keys must be unique");
}

async function acknowledgementExists(stateDirectory: string, key: string): Promise<boolean> {
  const path = acknowledgementPath(resolve(stateDirectory), key);
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 1024) {
      throw new Error("One-shot alert acknowledgement is invalid");
    }
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new Error("One-shot alert acknowledgement changed while opening");
      }
      const parsed: unknown = JSON.parse(await handle.readFile("utf8"));
      assertAcknowledgement(parsed, key);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function acknowledgementPath(stateDirectory: string, key: string): string {
  const match = PAUSE_KEY.exec(key);
  if (!match) throw new Error("One-shot alert key is invalid");
  return resolve(stateDirectory, `initial-qualification-pause-${match[1]}.json`);
}

function assertAcknowledgement(value: unknown, key: string): asserts value is OneShotAlertAcknowledgement {
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(["acknowledgedAt", "dedupeKey", "schemaVersion"])) {
    throw new Error("One-shot alert acknowledgement is malformed");
  }
  const acknowledgement = value as unknown as OneShotAlertAcknowledgement;
  const timestamp = new Date(acknowledgement.acknowledgedAt);
  if (acknowledgement.schemaVersion !== ACK_SCHEMA_VERSION || acknowledgement.dedupeKey !== key ||
      Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== acknowledgement.acknowledgedAt) {
    throw new Error("One-shot alert acknowledgement fields are invalid");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
