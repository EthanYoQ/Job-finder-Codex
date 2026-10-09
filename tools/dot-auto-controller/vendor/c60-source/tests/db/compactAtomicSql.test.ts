// @vitest-environment node
import { expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ownedPortableFixture } from "./helpers/ownedPortableCommit";
import { buildAtomicRuntimeCommit } from "../../src/crawler/runtimeAtomicEvidence";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";
import { compilePortableAtomicSourceEvidenceSql } from "../../src/db/ingestionRepository";

it.skipIf(!process.env.PGLITE_MODULE)("preserves typed mappings, defaults, human fields and rollback in compact SQL", async () => {
  const f = await ownedPortableFixture({title:"销售 O'Brien \\ $$",transport:true});
  const commit=buildAtomicRuntimeCommit(f.args);
  const lease=await acquirePortableCrawlLease({$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})});
  const sql=await compilePortableAtomicSourceEvidenceSql(commit,lease);
  expect(sql.match(/INSERT INTO public\."Job"/g)).toHaveLength(1);
  expect(sql).toContain("WITH ORDINALITY");
  const root=await mkdtemp(join(tmpdir(),"compact-sql-"));
  try {
    const path=join(root,"input.json");
    await writeFile(path,JSON.stringify({Prisma:{dmmf:Prisma.dmmf},f:{...f,dedupeKey:buildJobDedupeKey(f.input.result.jobs[0]!)},commit,sql,lease}));
    if(process.env.COMPACT_SQL_INPUT_PATH){
      await writeFile(process.env.COMPACT_SQL_INPUT_PATH,await (await import("node:fs/promises")).readFile(path));
      return;
    }
    // Native child avoids retaining Vitest transforms inside PGlite's WASM heap.
    const result=spawnSync(process.execPath,["--max-old-space-size=384",resolve("tests/db/helpers/checkCompactSql.mjs"),path],{encoding:"utf8"});
    expect(result.status,result.stderr || result.signal || "PGlite check failed").toBe(0);
  } finally {await rm(root,{recursive:true,force:true});}
},30000);
