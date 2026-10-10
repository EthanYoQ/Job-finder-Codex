import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE.replace(/\.js$/, ".cjs"));
const { Prisma, f, commit, sql, lease } = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const buildJobDedupeKey = () => f.dedupeKey;
const expect = (actual) => ({ toBe: expected => assert.equal(actual, expected), toEqual: expected => assert.deepEqual(actual, expected), toHaveLength: expected => assert.equal(actual.length, expected), toMatchObject: expected => { for (const [key, value] of Object.entries(expected))
        assert.deepEqual(actual[key], value); }, rejects: { toThrow: async (expected) => assert.rejects(actual, error => error.message.includes(expected)) } });
const pg = await PGlite.create();
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const tables = ["Job", "EvidenceArtifact", "PaginationEvidence", "LossLedgerEntry", "TransportAttemptEvidence",
    "TransportAttemptArtifact", "CrawlObservation", "LifecycleSetEvidenceMember", "CrawlBatchSourceResult", "CrawlCoordinatorLock"];
try {
    await pg.exec('CREATE TABLE "CrawlCoordinatorLock" ("id" text PRIMARY KEY, "holderId" text, "heartbeatAt" timestamptz)');
    for (const e of Prisma.dmmf.datamodel.enums)
        await pg.exec(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map(v => quote(v.dbName ?? v.name)).join(",")})`);
    for (const model of Prisma.dmmf.datamodel.models.filter(m => tables.includes(m.name))) {
        const columns = model.fields.filter(f => f.kind !== "object").map(f => {
            const type = f.kind === "enum" ? `"${f.type}"` : { String: "text", Boolean: "boolean", Int: "integer", BigInt: "bigint", Float: "double precision", Decimal: "numeric", DateTime: "timestamp(3)", Json: "jsonb", Bytes: "bytea" }[f.type];
            const d = f.default;
            const fallback = d === undefined ? "" : Array.isArray(d) ? " DEFAULT '{}'" : typeof d === "object" ? (d.name === "now" ? " DEFAULT CURRENT_TIMESTAMP" : "") : typeof d === "string" ? ` DEFAULT ${quote(d)}` : ` DEFAULT ${String(d)}`;
            return `"${f.dbName ?? f.name}" ${type}${f.isList ? "[]" : ""}${fallback}${f.isId ? " PRIMARY KEY" : ""}`;
        });
        await pg.exec(`CREATE TABLE "${model.name}" (${columns.join(",")}${model.name === "Job" ? ', UNIQUE ("sourceId", "dedupeKey")' : ""})`);
    }
    await pg.query('INSERT INTO "CrawlCoordinatorLock" ("id","holderId","heartbeatAt") VALUES ($1,$2,clock_timestamp())',[lease.lockId,lease.holderId]);
    const insert = async (table, data) => {
        const columns = Object.keys(data).map(k => `"${k}"`).join(",");
        await pg.query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`, [JSON.stringify(data)]);
    };
    await insert("CrawlBatchSourceResult", { ...commit.sourceResult, transportState: "PENDING", adapterState: "PENDING", completenessState: "PENDING", atomicCommitState: "PENDING", finishedAt: null });
    await insert("Job", { id: "human-job", sourceId: f.input.plan.source.id, dedupeKey: buildJobDedupeKey(f.input.result.jobs[0]),
        officialTitle: "Old title", category: "销售", auxiliaryChineseTitle: "人工辅助", humanCorrectedTitle: "人工标题",
        firstSeenAt: "2025-01-01T00:00:00.000Z", aiReviewRequired: true, classificationHardRuleHits: ["retained"] });
    // A failed final PENDING transition must roll back the batched inserts, Job loop and heartbeat.
    await pg.exec('UPDATE "CrawlBatchSourceResult" SET "atomicCommitState"=\'COMMITTED\'');
    const heartbeat = (await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows;
    await expect(pg.exec(sql)).rejects.toThrow("Expected exactly one matching PENDING source result");
    expect((await pg.query('SELECT count(*)::int AS n FROM "EvidenceArtifact"')).rows[0].n).toBe(0);
    expect((await pg.query('SELECT "officialTitle" FROM "Job"')).rows).toEqual([{ officialTitle: "Old title" }]);
    expect((await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows).toEqual(heartbeat);
    await pg.exec('UPDATE "CrawlBatchSourceResult" SET "atomicCommitState"=\'PENDING\'');
    await pg.exec("BEGIN");
    await pg.exec(sql);
    const jobs = (await pg.query('SELECT * FROM "Job" ORDER BY "dedupeKey"')).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs.find((j) => j.id === "human-job")).toMatchObject({ officialTitle: "销售 O'Brien \\ $$", category: "销售",
        auxiliaryChineseTitle: "人工辅助", humanCorrectedTitle: "人工标题", aiReviewRequired: true, classificationHardRuleHits: ["retained"] });
    expect((await pg.query('SELECT "firstSeenAt"::text AS value FROM "Job" WHERE id=\'human-job\'')).rows[0].value).toBe("2025-01-01 00:00:00");
    await pg.exec('ROLLBACK; DELETE FROM "Job"');
    await pg.exec(sql);
    expect((await pg.query('SELECT * FROM "Job"')).rows[0]).toMatchObject({cities:["上海市"],aiReviewRequired:false,classificationHardRuleHits:[]});
    expect((await pg.query('SELECT to_jsonb("stableRequiredFields") AS "stableRequiredFields" FROM "CrawlObservation"')).rows[0].stableRequiredFields).toEqual(["company", "title", "officialUrl", "location"]);
    expect((await pg.query('SELECT count(*)::int AS n FROM "TransportAttemptArtifact"')).rows[0].n).toBe(f.input.archive.artifacts.length);
    expect((await pg.query('SELECT "completenessCertificate", "finishedAt" FROM "CrawlBatchSourceResult"')).rows[0].completenessCertificate).toEqual(JSON.parse(JSON.stringify(commit.sourceResult.completenessCertificate)));
    expect((await pg.query('SELECT count(*)::int AS n FROM "LifecycleSetEvidenceMember" WHERE "createdAt" IS NOT NULL')).rows[0].n).toBe(2);
}
catch (error) { console.error(error.message); process.exitCode=1; }
finally {
    await pg.close();
}
