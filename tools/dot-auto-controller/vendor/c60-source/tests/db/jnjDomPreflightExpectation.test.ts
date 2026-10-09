// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";
it("pins only SQL47 plus the authorized JNJ function migration, without pending Lilly changes",()=>{
 const history=CLOUD_PILOT_SQL45.migrations;
 expect(history).toHaveLength(48);
 expect(history.some(m=>String(m.migrationName)==="20261002103742_lilly_source_policy")).toBe(false);
 for(const m of history)expect(createHash("sha256").update(readFileSync(`prisma/migrations/${m.migrationName}/migration.sql`)).digest("hex")).toBe(m.checksum);
 const last=history.at(-1)!;expect(last.migrationName).toBe("20261003055000_jnj_dom_evidence_admission");
 const sql=readFileSync(`prisma/migrations/${last.migrationName}/migration.sql`,"utf8");
 const definition=sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"),sql.lastIndexOf("$function$"))+"$function$\n";
 expect(createHash("md5").update(definition).digest("hex")).toBe(CLOUD_PILOT_SQL45.sourceResultGuardMd5);
});
