// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/server/httpServer";
import { readPortablePublicSnapshot, type PortableSnapshotDb } from "../../src/db/portablePublicSnapshotRepository";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";
import { accepted, job, plan, NOW } from "../helpers/portablePublicSnapshotFixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {resolve = done;});
  return {promise, resolve};
}

async function heldHttpResponse(path: string) {
  const evidence = accepted();
  const tx = {
    crawlBatchSourceResult: {findMany: async () => [evidence.result]},
    lifecycleSetEvidenceMember: {findMany: async () => evidence.members},
    job: {findMany: async () => [job()]}
  };
  const snapshot = await readPortablePublicSnapshot({$transaction: async work => work(tx)} as PortableSnapshotDb, {currentTime: NOW}, [plan]);
  let barrier: Promise<void> | undefined;
  const readWithStatus = vi.fn(async (responseFinished?: Promise<void>) => {
    barrier = responseFinished;
    return {snapshot, snapshotRefresh: {state: "CURRENT" as const, version: "a".repeat(64)}};
  });
  const read = Object.assign(async () => snapshot, {readWithStatus});
  const server = createServer({db: {} as never, checkDatabaseReadiness: async () => true,
    readPortableSnapshot: read, rateLimitStore: createMemoryRateLimitStore()});
  const firstWrite = deferred(), finished = deferred();
  let pendingWrite: (() => void) | undefined, released = false;
  // Native HTTP request/response behavior with deterministic writable backpressure,
  // without listening on a port or using a fake response implementation.
  const socket = new Duplex({read() {}, write(_chunk, _encoding, callback) {
    if (released) callback();
    else {pendingWrite = callback; firstWrite.resolve();}
  }});
  const incoming = new IncomingMessage(socket as Socket);
  incoming.method = "GET"; incoming.url = path;
  incoming.headers = {host: "127.0.0.1", "x-job-search-consent": "accepted", "accept-encoding": "gzip"};
  const response = new ServerResponse(incoming);
  response.assignSocket(socket as Socket);
  response.once("finish", finished.resolve);
  server.emit("request", incoming, response);
  await firstWrite.promise;
  return {response, readWithStatus, barrier: barrier!, finished: finished.promise,
    release: () => {released = true; pendingWrite?.();}, close: () => socket.destroy()};
}

describe("portable snapshot HTTP response barrier", () => {
  it.each(["destroyed", "finished"] as const)("settles an already %s response without waiting for another terminal event", async state => {
    const observed = deferred();
    let barrier: Promise<void> | undefined;
    const read = Object.assign(async () => ({} as never), {readWithStatus: async (responseFinished?: Promise<void>) => {
      barrier = responseFinished;
      observed.resolve();
      // Stop this deliberately terminal request before projection; only the
      // native response lifecycle and the passed refresh barrier are relevant.
      throw new Error("closed request test");
    }});
    const server = createServer({db: {} as never, checkDatabaseReadiness: async () => true,
      readPortableSnapshot: read, rateLimitStore: createMemoryRateLimitStore()});
    const socket = new Duplex({read() {}, write(_chunk, _encoding, callback) {callback();}});
    const incoming = new IncomingMessage(socket as Socket);
    incoming.method = "GET"; incoming.url = "/api/coverage";
    incoming.headers = {host: "127.0.0.1", "x-job-search-consent": "accepted"};
    const response = new ServerResponse(incoming);
    response.assignSocket(socket as Socket);
    const terminal = deferred();
    response.once(state === "destroyed" ? "close" : "finish", terminal.resolve);
    response.on("error", () => undefined);
    if (state === "destroyed") response.destroy(); else response.end();
    await terminal.promise;
    expect(state === "destroyed" ? response.destroyed : response.writableFinished).toBe(true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      server.emit("request", incoming, response);
      await observed.promise;
      let settled = false;
      void barrier!.then(() => {settled = true;});
      await nextTurn();
      expect(settled).toBe(true);
    } finally {log.mockRestore(); socket.destroy();}
  });

  it.each(["/api/search?city=%E4%B8%8A%E6%B5%B7", "/api/coverage"])("holds %s refresh until native response finish", async path => {
    const http = await heldHttpResponse(path);
    let released = false;
    void http.barrier.then(() => {released = true;});
    await nextTurn();
    expect(released).toBe(false);
    expect(http.readWithStatus).toHaveBeenCalledOnce();
    http.release();
    await http.finished;
    await http.barrier;
    expect(released).toBe(true);
    expect(http.response.listenerCount("close")).toBe(0);
    http.close();
  });

  it("releases the barrier on early close, even when the response has not finished", async () => {
    const http = await heldHttpResponse("/api/coverage");
    let finished = false;
    void http.finished.then(() => {finished = true;});
    http.response.emit("close");
    await http.barrier;
    expect(finished).toBe(false);
    http.release();
    await http.finished;
    http.close();
  });
});
