// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ clients: [] as any[], constructor: vi.fn(), run: vi.fn(), wait: vi.fn(), authority: vi.fn(), stop: undefined as (() => void) | undefined }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  $disconnect = vi.fn(async () => {});
  crawlBatch = { findFirst: vi.fn(async () => null) };
  constructor(...args: unknown[]) { hooks.constructor(...args); hooks.clients.push(this); }
} }));
vi.mock("../../src/crawler/portableScheduledCrawl", () => ({ runPortableScheduledCrawl: hooks.run }));
vi.mock("../../src/crawler/stagedScheduleAuthority", () => ({ resolveCurrentStagedScheduleAuthority: hooks.authority }));
vi.mock("node:timers/promises", () => ({ setTimeout: hooks.wait }));
const argv = process.argv, exitCode = process.exitCode;
const report = { policyId: "test", identity: { releaseCandidateId: "test" }, coverage: { requiredSourceIds: [] }, result: { status: "SUCCESS" } };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); hooks.constructor.mockReset(); hooks.clients.length = 0; hooks.stop = undefined;
  process.argv = ["node", "portable-script"]; process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "once").mockImplementation(((signal: string, handler: () => void) => { if (signal === "SIGTERM") hooks.stop = handler; return process; }) as any);
  hooks.authority.mockResolvedValue({ identity: { releaseCandidateId: "test" } });
  hooks.wait.mockResolvedValue(undefined);
  hooks.run.mockResolvedValue(report);
});
afterEach(() => { process.argv = argv; process.exitCode = exitCode; vi.restoreAllMocks(); });

function expectSeparateClients() {
  expect(hooks.constructor.mock.calls).toEqual([[], []]);
  expect(hooks.clients).toHaveLength(2);
  for (const [input] of hooks.run.mock.calls) { expect(input.db).toBe(hooks.clients[0]); expect(input.leaseDb).toBe(hooks.clients[1]); }
  for (const client of hooks.clients) expect(client.$disconnect).toHaveBeenCalledTimes(1);
}
describe("portable Prisma client lifecycle", () => {
  it("disconnects the primary CLI client when control-client construction throws", async () => {
    hooks.constructor.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error("CONSTRUCTION_FAILED"); });
    await import("../../scripts/p0-portable-crawl");
    expect(hooks.clients).toHaveLength(1); expect(hooks.clients[0].$disconnect).toHaveBeenCalledTimes(1);
    expect(hooks.run).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
  });
  it("disconnects the primary scheduler client when control-client construction throws", async () => {
    hooks.constructor.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error("CONSTRUCTION_FAILED"); });
    await expect(import("../../scripts/p0-portable-scheduler")).rejects.toThrow("CONSTRUCTION_FAILED");
    expect(hooks.clients).toHaveLength(1); expect(hooks.clients[0].$disconnect).toHaveBeenCalledTimes(1);
    expect(hooks.run).not.toHaveBeenCalled();
  });
  it("creates the CLI clients with the existing datasource and disconnects both after success", async () => {
    await import("../../scripts/p0-portable-crawl"); expectSeparateClients(); expect(process.exitCode).toBe(0);
  });
  it.each([[0, false], [1, false], [0, true], [1, true]] as const)("disconnects both CLI clients when work and disconnect %i fail (synchronous: %s)", async (failedClient, synchronous) => {
    hooks.run.mockImplementation(async () => {
      if (synchronous) hooks.clients[failedClient].$disconnect.mockImplementation(() => { throw Error("DISCONNECT_FAILED"); });
      else hooks.clients[failedClient].$disconnect.mockRejectedValue(Error("DISCONNECT_FAILED"));
      throw Error("WORK_FAILED");
    });
    await import("../../scripts/p0-portable-crawl"); expectSeparateClients(); expect(process.exitCode).toBe(1);
  });
  it("constructs no clients for invalid CLI arguments", async () => {
    process.argv.push("--invalid"); await import("../../scripts/p0-portable-crawl");
    expect(hooks.clients).toEqual([]); expect(process.exitCode).toBe(2);
  });
  it.each([[0, false], [1, false], [0, true], [1, true]] as const)("reuses the same two scheduler clients across iterations when disconnect %i fails (synchronous: %s)", async (failedClient, synchronous) => {
    let runs = 0;
    hooks.run.mockImplementation(async () => {
      if (++runs === 2) {
        if (synchronous) hooks.clients[failedClient].$disconnect.mockImplementation(() => { throw Error("DISCONNECT_FAILED"); });
        else hooks.clients[failedClient].$disconnect.mockRejectedValue(Error("DISCONNECT_FAILED"));
        hooks.stop!(); throw Error("WORK_FAILED");
      }
      return report;
    });
    await import("../../scripts/p0-portable-scheduler");
    expect(hooks.run).toHaveBeenCalledTimes(2); expectSeparateClients();
    expect(hooks.clients[0].crawlBatch.findFirst).toHaveBeenCalledTimes(2);
    expect(hooks.clients[1].crawlBatch.findFirst).not.toHaveBeenCalled();
  });
});
