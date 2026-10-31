import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExternalEvidenceSnapshot } from "./externalEvidenceValidator";

const phasePrefix="outputs/p0-rc/p0-rc-20260710-001/phase-3/";
const securityPrefix=`${phasePrefix}task-3b-security-gate-evidence-20260711t2415/`;
export const PHASE3_SECURITY_ENTRY_NAMES=["00-dump-sha.json","01-source-before.json","02-copy-counts-sql.json","03-source-before-all-counts.json","04-clone-preexist.json","05-copy-dump.json","06-create-clone.json","07-restore-clone.json","08-resolve-baseline.json","09-deploy-ten.json","10-migration-status.json","11-pgcrypto-version.json","12-extension-security-catalog.json","13-copy-smoke.json","14-constraint-smoke.json","15-wrong-valid64-sha-rejected.json","16-parent-set-mismatch-rejected.json","17-negative-rollback-count.json","18-parent-gate-setup.json","19-zero-members-nonempty-parent-rejected.json","20-zero-members-exact-empty-parent-accepted.json","21-partial-member-set-rejected.json","22-nonverified-zero-member-not-gated.json","23-nonverified-valid-pair-rejected.json","24-fixture-parent-pending.json","25-pending-valid-pair-rejected.json","26-reenable-fixture-trigger.json","27-triggers-before-unicode.json","28-copy-unicode-smoke.json","29-unicode-smoke.json","30-shadow-search-path-attack.json","31-function-security-catalog.json","32-triggers-before-repository.json","33-repository-runtime.json","34-triggers-before-tamper.json","35-committed-parent-update-rejected.json","36-triggers-before-final-counts.json","37-clone-all-counts.json","38-clone-final.json","39-source-after.json","40-source-after-all-counts.json","41-drop-clone.json","42-clone-inventory.json","43-cleanup-temp.json"] as const;
const shaBytes=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const shaFile=(path:string)=>shaBytes(readFileSync(path));
export function validatePhase3Aggregate(repoRoot:string,aggregatePath?:string,snapshot?:ExternalEvidenceSnapshot){
 if(!snapshot)throw new Error("Phase3 historical validation requires a validated external evidence snapshot");
 const failures:string[]=[];const external=(path:string)=>{const value=snapshot.files.get(path);if(!value)throw new Error(`missing validated snapshot path: ${path}`);return Buffer.from(value)};
 const qa=[
  ["task-1-pure-lifecycle-reducer-independent-qa.json",(x:any)=>x.verdict==="FINAL_BOUNDED_PASS"&&x.severity.p0===0&&x.severity.p1===0],
  ["task-2-runtime-atomic-lifecycle-binding-independent-qa.json",(x:any)=>x.decision==="FINAL_BOUNDED_PASS"&&x.severity.p0===0&&x.severity.p1===0],
  ["task-3a-lifecycle-set-reconciliation-independent-qa.json",(x:any)=>x.decision==="FINAL BOUNDED PASS"&&x.p0===0&&x.p1===0],
  ["task-3b-lifecycle-member-persistence-independent-final-qa.json",(x:any)=>x.decision==="FINAL_BOUNDED_PASS"&&x.severity.P0===0&&x.severity.P1===0]
 ] as const;
 const qaBindings:any[]=[];for(const [name,accept] of qa){const bytes=external(`${phasePrefix}${name}`),x=JSON.parse(bytes.toString("utf8"));if(!accept(x))failures.push(`QA:${name}`);qaBindings.push({path:`phase-3/${name}`,bytes:bytes.length,sha256:shaBytes(bytes)})}
 const expectedMigrations=["20260710000000_baseline","20260710005000_crawl_status_values","20260710010000_phase1_evidence","20260710015000_completeness_pending","20260710020000_source_result_state_machine","20260711050000_task5g_truth_persistence","20260711060000_transport_attempt_artifact_immutability","20260711150000_task5h_runtime_truth_closure","20260711210000_lifecycle_set_evidence_members","20260711220000_lifecycle_set_cryptographic_closure","20260711230000_parent_lifecycle_projection_gate","20260711240000_lifecycle_trigger_security_closure","20260712020000_release_runtime_identity"];
 const utf8Compare=(left:string,right:string)=>Buffer.compare(Buffer.from(left,"utf8"),Buffer.from(right,"utf8"));
 const dirs=readdirSync(join(repoRoot,"prisma/migrations"),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort(utf8Compare),extras=dirs.slice(expectedMigrations.length),historicalPrefixMatches=expectedMigrations.every((name,index)=>dirs[index]===name),lastHistorical=expectedMigrations.at(-1)!;
 const additiveMigrationsAreLater=extras.every((name,index)=>/^\d{14}_.+$/u.test(name)&&utf8Compare(lastHistorical,name)<0&&(index===0||utf8Compare(extras[index-1]!,name)<0));
 if(!historicalPrefixMatches||!additiveMigrationsAreLater)failures.push("MIGRATION_ORDER");
 const migrations=expectedMigrations.filter(name=>dirs.includes(name)).map(name=>{const p=join(repoRoot,"prisma/migrations",name,"migration.sql");return{name,bytes:statSync(p).size,sha256:shaFile(p)}});
 const manifestBytes=external(`${securityPrefix}manifest.json`),manifest=JSON.parse(manifestBytes.toString("utf8"));
 const manifestNames=manifest.files?.map((x:any)=>x.name);if(JSON.stringify(manifestNames)!==JSON.stringify(PHASE3_SECURITY_ENTRY_NAMES))failures.push("EVIDENCE_EXACT_SET");
 for(const name of PHASE3_SECURITY_ENTRY_NAMES){const bytes=external(`${securityPrefix}${name}`),binding=manifest.files?.find((x:any)=>x.name===name);if(!binding||binding.bytes!==bytes.length||binding.sha256!==shaBytes(bytes))failures.push(`EVIDENCE:${name}`)}
 const self=JSON.parse(external(`${securityPrefix}manifest-self-check.json`).toString("utf8"));if(!self.match||self.manifestSha256!==shaBytes(manifestBytes))failures.push("EVIDENCE_SELF_HASH");
 if(aggregatePath){const aggregate=JSON.parse(readFileSync(aggregatePath,"utf8"));const required=["src/evidence/phase3AggregateValidator.ts","tests/evidence/phase3AggregateValidator.test.ts","tools/historical/generatePhase3Aggregate.ts"];
  if(JSON.stringify(aggregate.contractFiles?.map((x:any)=>x.path))!==JSON.stringify(required))failures.push("CONTRACT_PATHS");for(const path of required){const p=join(repoRoot,path),bound=aggregate.contractFiles?.find((x:any)=>x.path===path);if(!bound||bound.bytes!==statSync(p).size||bound.sha256!==shaFile(p))failures.push(`CONTRACT:${path}`)}
  const p2path="outputs/p0-rc/p0-rc-20260710-001/phase-2/phase-2-holistic-independent-final-pass.json",p2=external(p2path);if(aggregate.phase2Holistic?.path!==p2path||aggregate.phase2Holistic.bytes!==p2.length||aggregate.phase2Holistic.sha256!==shaBytes(p2))failures.push("PHASE2_PHYSICAL");}
 return{status:failures.length?"FAIL":"PASS",failures,qaBindings,migrations,evidence:{files:PHASE3_SECURITY_ENTRY_NAMES.length,manifestSha256:shaBytes(manifestBytes),selfHash:true},schema:{prismaSha256:shaFile(join(repoRoot,"prisma/schema.prisma")),lockSha256:shaFile(join(repoRoot,"package-lock.json"))}};
}
