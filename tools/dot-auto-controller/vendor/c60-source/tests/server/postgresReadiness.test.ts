import { describe, expect, it, vi } from "vitest";
import * as readinessModule from "../../src/server/postgresReadiness";
import { checkPostgresReadiness } from "../../src/server/postgresReadiness";
import { handlePublicApi } from "../../src/server/publicApi";

describe("authenticated PostgreSQL readiness", () => {
  it("exposes one timeout normalization contract", () => {
    const normalize = (readinessModule as unknown as {
      normalizePostgresReadinessTimeout?: (value: number | undefined) => number;
    }).normalizePostgresReadinessTimeout;
    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;

    expect([undefined, Number.NaN, 0, -1].map((value) => normalize(value))).toEqual([2_500, 2_500, 2_500, 2_500]);
    expect(normalize(2_500.9)).toBe(2_500);
    expect(normalize(50_000)).toBe(10_000);
  });

  it("uses a read-only bounded client, runs SELECT 1, and closes it", async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ readiness: 1 }] })),
      end: vi.fn(async () => undefined)
    };
    const createClient = vi.fn(() => client as never);

    await expect(
      checkPostgresReadiness("postgresql://user:placeholder@db/database", { timeoutMs: 200, createClient })
    ).resolves.toBe(true);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeoutMillis: 200,
      query_timeout: 200,
      statement_timeout: 200,
      options: "-c default_transaction_read_only=on"
    }));
    expect(client.query).toHaveBeenCalledWith("SELECT 1 AS readiness");
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("fails within the overall deadline and still closes a hanging client", async () => {
    const client = {
      connect: vi.fn(() => new Promise<void>(() => undefined)),
      query: vi.fn(),
      end: vi.fn(async () => undefined)
    };
    const startedAt = Date.now();

    await expect(
      checkPostgresReadiness("postgresql://user:placeholder@db/database", {
        timeoutMs: 25,
        createClient: () => client as never
      })
    ).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.end).toHaveBeenCalledOnce();
    expect(client.query).not.toHaveBeenCalled();
  });

  it("keeps the whole check bounded when client cleanup never settles", async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ readiness: 1 }] })),
      end: vi.fn(() => new Promise<void>(() => undefined))
    };
    const outcome = await Promise.race([
      checkPostgresReadiness("postgresql://user:placeholder@db/database", {
        timeoutMs: 25,
        createClient: () => client as never
      }),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 250))
    ]);

    expect(outcome).toBe(false);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("fails closed when client cleanup rejects without leaking an unhandled rejection", async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ readiness: 1 }] })),
      end: vi.fn(async () => { throw new Error("cleanup secret"); })
    };

    await expect(
      checkPostgresReadiness("postgresql://user:placeholder@db/database", {
        timeoutMs: 100,
        createClient: () => client as never
      })
    ).resolves.toBe(false);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("bounds a hanging query and returns false after initiating cleanup", async () => {
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(() => new Promise<never>(() => undefined)),
      end: vi.fn(async () => undefined)
    };
    const startedAt = Date.now();

    await expect(
      checkPostgresReadiness("postgresql://user:placeholder@db/database", {
        timeoutMs: 25,
        createClient: () => client as never
      })
    ).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("single-flights concurrent public health requests and does not retain failures", async () => {
    type Factory = (
      databaseUrl: string | undefined,
      options: {
        timeoutMs: number;
        successTtlMs: number;
        failureTtlMs: number;
        now: () => number;
        createClient: () => never;
      }
    ) => () => Promise<boolean>;
    const factory = (readinessModule as unknown as { createCachedPostgresReadiness?: Factory })
      .createCachedPostgresReadiness;
    expect(factory).toBeTypeOf("function");
    if (!factory) return;

    let now = 0;
    const createClient = vi.fn(() => ({
      connect: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      end: vi.fn(async () => undefined)
    }) as never);
    const checkDatabaseReadiness = factory("postgresql://user:placeholder@db/database", {
      timeoutMs: 100,
      successTtlMs: 1_000,
      failureTtlMs: 50,
      now: () => now,
      createClient
    });
    const request = {
      method: "GET",
      path: "/healthz",
      query: {},
      headers: {},
      body: undefined,
      ip: "127.0.0.1"
    };
    const deps = { db: {} as never, checkDatabaseReadiness, readinessTimeoutMs: 100 };

    const responses = await Promise.all(Array.from({ length: 8 }, () => handlePublicApi(request, deps)));
    expect(responses.every((response) => response.status === 503)).toBe(true);
    expect(createClient).toHaveBeenCalledOnce();

    now = 51;
    await expect(handlePublicApi(request, deps)).resolves.toMatchObject({ status: 503, body: { ok: false } });
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
