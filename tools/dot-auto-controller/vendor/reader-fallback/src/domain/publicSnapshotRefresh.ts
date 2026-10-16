/** Status and opaque identity for the exact verified display in this response.
 * CURRENT means current at its version check, never a promise about later commits.
 */
export interface PublicSnapshotRefresh {
  state: "CURRENT" | "UPDATING" | "FAILED";
  /** Legacy complete-snapshot identity, including its original verification time. */
  version: string;
  /** Present on portable readers; excludes receipt IDs and observation-only times. */
  displayDataVersion?: string;
  /** Snapshot status identity. Always process state too, even when this is unchanged. */
  statusVersion?: string;
  /** Complete verified projection identity, independent of the data-only version. */
  verificationVersion?: string;
  /** Original snapshot verification time; stale responses never advance this. */
  verifiedAt?: string;
}
