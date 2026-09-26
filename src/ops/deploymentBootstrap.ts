export interface DeploymentBootstrapConfig {
  databaseUrl: string;
  adminEmail: string;
  adminPasswordHash: string;
}

interface BootstrapDb {
  $executeRawUnsafe(query: string): Promise<unknown>;
  adminUser: {
    findUnique(args: { where: { email: string } }): Promise<{
      id: string; email: string; passwordHash: string; disabledAt: Date | null;
    } | null>;
    create(args: { data: { email: string; passwordHash: string; role: "ADMIN" } }): Promise<{ id: string }>;
  };
  adminAuditEvent: {
    create(args: { data: {
      adminUserId: string; action: string; targetType: string; targetId: string;
      ip: string; userAgent: string; metadata: { bootstrap: boolean };
    } }): Promise<unknown>;
  };
}

export interface DeploymentBootstrapDeps {
  migrate(): Promise<void>;
  transaction<T>(operation: (db: BootstrapDb) => Promise<T>): Promise<T>;
}

export function resolveDeploymentBootstrapConfig(env: NodeJS.ProcessEnv): DeploymentBootstrapConfig {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? "";
  const safe = databaseUrl !== "" && !databaseUrl.includes("replace-with") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(adminEmail) &&
    /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/u.test(adminPasswordHash) &&
    !adminPasswordHash.includes("00000000000000000000000000000000");
  if (!safe) throw new Error("Deployment bootstrap configuration is missing or unsafe");
  return { databaseUrl, adminEmail, adminPasswordHash };
}

export async function bootstrapDeployment(
  config: DeploymentBootstrapConfig,
  deps: DeploymentBootstrapDeps
): Promise<{ created: boolean; adminEmail: string }> {
  await deps.migrate();
  const created = await deps.transaction(async (db) => {
    await db.$executeRawUnsafe("SELECT pg_advisory_xact_lock(1246707789)");
    const existing = await db.adminUser.findUnique({ where: { email: config.adminEmail } });
    if (existing) {
      if (existing.disabledAt || existing.passwordHash !== config.adminPasswordHash) {
        throw new Error("Deployment administrator does not match the configured bootstrap identity");
      }
      return false;
    }
    const admin = await db.adminUser.create({
      data: { email: config.adminEmail, passwordHash: config.adminPasswordHash, role: "ADMIN" }
    });
    await db.adminAuditEvent.create({ data: {
      adminUserId: admin.id,
      action: "DEPLOYMENT_ADMIN_BOOTSTRAPPED",
      targetType: "AdminUser",
      targetId: admin.id,
      ip: "local-bootstrap",
      userAgent: "job-finder-ops-bootstrap",
      metadata: { bootstrap: true }
    } });
    return true;
  });
  return { created, adminEmail: config.adminEmail };
}
