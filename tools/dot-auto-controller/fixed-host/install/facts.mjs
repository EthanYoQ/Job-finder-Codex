/* Pure strict decoders. These checks never establish tool provenance by
 * themselves: install.functions captures the original official Promises. */
const requireFact=(ok,code)=>{if(!ok)throw Error(code);};
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const equal=(a,b)=>canonical(a)===canonical(b);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function fresh(at,now,limit=60000){const t=typeof at==='string'?Date.parse(at):NaN;requireFact(Number.isFinite(now)&&Number.isFinite(t)&&t<=now&&now-t<limit,'INSTALL_FACT_STALE');return t;}
function toolOk(raw){requireFact(record(raw)&&raw.isError!==true,'INSTALL_TOOL_ERROR');}
function sqlRows(raw){
 toolOk(raw);let s;
 if(record(raw.structuredContent)&&typeof raw.structuredContent.result==='string')s=raw.structuredContent.result;
 else {requireFact(Array.isArray(raw.content)&&raw.content.length===1&&raw.content[0].type==='text','INSTALL_SQL_WRAPPER');const parsed=JSON.parse(raw.content[0].text);requireFact(record(parsed)&&Object.keys(parsed).length===1&&typeof parsed.result==='string','INSTALL_SQL_WRAPPER');s=parsed.result;}
 const m=s.match(/\n<untrusted-data-([a-f0-9-]+)>\n([\s\S]*?)\n<\/untrusted-data-\1>/);
 requireFact(m&&(s.match(/\n<untrusted-data-[a-f0-9-]+>\n/g)||[]).length===1,'INSTALL_SQL_BOUNDARY');
 const rows=JSON.parse(m[2]);requireFact(Array.isArray(rows)&&rows.length===1&&record(rows[0]),'INSTALL_SQL_SINGLE_ROW');return rows[0];
}
function githubFacts(commitRaw,treeRaw,b){
 toolOk(commitRaw);toolOk(treeRaw);
 const c=commitRaw.structuredContent?.commit,s=treeRaw.structuredContent;
 const base='https://api.github.com/repos/EthanYoQ/Job-finder-Codex',html='https://github.com/EthanYoQ/Job-finder-Codex';
 requireFact(record(c)&&c.sha===b.commitSha&&c.repository_full_name==='EthanYoQ/Job-finder-Codex'&&c.url===base+'/commits/'+b.commitSha&&c.html_url===html+'/commit/'+b.commitSha,'INSTALL_GITHUB_COMMIT');
 requireFact(record(s)&&typeof s.content==='string'&&s.url===base+'/git/commits/'+b.commitSha,'INSTALL_GITHUB_TREE_WRAPPER');
 const t=JSON.parse(s.content);
 requireFact(record(t)&&t.sha===b.commitSha&&t.url===base+'/git/commits/'+b.commitSha&&t.html_url===html+'/commit/'+b.commitSha&&record(t.tree)&&t.tree.sha===b.treeSha&&t.tree.url===base+'/git/trees/'+b.treeSha,'INSTALL_GITHUB_TREE');
 return {commitSha:c.sha,treeSha:t.tree.sha};
}
function retirementFact(raw,expected,now){
 const row=sqlRows(raw);requireFact(Object.keys(row).join(',')==='retirement_reconciliation','INSTALL_RETIREMENT_ROW');const r=row.retirement_reconciliation;
 requireFact(record(r),'INSTALL_RETIREMENT_SHAPE');fresh(r.observedAt,now);
 requireFact(r.transactionReadOnly==='on'&&equal(r.candidate,expected)&&r.candidateFull19MatchesInvalidated===true&&r.candidateNonStatusSha256==='b686a703579fc2b340013ad4e787ac00ee5fee9d35561aa959aa81f2a9c56e2c','INSTALL_RETIREMENT_CANDIDATE');
 requireFact(r.pendingResults===0&&r.formalHolder===''&&r.originalExecutionTerminationProved===false&&r.unknownWriteReplayAllowed===false,'INSTALL_RETIREMENT_UNKNOWN');
 requireFact(r.ledgerCountCappedAt51===50&&r.ledgerDistinctNames===50&&r.canonical50LedgerMatches===true&&equal(r.ledgerMismatchNames,[])&&r.prior49CanonicalCount===49&&r.prior49FullRowsSha256==='7ac442610f9c456696e881f4d6de632ecb9ab00e5fb2bda8db3145f2a479841e','INSTALL_SCHEMA50_LEDGER');
 requireFact(r.fenceFunctionMatches===true&&r.fenceTriggerMatches===true&&equal(r.fenceFunctionObserved,{config:['search_path=pg_catalog, public'],language:'plpgsql',prosrcSha256:'0a38255081cd1b047343a0e02d82bcb89e1263364a232c46f49a834067b907da',securityDefiner:false})&&equal(r.fenceTriggerObserved,{type:23,enabled:'O',function:'guard_v75_retired_source_publication()'}),'INSTALL_SCHEMA50_FENCE');
 const m=r.new50,p=r.providerLedger;
 requireFact(record(m)&&m.name==='20261014141000_v75_retired_candidate_fence'&&m.checksum==='b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284'&&m.appliedSteps===1&&m.rolledBackAt===null&&m.honestConnectorLog===true&&typeof m.id==='string'&&Number.isFinite(Date.parse(m.startedAt))&&Number.isFinite(Date.parse(m.finishedAt))&&Date.parse(m.startedAt)<=Date.parse(m.finishedAt),'INSTALL_SCHEMA50_MIGRATION');
 requireFact(record(p)&&p.name==='jf_v75_retirement_fence_20261016'&&p.rowsCappedAt2===1&&Array.isArray(p.records)&&p.records.length===1&&p.records[0].name===p.name&&p.records[0].version==='20261016015244'&&p.records[0].statements_json_sha256==='3f0398b26fc1c07feb6defc3d8c8cd3c159413c785fb7bf62742eb0df570f095','INSTALL_PROVIDER_LEDGER');
 return r.observedAt;
}
const candidateKeys=['id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion','minimumStableCompanyCount','status'];
function candidateFact(raw,expected,now){
 requireFact(record(expected)&&equal(Object.keys(expected).sort(),candidateKeys.slice().sort()),'INSTALL_EXPECTED_16');const row=sqlRows(raw);
 requireFact(record(row.candidate)&&equal(Object.keys(row.candidate).sort(),[...candidateKeys,'createdAt','finalizedAt','releaseQaEvidenceSha256'].sort())&&candidateKeys.every(k=>row.candidate[k]===expected[k]),'INSTALL_CANDIDATE_16');fresh(row.checkedAt,now);return row.checkedAt;
}
export {requireFact,canonical,equal,fresh,sqlRows,githubFacts,retirementFact,candidateFact};
