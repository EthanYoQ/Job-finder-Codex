// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";
import { jnjDomCaptureTool, jnjDomListUrl, JNJ_DOM_URL_PROFILES } from "../../src/crawler/jnjCareersDomUrlProfile";
const oldSql=readFileSync("prisma/migrations/20261003055000_jnj_dom_evidence_admission/migration.sql","utf8");
const sql=readFileSync("prisma/migrations/20261006071300_jnj_native_url_profile/migration.sql","utf8");
const definition=(s:string)=>s.slice(s.indexOf("CREATE OR REPLACE FUNCTION"),s.lastIndexOf("$function$"))+"$function$\n";
const versionedScope="CASE official_artifact.\"captureToolVersion\" WHEN '1' THEN '&country=China&origin=global#results' WHEN '2' THEN '&country=China&pagesize=20#results' END";
it("preserves all 48 historical migration bytes and the SQL48 deployment expectation",()=>{
 expect(CLOUD_PILOT_SQL45.migrations).toHaveLength(48);
 for(const m of CLOUD_PILOT_SQL45.migrations)expect(createHash("sha256").update(readFileSync(`prisma/migrations/${m.migrationName}/migration.sql`)).digest("hex")).toBe(m.checksum);
 expect(createHash("md5").update(definition(oldSql)).digest("hex")).toBe(CLOUD_PILOT_SQL45.sourceResultGuardMd5);
});
it("changes exactly both URL signals and the homogeneous version check in the SQL48 function",()=>{
 const restored=definition(sql).replaceAll(versionedScope,"'&country=China&origin=global#results'")
  .replace("official_artifact.\"captureToolVersion\" IN ('1', '2') AND a.\"captureToolVersion\" = official_artifact.\"captureToolVersion\" AND","a.\"captureToolVersion\" = '1' AND");
 expect(restored).toBe(definition(oldSql));
 expect(sql.split(versionedScope)).toHaveLength(3);
 expect(sql).toContain("<> '8fd00ed15932e3101eec3908ac3f33f3'");
 expect(sql).toContain("SET LOCAL lock_timeout = '5s';");expect(sql).toContain("SET LOCAL statement_timeout = '30s';");
 expect(sql).not.toMatch(/\b(?:ALTER TABLE|ALTER TYPE|CREATE TABLE|CREATE TYPE|INSERT INTO|UPDATE\s+"|DELETE FROM)\b/u);
 expect(sql).not.toContain("_prisma_migrations");expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
});
it.each(JNJ_DOM_URL_PROFILES)("has exact TS/SQL version and URL literals for %s",profile=>{
 const version=jnjDomCaptureTool(profile).version;
 const suffix=jnjDomListUrl(profile,2).slice("https://www.careers.jnj.com/en/jobs/?page=2".length);
 expect(versionedScope).toContain(`WHEN '${version}' THEN '${suffix}'`);
});
