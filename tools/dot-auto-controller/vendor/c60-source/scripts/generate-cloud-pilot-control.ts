// Local-only compiler. Input contains reviewed actual build/candidate data, never credentials.
// Usage: tsx scripts/generate-cloud-pilot-control.ts candidate|create-pending|finalize input.json output.sql
import { readFile, writeFile } from "node:fs/promises";
import { compileCloudPilotCandidateSql, compileCloudPilotCreatePendingSql, compileCloudPilotFinalizeSql } from "../src/db/cloudPilotSqlControl";
const [operation,inputPath,outputPath,...extra]=process.argv.slice(2);
if(!inputPath||!outputPath||extra.length||!["candidate","create-pending","finalize"].includes(operation??""))throw Error("Usage: generate-cloud-pilot-control.ts candidate|create-pending|finalize input.json output.sql");
const bytes=await readFile(inputPath);if(bytes.length>1_000_000)throw Error("PILOT_INPUT_TOO_LARGE");
const input=JSON.parse(bytes.toString("utf8"));
const sql=operation==="candidate"?compileCloudPilotCandidateSql(input):operation==="create-pending"?compileCloudPilotCreatePendingSql(input):compileCloudPilotFinalizeSql(input);
await writeFile(outputPath,sql,{flag:"wx",mode:0o600});
console.log(JSON.stringify({classification:"LOCAL_FIXED_SQL_CONTROL_NOT_EXECUTED",operation,outputPath,bytes:Buffer.byteLength(sql),replayAllowed:false}));
