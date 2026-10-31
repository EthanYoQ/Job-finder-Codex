/** Closed diagnostics only: driver messages/stacks can contain connection secrets. */
const types = new Set(["Error","TypeError","RangeError","AggregateError","PortableCrawlLeaseError",
  "PrismaClientKnownRequestError","PrismaClientUnknownRequestError","PrismaClientInitializationError",
  "PrismaClientRustPanicError","PrismaClientValidationError","AtomicCommitOutcomeUnverifiedError","AtomicEvidenceCommitError"]);
const reasons = new Set(["CRAWL_LEASE_BUSY","CRAWL_LEASE_LOST","CRAWL_LEASE_IO_FAILED","CRAWL_LEASE_NOT_OWNED",
  "PORTABLE_CRAWL_LEASE_LOST","PERSISTED_BATCH_SUMMARY_UNAVAILABLE","ORPHAN_LEDGER_RECORDING_FAILED",
  "ATOMIC_EVIDENCE_SOURCE_TERMINAL_WRITE_FAILED","ATOMIC_EVIDENCE_COMMIT_OUTCOME_UNVERIFIED",
  "SOURCE_QUALITY_ADMISSION_REJECTED","SOURCE_QUALITY_POLICY_NOT_REVIEWED","SOURCE_COVERAGE_REVIEW_PENDING",
  "MIGRATION_RECONCILIATION_STATE_REQUIRED","LEGACY_UNKNOWN_RECONCILE_ONLY","RECONCILE_PENDING_COMMIT",
  "RECONCILE_RUNNING_BATCH","RECONCILE_MANUAL_REQUEST","CANDIDATE_NOT_ACTIVE","RESTORED_SOURCE_CATALOG_REQUIRED"]);
export interface PortableRuntimeDiagnostic { type:string; code?:string; reason?:string; cause?:PortableRuntimeDiagnostic; errors?:PortableRuntimeDiagnostic[]; truncated?:boolean; }
export function describePortableRuntimeError(error:unknown):PortableRuntimeDiagnostic {
  const seen=new Set<unknown>();
  function visit(value:unknown,depth:number):PortableRuntimeDiagnostic {
    if(!(value instanceof Error))return {type:"Unknown"};
    if(depth>=5||seen.has(value))return {type:"Other",truncated:true};
    seen.add(value);
    const result:PortableRuntimeDiagnostic={type:types.has(value.name)?value.name:"Other"};
    const code=(value as Error & {code?:unknown}).code;
    if(typeof code==="string"&&(/^P[0-9]{4}$/.test(code)||/^[0-9]{5}$/.test(code)||reasons.has(code)))result.code=code;
    const reason=value.message.split(":",1)[0]!;
    if(reasons.has(reason))result.reason=reason;
    if(value.cause!==undefined)result.cause=visit(value.cause,depth+1);
    if(value instanceof AggregateError){result.errors=value.errors.slice(0,6).map(v=>visit(v,depth+1));if(value.errors.length>6)result.truncated=true;}
    return result;
  }
  return visit(error,0);
}
