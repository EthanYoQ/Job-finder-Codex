import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_NAME = /^[0-9]{14}_[a-z0-9][a-z0-9_]*$/u;

export interface PrismaMigrationArtifact {
  migrationName: string;
  checksum: string;
}

export function listCurrentPrismaMigrations(projectRoot: string): PrismaMigrationArtifact[] {
  const migrationRoot = resolve(projectRoot, "prisma", "migrations");
  let entries;
  try {
    entries = readdirSync(migrationRoot, { withFileTypes: true });
  } catch {
    throw new Error("Current Prisma migration directory is unavailable");
  }
  const migrations: PrismaMigrationArtifact[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!MIGRATION_NAME.test(entry.name)) {
        throw new Error("Current Prisma migration directory contains an invalid directory");
      }
      const migrationSql = resolve(migrationRoot, entry.name, "migration.sql");
      let isRegularFile = false;
      try {
        const stat = lstatSync(migrationSql);
        isRegularFile = stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
      } catch {
        isRegularFile = false;
      }
      if (!isRegularFile) {
        throw new Error("Current Prisma migration directory contains an invalid migration artifact");
      }
      migrations.push({
        migrationName: entry.name,
        checksum: createHash("sha256").update(readFileSync(migrationSql)).digest("hex")
      });
      continue;
    }
    if (!entry.isFile() || entry.name !== "migration_lock.toml") {
      throw new Error("Current Prisma migration directory contains an unexpected entry");
    }
  }
  return migrations.sort((left, right) => compareUtf8(left.migrationName, right.migrationName));
}

const compareUtf8 = (left: string, right: string): number => Buffer.compare(
  Buffer.from(left, "utf8"), Buffer.from(right, "utf8")
);
