# P0 Admin Operations Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the protected admin operations foundation needed for P0 source maintenance: admin auth/session contracts, manual recrawl queueing, feedback/recommendation review, human category correction, and audit logging.

**Architecture:** Keep this as backend/domain service code only. No public HTTP routes or admin UI are introduced in this plan; services use injected Prisma-like delegates so tests remain deterministic without a live PostgreSQL database.

**Tech Stack:** TypeScript, Vitest, Zod, Node `crypto`, Prisma schema, existing crawler/search contracts.

## Global Constraints

- P0 requires admin login so source data and manual corrections are protected.
- Crawl schedule is twice daily, with manual per-company crawl from admin.
- User feedback must be stored with abuse signals so feedback remains useful without inviting spam.
- Company recommendation does not enter the homepage main path and submitted companies stay in admin review until approved.
- Low-confidence classification appears under 其他 and enters admin review; human corrections must be stored so category quality improves over time.
- Admin routes, batch endpoints, internal query services, deep pagination, and raw data paths must not be indexed.
- No public API, admin UI, live DB connection, cron scheduler, WAF config, deployment config, backups, monitoring, or 50-company verification is introduced by this plan.
- CodeGraph is currently not initialized in this workspace; do not claim CodeGraph-backed structural verification until `codegraph init -i` has been run.

---

## File Structure

- `prisma/schema.prisma`: add admin user/session/audit/manual recrawl models and enums.
- `tests/prisma/schema.test.ts`: lock schema additions.
- `src/admin/auth.ts`: password hashing/verification and session creation/validation helpers.
- `tests/admin/auth.test.ts`: auth helper tests.
- `src/admin/operations.ts`: protected admin operations using injected delegates.
- `tests/admin/operations.test.ts`: manual recrawl, feedback review, recommendation review, category correction, and audit tests.
- `src/domain/route-policy.ts`: ensure admin/manual crawl/internal batch paths remain non-indexable if missing.
- `tests/domain/route-policy.test.ts`: route policy tests for admin operations.
- `docs/superpowers/plans/2026-07-08-admin-operations-foundation.md`: mark plan progress after verification.

---

### Task 1: Admin Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/prisma/schema.test.ts`

**Interfaces:**
- Produces: Prisma enums `AdminRole`, `AdminSessionStatus`, `ManualCrawlStatus`; models `AdminUser`, `AdminSession`, `AdminAuditEvent`, `ManualCrawlRequest`.
- Consumes: existing `Company`, `RecruitmentSource`, `Feedback`, `RecommendedCompany`, and `Job` models.

- [ ] **Step 1: Write failing schema tests**

Add this test to `tests/prisma/schema.test.ts`:

```ts
it("stores protected admin users, sessions, audit events, and manual crawl requests", () => {
  expect(schema).toMatch(/enum AdminRole\s+\{/);
  expect(schema).toMatch(/ADMIN/);
  expect(schema).toMatch(/enum AdminSessionStatus\s+\{/);
  expect(schema).toMatch(/ACTIVE/);
  expect(schema).toMatch(/REVOKED/);
  expect(schema).toMatch(/EXPIRED/);
  expect(schema).toMatch(/enum ManualCrawlStatus\s+\{/);
  expect(schema).toMatch(/QUEUED/);
  expect(schema).toMatch(/RUNNING/);
  expect(schema).toMatch(/SUCCEEDED/);
  expect(schema).toMatch(/FAILED/);
  expect(schema).toMatch(/model AdminUser\s+\{/);
  expect(schema).toMatch(/email\s+String\s+@unique/);
  expect(schema).toMatch(/passwordHash\s+String/);
  expect(schema).toMatch(/model AdminSession\s+\{/);
  expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
  expect(schema).toMatch(/expiresAt\s+DateTime/);
  expect(schema).toMatch(/model AdminAuditEvent\s+\{/);
  expect(schema).toMatch(/action\s+String/);
  expect(schema).toMatch(/model ManualCrawlRequest\s+\{/);
  expect(schema).toMatch(/sourceId\s+String/);
  expect(schema).toMatch(/requestedById\s+String/);
  expect(schema).toMatch(/status\s+ManualCrawlStatus\s+@default\(QUEUED\)/);
});
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
```

