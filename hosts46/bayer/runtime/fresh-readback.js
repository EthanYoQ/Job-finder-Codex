// functions.exec fragment. Read-only database/state gate, callable before capture and again at launch.
const A=Object.getPrototypeOf(async function(){}).constructor,h=await new A(load('restored46:bayer:cloudPilotHostHelpers'))();
await h.cmd('node '+h.q(h.cfg.root+'/runtime/publisher-state-guard.mjs')+' idle',2000);
const expected=JSON.parse((await h.readFile(h.cfg.root+'/runtime/expected-database.json')).text);
const query=(await h.readFile(h.cfg.root+'/runtime/fresh-readback.sql')).text;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query}),rows=h.rows(raw);
if(rows.length!==1)throw Error('FRESH_READBACK_ROW_COUNT');
const row=rows[0],age=Date.now()-Date.parse(row.checkedAt);
if(!Number.isFinite(age)||age< -1000||age>60000)throw Error('FRESH_READBACK_TIME');
if(row.holderId!==''||!Array.isArray(row.sameSourceRunning))throw Error('FRESH_HOLDER_OR_SAME_SOURCE_OVERLAP');
if(row.candidateRows?.length!==1||Object.entries(expected.candidate).some(([k,v])=>row.candidateRows[0][k]!==v))throw Error('FRESH_CANDIDATE_PRECONDITION');
if(!Array.isArray(row.migrationRows)||row.migrationRows.length!==expected.migrations.length||new Set(row.migrationRows.map(m=>m.migrationName)).size!==expected.migrations.length||row.sourceResultGuardMd5!==expected.sourceResultGuardMd5)throw Error('FRESH_DB48_SCHEMA');
for(const m of expected.migrations){const found=row.migrationRows.find(r=>r.migrationName===m.migrationName);if(!found||found.checksum!==m.checksum||!found.finishedAt||found.rolledBackAt!==null)throw Error('FRESH_DB48_MIGRATION');}
const requireDue=await new A((await h.readFile(h.cfg.root+'/runtime/observation-due-gate.js')).text)();
const due=requireDue(row,h.cfg);
const overlap={checkedAt:row.checkedAt,sourceId:h.cfg.sourceId,ignoredHistoricalRows:[],blockingRows:row.sameSourceRunning};
store('restored46:bayer:lastOverlapReadback',overlap);store('restored46:bayer:lastFreshReadbackRaw',raw);
if(overlap.blockingRows.length)throw Error('FRESH_HOLDER_OR_SAME_SOURCE_OVERLAP:'+overlap.blockingRows.length);
return {raw,row,due,overlap};
