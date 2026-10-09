import { Prisma } from "@prisma/client";
import { DatabaseError } from "pg";

export interface SnapshotRefreshErrorDiagnostic {
  type: "Unknown" | "Error" | "TypeError" | "RangeError" | "AggregateError" |
    "PrismaClientKnownRequestError" | "PrismaClientUnknownRequestError" |
    "PrismaClientInitializationError" | "PrismaClientRustPanicError" |
    "PrismaClientValidationError" | "PostgresDatabaseError";
  code?: string;
  sqlState?: string;
  cause?: SnapshotRefreshErrorDiagnostic;
  truncated?: true;
}

// A format check alone could admit an arbitrary five-letter secret. Only these
// known DB failure states are useful here; other states retain their class only.
const SQL_STATES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "40001", "40P01", "42501", "42601", "42703", "42P01",
  "53000", "53100", "53200", "53300", "53400", "55000", "55006", "55P03",
  "57000", "57014", "57P01", "57P02", "57P03", "57P04", "57P05",
  "58000", "58030", "58P01", "58P02", "XX000", "XX001", "XX002"
]);
const MAX_CAUSE_NODES = 3;
function ownData(value: Error, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && "value" in property ? property.value : undefined;
}

/** Closed, bounded diagnostic data only. Never inspect names, messages, stacks,
 * metadata, arbitrary objects, inherited properties, or accessors. A classifier
 * failure must not replace the original retry path with a second rejection. */
export function describeSnapshotRefreshError(error: unknown): SnapshotRefreshErrorDiagnostic {
  const seen = new Set<Error>();
  function visit(value: unknown, depth: number): SnapshotRefreshErrorDiagnostic {
    try {
      if (!(value instanceof Error)) return {type: "Unknown"};
      if (depth >= MAX_CAUSE_NODES || seen.has(value)) return {type: "Unknown", truncated: true};
      seen.add(value);
      let type: SnapshotRefreshErrorDiagnostic["type"] = "Error";
      let codeField: "code" | "errorCode" | undefined;
      if (value instanceof Prisma.PrismaClientKnownRequestError) {type = "PrismaClientKnownRequestError"; codeField = "code";}
      else if (value instanceof Prisma.PrismaClientInitializationError) {type = "PrismaClientInitializationError"; codeField = "errorCode";}
      else if (value instanceof Prisma.PrismaClientUnknownRequestError) type = "PrismaClientUnknownRequestError";
      else if (value instanceof Prisma.PrismaClientRustPanicError) type = "PrismaClientRustPanicError";
      else if (value instanceof Prisma.PrismaClientValidationError) type = "PrismaClientValidationError";
      else if (value instanceof DatabaseError) type = "PostgresDatabaseError";
      else if (value instanceof TypeError) type = "TypeError";
      else if (value instanceof RangeError) type = "RangeError";
      else if (value instanceof AggregateError) type = "AggregateError";
      const result: SnapshotRefreshErrorDiagnostic = {type};
      if (codeField) {
        const code = ownData(value, codeField);
        if (typeof code === "string" && /^P[0-9]{4}$/.test(code)) result.code = code;
      } else if (type === "PostgresDatabaseError") {
        const code = ownData(value, "code");
        if (typeof code === "string" && SQL_STATES.has(code)) result.sqlState = code;
      }
      const cause = ownData(value, "cause");
      if (cause !== undefined) result.cause = visit(cause, depth + 1);
      return result;
    } catch {
      return {type: "Unknown"};
    }
  }
  return visit(error, 0);
}