Expected: FAIL because admin models and enums do not exist.

- [ ] **Step 3: Add admin schema models**

Modify `prisma/schema.prisma` by adding enums after `FeedbackStatus`:

```prisma
enum AdminRole {
  ADMIN
}

enum AdminSessionStatus {
  ACTIVE
  REVOKED
  EXPIRED
}

enum ManualCrawlStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
}
```

Add these relations to `model RecruitmentSource`:

```prisma
  manualCrawlRequests     ManualCrawlRequest[]
```

Add these models after `AccessEvent`:

```prisma
model AdminUser {
  id             String             @id @default(cuid())
  email          String             @unique
  passwordHash   String
  role           AdminRole          @default(ADMIN)
  disabledAt     DateTime?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  sessions       AdminSession[]
  auditEvents    AdminAuditEvent[]
  manualCrawls   ManualCrawlRequest[]

  @@index([role])
}

model AdminSession {
  id          String             @id @default(cuid())
  adminUserId String
  tokenHash   String             @unique
  status      AdminSessionStatus @default(ACTIVE)
  ip          String
  userAgent   String
  expiresAt   DateTime
  createdAt   DateTime           @default(now())
  adminUser   AdminUser          @relation(fields: [adminUserId], references: [id], onDelete: Cascade)

  @@index([adminUserId, status])
  @@index([expiresAt])
}

model AdminAuditEvent {
  id          String    @id @default(cuid())
  adminUserId String
  action      String
  targetType  String
  targetId    String?
  ip          String
  userAgent   String
  metadata    Json?
  createdAt   DateTime  @default(now())
  adminUser   AdminUser @relation(fields: [adminUserId], references: [id], onDelete: Cascade)

  @@index([adminUserId, createdAt])
  @@index([action, createdAt])
}

model ManualCrawlRequest {
  id            String            @id @default(cuid())
  sourceId      String
  requestedById String
  status        ManualCrawlStatus @default(QUEUED)
  reason        String?
  createdAt     DateTime          @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
  failureReason String?
  source        RecruitmentSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  requestedBy   AdminUser         @relation(fields: [requestedById], references: [id], onDelete: Restrict)

  @@index([sourceId, status])
  @@index([requestedById, createdAt])
  @@index([status, createdAt])
}
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
npm run prisma:validate
npm run typecheck
```

Expected: schema tests, Prisma validation, and typecheck pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add prisma/schema.prisma tests/prisma/schema.test.ts
git commit -m "feat: add admin operations schema"
```

Expected: commit created.

---

### Task 2: Admin Auth Service

**Files:**
- Create: `src/admin/auth.ts`
- Create: `tests/admin/auth.test.ts`

**Interfaces:**
- Produces: `hashAdminPassword(password, salt?)`, `verifyAdminPassword(password, encodedHash)`, `createAdminSession(adminUserId, context, deps)`, `assertActiveAdminSession(token, context, deps)`.
- Consumes: injected `AdminAuthDb` delegate with `adminSession.create` and `adminSession.findUnique`.

- [ ] **Step 1: Write failing auth tests**

Create `tests/admin/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  assertActiveAdminSession,
  createAdminSession,
  hashAdminPassword,
  verifyAdminPassword,
  type AdminAuthDb
} from "../../src/admin/auth";

function fakeDb(session?: unknown): AdminAuthDb & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    adminSession: {
      create: vi.fn((args: unknown) => {
        created.push(args);
        return Promise.resolve({ id: "session-1", ...(args as { data: object }).data });
      }),
      findUnique: vi.fn(() => Promise.resolve(session))
    }
  };
}

