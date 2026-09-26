import { describe, expect, it } from "vitest";
import { formatMigrationProcessFailure } from "../../scripts/ops-bootstrap";

describe("deployment bootstrap migration diagnostics", () => {
  it("preserves bounded actionable failure context without exposing database credentials", () => {
    const databaseUrl = "postgresql://jobfinder:formal-qualification-password@postgres/jobfinder?schema=public";
    const message = formatMigrationProcessFailure({
      status: 1,
      signal: null,
      stderr: `P1001 cannot reach ${databaseUrl}\nsecondary postgresql://other:secret@postgres/other`
    }, databaseUrl);

    expect(message).toContain("status=1");
    expect(message).toContain("P1001");
    expect(message).toContain("[REDACTED_DATABASE_URL]");
    expect(message).toContain("postgresql://[REDACTED_URI]");
    expect(message).not.toContain("formal-qualification-password");
    expect(message).not.toContain("other:secret");
  });

  it("redacts normalized PostgreSQL credentials and bounds diagnostics", () => {
    const databaseUrl = "postgresql://user:p%40ss@postgres/jobfinder?schema=public";
    const message = formatMigrationProcessFailure({
      status: 1,
      signal: null,
      stderr: `postgre\u001b[31msql://user:p@ss@postgres/jobfinder ${"x".repeat(2_100)}`
    }, databaseUrl);

    expect(message.length).toBeLessThanOrEqual(
      "Database migration failed (status=1, signal=none, error=none): ".length + 2_000
    );
    expect(message).not.toContain("p%40ss");
    expect(message).not.toContain("p@ss");
    expect(message).not.toContain("\u001b");
    expect(message).toContain("postgresql://[REDACTED_URI]");
  });

  it("reports spawn-level failures without inventing stderr", () => {
    const error = Object.assign(new Error("spawn failed"), { code: "ETIMEDOUT" });
    expect(formatMigrationProcessFailure({ status: null, signal: "SIGTERM", stderr: "", error }, "postgresql://redacted"))
      .toBe("Database migration failed (status=null, signal=SIGTERM, error=ETIMEDOUT): no stderr");
  });
});
