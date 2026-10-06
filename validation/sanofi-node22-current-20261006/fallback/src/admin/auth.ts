import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;

export type AdminSessionContext = {
  ip: string;
  userAgent: string;
};

export type AdminSessionRecord = {
  id: string;
  adminUserId: string;
  tokenHash: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  ip: string;
  userAgent: string;
  expiresAt: Date;
  adminUser: {
    id: string;
    disabledAt: Date | null;
  };
};

export type AdminAuthDb = {
  adminSession: {
    create(args: {
      data: {
        adminUserId: string;
        tokenHash: string;
        status: "ACTIVE";
        ip: string;
        userAgent: string;
        expiresAt: Date;
      };
    }): Promise<unknown>;
    findUnique(args: {
      where: {
        tokenHash: string;
      };
      include: {
        adminUser: true;
      };
    }): Promise<AdminSessionRecord | null>;
  };
};

export type CreateAdminSessionDeps = {
  db: AdminAuthDb;
  now?: () => Date;
  randomToken?: () => string;
};

export type AssertActiveAdminSessionDeps = {
  db: AdminAuthDb;
  now?: () => Date;
};

export async function hashAdminPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<string> {
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;

  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyAdminPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");

  if (parts.length !== 3 || parts[0] !== PASSWORD_HASH_PREFIX) {
    return false;
  }

  const salt = parts[1];
  const expectedHex = parts[2];

  if (salt === undefined || expectedHex === undefined) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");

  if (expected.length === 0) {
    return false;
  }

  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createAdminSession(
  adminUserId: string,
  context: AdminSessionContext,
  deps: CreateAdminSessionDeps
): Promise<{ token: string; expiresAt: Date }> {
  const now = deps.now?.() ?? new Date();
  const token = deps.randomToken?.() ?? randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  await deps.db.adminSession.create({
    data: {
      adminUserId,
      tokenHash: hashSessionToken(token),
      status: "ACTIVE",
      ip: context.ip,
      userAgent: context.userAgent,
      expiresAt
    }
  });

  return {
    token,
    expiresAt
  };
}

export async function assertActiveAdminSession(
  token: string,
  context: AdminSessionContext,
  deps: AssertActiveAdminSessionDeps
): Promise<AdminSessionRecord> {
  const session = await deps.db.adminSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      adminUser: true
    }
  });

  const now = deps.now?.() ?? new Date();

  if (
    session === null ||
    session.status !== "ACTIVE" ||
    session.expiresAt.getTime() <= now.getTime() ||
    session.ip !== context.ip ||
    session.userAgent !== context.userAgent ||
    session.adminUser.disabledAt !== null
  ) {
    throw new Error("Admin session is not active");
  }

  return session;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
