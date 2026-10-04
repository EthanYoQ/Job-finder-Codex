import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE.replace(/\.js$/, ".cjs"));
const { sourceResult, expectedContext, declarations } = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pg = await PGlite.create();
try {
  let delimiter = "$atomic_json_test$";
  while (declarations.includes(delimiter)) delimiter = delimiter.replace(/\$$/, "_x$");
  await pg.exec(`CREATE TEMP TABLE roundtrip (value jsonb);
    DO ${delimiter} DECLARE ${declarations} BEGIN
    INSERT INTO roundtrip VALUES (jsonb_build_object('sourceResult',source_result_data,'expectedContext',expected_context_data));
    END ${delimiter};`);
  const actual = (await pg.query("SELECT value FROM roundtrip")).rows[0].value;
  assert.deepEqual(actual, { sourceResult, expectedContext });
  console.log("Complete source result and expected context equal after PostgreSQL reconstruction");
} finally { await pg.close(); }
