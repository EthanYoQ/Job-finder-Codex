// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeDeclarations } from "../../../../native/review-packet-envelope.mts";
import { compileAtomicJsonDeclarations } from "../../src/db/atomicJsonDeclarations";

function fixture() {
  const leaf = { body: "O'Brien \\ $$ 中文\n\t".repeat(100), explicitNull: null, omitted: undefined,
    capturedAt: "2026-10-03T17:55:17.547450+00:00", numbers: [0, -0, 1e-9, Number.MAX_SAFE_INTEGER] };
  const shared = { leaf, duplicate: leaf, emptyArray: [], emptyObject: {} };
  return {
    sourceResult: { proof: shared, arrays: Array.from({ length: 135 }, (_, i) => i % 2 ? shared : [null, leaf]),
      manyKeys: Object.fromEntries(Array.from({ length: 75 }, (_, i) => [`key'\\${i}`, leaf])),
      specialKeys: JSON.parse('{"__proto__":{"kept":true},"constructor":null}'),
      time: new Date("2026-10-03T17:55:17.547Z") },
    expectedContext: { latestAccepted: shared, firstAccepted: shared, nullValue: null, missing: undefined }
  };
}

it("declares shared subtree dependencies before their users without mutating either input", () => {
  const values = fixture(), before = JSON.stringify(values);
  const sql = compileAtomicJsonDeclarations(values.sourceResult, values.expectedContext);
  expect(JSON.stringify(values)).toBe(before);
  const declared = new Set<string>();
  for (const line of sql.split("\n")) {
    const declaration = /^(\w+) jsonb := /.exec(line)!;
    expect(declaration).not.toBeNull();
    for (const reference of line.slice(declaration[0].length).match(/atomic_json_\d+/g) ?? []) expect(declared.has(reference)).toBe(true);
    declared.add(declaration[1]!);
  }
  expect(declared.has("source_result_data")).toBe(true);
  expect(declared.has("expected_context_data")).toBe(true);
  expect(Buffer.byteLength(sql)).toBeLessThan(Buffer.byteLength(before) / 4);
});

it.skipIf(!process.env.PGLITE_MODULE)("round-trips complete values through PostgreSQL with escaping, nulls, missing fields and long arrays/objects", async () => {
  const values = fixture(), declarations = compileAtomicJsonDeclarations(values.sourceResult, values.expectedContext);
  const root = await mkdtemp(join(tmpdir(), "atomic-json-"));
  try {
    const path = join(root, "input.json");
    await writeFile(path, JSON.stringify({ ...values, declarations }));
    const result = spawnSync(process.execPath, ["--max-old-space-size=192", "--liftoff-only", "--no-wasm-tier-up", resolve("tests/db/helpers/checkAtomicJson.mjs"), path], { encoding: "utf8" });
    expect(result.status, result.stderr || result.signal || "PGlite check failed").toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

// Reuse the existing typed-record encoding for large declaration arrays too.
it("losslessly packs uniform records and rejects an invalid tuple index", () => {
  const rows = Array.from({length: 12}, (_,n) => ({common: "repeat".repeat(40), n,
    duplicate: n, explicitNull: null, detail: {quote: "O\'Brien\\path", ok: true}}));
  const sourceResult = {rows}, expectedContext = {oldRows: rows.slice(0, 8)};
  const declarations = compileAtomicJsonDeclarations(sourceResult, expectedContext);
  expect(declarations).toContain("WITH ORDINALITY AS tuple");
  expect(decodeDeclarations(declarations)).toEqual({terminal: sourceResult, context: expectedContext});
  expect(() => decodeDeclarations(declarations.replace("tuple.value->0", "tuple.value->999999"))).toThrow();
});


it("shares repeated nested evidence without discarding cheaper uniform-record packing", () => {
  const dom = { html: "O'Brien \\ 中文\n".repeat(600), page: 1 };
  const rows = Array.from({ length: 30 }, (_, n) => ({ id: n, payload: { dom, body: `original-${n}` } }));
  const sourceResult = { pages: [{ rawRows: rows }, { rawRows: rows.map(row => ({ ...row, id: row.id + 30 })) }] };
  const expectedContext = { sourceId: "fixture" };
  const before = JSON.stringify({ sourceResult, expectedContext });
  const declarations = compileAtomicJsonDeclarations(sourceResult, expectedContext);
  expect(JSON.stringify({ sourceResult, expectedContext })).toBe(before);
  expect(decodeDeclarations(declarations)).toEqual({ terminal: sourceResult, context: expectedContext });
  expect(Buffer.byteLength(declarations)).toBeLessThan(Buffer.byteLength(before) / 4);
});
