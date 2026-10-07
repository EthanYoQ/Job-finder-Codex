import { Prisma } from "@prisma/client";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";
import { describeSnapshotRefreshError } from "../../src/server/snapshotRefreshError";

const SECRET = "secret-sentinel-postgresql://user:password@private/db?token=hidden";
const known = (code = "P2028") => new Prisma.PrismaClientKnownRequestError(SECRET, {
  code, clientVersion: SECRET, meta: {url: SECRET, query: SECRET, code: "57014", nested: {secret: SECRET}}
});

describe("closed snapshot refresh diagnostics", () => {
  it("uses actual Prisma classes and their own code fields, never sensitive payloads", () => {
    const error = known();
    Object.assign(error, {name: SECRET, stack: SECRET, url: SECRET, sql: SECRET, env: {secret: SECRET}});
    const result = describeSnapshotRefreshError(new Error(SECRET, {cause: error}));
    expect(result).toEqual({type: "Error", cause: {type: "PrismaClientKnownRequestError", code: "P2028"}});
    expect(JSON.stringify(result)).not.toMatch(/secret|password|postgresql|private|hidden|57014/);
    expect(describeSnapshotRefreshError(new Prisma.PrismaClientInitializationError(SECRET, SECRET, "P1001")))
      .toEqual({type: "PrismaClientInitializationError", code: "P1001"});
    expect(describeSnapshotRefreshError(known(SECRET))).toEqual({type: "PrismaClientKnownRequestError"});
  });

  it("accepts a closed SQLSTATE only on the real Postgres error class", () => {
    const error = Object.assign(new DatabaseError(SECRET, 0, "error"), {code: "57014", detail: SECRET, query: SECRET});
    expect(describeSnapshotRefreshError(error)).toEqual({type: "PostgresDatabaseError", sqlState: "57014"});
    error.code = "TOKEN";
    expect(describeSnapshotRefreshError(error)).toEqual({type: "PostgresDatabaseError"});
    error.code = SECRET;
    expect(describeSnapshotRefreshError(error)).toEqual({type: "PostgresDatabaseError"});
  });

  it("does not trust thrown objects, spoofed names, or generic Error codes", () => {
    for (const value of [undefined, null, SECRET, 57014, {name: "PrismaClientKnownRequestError", code: "P2028", cause: known()}]) {
      expect(describeSnapshotRefreshError(value)).toEqual({type: "Unknown"});
    }
    for (const code of ["P2028", "57014", SECRET]) {
      expect(describeSnapshotRefreshError(Object.assign(new Error(SECRET), {name: "PrismaClientKnownRequestError", code}))).toEqual({type: "Error"});
    }
    expect(describeSnapshotRefreshError(new AggregateError([known(), {secret: SECRET}], SECRET))).toEqual({type: "AggregateError"});
  });

  it("never invokes accessors, stringifiers, inherited codes, or hostile proxy traps successfully", () => {
    const error = known();
    let accesses = 0;
    for (const key of ["name", "message", "stack", "code", "cause", "meta", "toJSON"]) {
      Object.defineProperty(error, key, {get() {accesses++; throw new Error(SECRET);}, configurable: true});
    }
    expect(describeSnapshotRefreshError(error)).toEqual({type: "PrismaClientKnownRequestError"});
    expect(accesses).toBe(0);
    const inherited = known();
    delete (inherited as {code?: string}).code;
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Object.getPrototypeOf(inherited)), {code: "P2028"}));
    expect(describeSnapshotRefreshError(inherited)).toEqual({type: "PrismaClientKnownRequestError"});
    const proxy = new Proxy(new Error(SECRET), {getPrototypeOf() {throw new Error(SECRET);}});
    expect(describeSnapshotRefreshError(proxy)).toEqual({type: "Unknown"});
  });

  it("bounds cause depth and cycles without walking nested business objects", () => {
    const cycle = new Error(SECRET); cycle.cause = cycle;
    expect(describeSnapshotRefreshError(cycle)).toEqual({type: "Error", cause: {type: "Unknown", truncated: true}});
    let chain: Error = known();
    for (let i = 0; i < 100; i++) chain = new Error(SECRET, {cause: chain});
    expect(describeSnapshotRefreshError(chain)).toEqual({type: "Error", cause: {type: "Error", cause: {type: "Error", cause: {type: "Unknown", truncated: true}}}});
    expect(describeSnapshotRefreshError(new Error(SECRET, {cause: {code: "P2028", cause: known(), secret: SECRET}})))
      .toEqual({type: "Error", cause: {type: "Unknown"}});
  });
});