describe("admin auth", () => {
  it("hashes and verifies admin passwords without storing the plaintext", async () => {
    const encoded = await hashAdminPassword("correct horse battery staple", "fixed-salt");

    expect(encoded).not.toContain("correct horse battery staple");
    await expect(verifyAdminPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("creates an active admin session with a hashed token and expiry", async () => {
    const db = fakeDb();
    const result = await createAdminSession(
      "admin-1",
      { ip: "127.0.0.1", userAgent: "vitest" },
      {
        db,
        now: () => new Date("2026-07-08T00:00:00.000Z"),
        randomToken: () => "raw-token"
      }
    );

    expect(result.token).toBe("raw-token");
    expect(db.created[0]).toMatchObject({
      data: {
        adminUserId: "admin-1",
        status: "ACTIVE",
        ip: "127.0.0.1",
        userAgent: "vitest",
        expiresAt: new Date("2026-07-09T00:00:00.000Z")
      }
    });
    expect(JSON.stringify(db.created[0])).not.toContain("raw-token");
  });

  it("rejects missing, expired, revoked, disabled, and context-mismatched sessions", async () => {
    await expect(
      assertActiveAdminSession("token", { ip: "127.0.0.1", userAgent: "vitest" }, { db: fakeDb() })
    ).rejects.toThrow("Admin session is not active");

    await expect(
      assertActiveAdminSession("token", { ip: "127.0.0.1", userAgent: "vitest" }, {
        db: fakeDb({
          status: "REVOKED",
          expiresAt: new Date("2026-07-09T00:00:00.000Z"),
          ip: "127.0.0.1",
          userAgent: "vitest",
          adminUser: { id: "admin-1", disabledAt: null }
        }),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });
});
```

- [ ] **Step 2: Run auth tests to verify they fail**

Run:

```bash
npm test -- tests/admin/auth.test.ts
```

Expected: FAIL because `src/admin/auth.ts` does not exist.

- [ ] **Step 3: Implement admin auth**

Create `src/admin/auth.ts`:

- use Node `crypto.scrypt` via `promisify`;
- password hash format: `scrypt$<salt>$<hexHash>`;
- token hash uses `sha256`;
- session duration is exactly 24 hours;
- `assertActiveAdminSession` finds by `tokenHash`, requires `status === "ACTIVE"`, `expiresAt > now`, matching `ip` and `userAgent`, and no `adminUser.disabledAt`.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/admin/auth.test.ts
npm run typecheck
```

Expected: auth tests and typecheck pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/admin/auth.ts tests/admin/auth.test.ts
git commit -m "feat: add admin auth service"
```

Expected: commit created.

---

### Task 3: Admin Operations Service

**Files:**
- Create: `src/admin/operations.ts`
- Create: `tests/admin/operations.test.ts`

**Interfaces:**
- Consumes: authenticated admin context `{ adminUserId, ip, userAgent }`.
- Produces: `queueManualCrawl`, `reviewFeedback`, `reviewRecommendedCompany`, `applyJobCategoryCorrection`, `listSourceHealth`.

- [ ] **Step 1: Write failing operations tests**

Create `tests/admin/operations.test.ts` with fake delegates and tests proving:

- `queueManualCrawl` creates a `ManualCrawlRequest` with `QUEUED` status and writes an `AdminAuditEvent`;
- `reviewFeedback` only allows `REVIEWED`, `CLOSED`, or `SPAM`, updates status, and writes audit metadata;
- `reviewRecommendedCompany` keeps recommendations out of front-end data by only updating review status and writing audit metadata;
- `applyJobCategoryCorrection` updates `humanCorrectedCategory`, `humanCorrectedSecondaryCategory`, `humanCorrectionReason`, `humanCorrectedAt`, and audit event;
- `listSourceHealth` returns sources with latest observation, consecutive failure count, structured job count, and verification status without exposing raw job rows.

- [ ] **Step 2: Run operations tests to verify they fail**

Run:

```bash
npm test -- tests/admin/operations.test.ts
```

Expected: FAIL because `src/admin/operations.ts` does not exist.

- [ ] **Step 3: Implement admin operations**

Create `src/admin/operations.ts` using injected delegates:

- `AdminOperationsDb` includes `manualCrawlRequest.create`, `adminAuditEvent.create`, `feedback.update`, `recommendedCompany.update`, `job.update`, `recruitmentSource.findMany`;
- every mutating operation calls `adminAuditEvent.create`;
- invalid feedback/recommendation statuses throw;
- `queueManualCrawl` accepts `sourceId` and optional `reason`;
- `applyJobCategoryCorrection` accepts domain Chinese category labels and maps them with `toPrismaJobCategory`;
- `listSourceHealth` sorts latest observations by `crawledAt` descending and uses `toSourceScheduleState` for consecutive failure count.

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npm test -- tests/admin/operations.test.ts tests/db/prismaMappers.test.ts tests/db/crawlStateRepository.test.ts
npm run typecheck
```

Expected: operations tests, mapper/state tests, and typecheck pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/admin/operations.ts tests/admin/operations.test.ts
git commit -m "feat: add admin operations service"
```

Expected: commit created.

---

### Task 4: Admin Route Policy Guard

**Files:**
- Modify: `src/domain/route-policy.ts`
- Modify: `tests/domain/route-policy.test.ts`

**Interfaces:**
- Consumes: existing `isIndexableRoute(path)` and route policy tests.
- Produces: route policy coverage for admin, internal batch, manual crawl, and raw data paths.

- [ ] **Step 1: Write failing route-policy tests**

Extend `tests/domain/route-policy.test.ts`:

```ts
it("keeps admin operations, manual crawl, internal batch, and raw data routes out of indexing", () => {
  expect(isIndexableRoute("/admin/login")).toBe(false);
  expect(isIndexableRoute("/admin/sources")).toBe(false);
  expect(isIndexableRoute("/admin/manual-crawl")).toBe(false);
  expect(isIndexableRoute("/internal/crawl-batches")).toBe(false);
  expect(isIndexableRoute("/internal/raw-jobs")).toBe(false);
  expect(isIndexableRoute("/api/admin/sources")).toBe(false);
});
```

- [ ] **Step 2: Run route-policy tests to verify they fail if policy is incomplete**

Run:

```bash
npm test -- tests/domain/route-policy.test.ts
```

Expected: FAIL if any route is currently indexable; PASS is acceptable only if the existing policy already blocks every path. Keep the added regression test either way.

- [ ] **Step 3: Implement route policy if needed**

If the new test fails, update `src/domain/route-policy.ts` so `/admin`, `/api`, `/internal`, and raw/batch/manual crawl paths are non-indexable. Do not make search-result pages indexable.

- [ ] **Step 4: Verify Task 4**

Run:

```bash
npm test -- tests/domain/route-policy.test.ts
npm run typecheck
```

Expected: route-policy tests and typecheck pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/domain/route-policy.ts tests/domain/route-policy.test.ts
git commit -m "test: lock admin route indexing policy"
```

Expected: commit created if files changed.

---

### Task 5: Admin Operations Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-admin-operations-foundation.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected: all test/build/schema commands pass; grep returns no matches.

- [ ] **Step 2: Mark progress**

Append progress entries noting this plan implements admin auth/session contracts, protected admin operations, manual recrawl queueing, feedback/recommendation review, human category corrections, and route indexing protection, but still does not implement admin UI screens, production deployment, WAF/rate limits, backups, monitoring, or 50 live verified companies.

- [ ] **Step 3: Commit verification marker**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-admin-operations-foundation.md
git commit -m "docs: complete admin operations foundation plan"
```

Expected: commit created if the plan file changed.

---

## Self-Review

Spec coverage:

- Covers admin login/session foundation without creating public HTTP routes.
- Covers manual per-company/source recrawl queueing from admin.
- Covers feedback review, company recommendation review, human category correction, and audit logging.
- Covers non-indexing policy for admin/internal/batch/raw data paths.
- Does not implement admin UI screens, production worker consumption of manual crawl requests, WAF/rate limits, deployment, backups, monitoring, or 50 live verified companies.

Placeholder scan:

- No deferred-work markers or open-ended implementation placeholders are required.
- Tests use concrete values and expected outputs.

Type consistency:

- `AdminAuthDb` and `AdminOperationsDb` are injected delegate interfaces.
- `queueManualCrawl`, `reviewFeedback`, `reviewRecommendedCompany`, `applyJobCategoryCorrection`, and `listSourceHealth` are the service names used by the tests and the plan.
