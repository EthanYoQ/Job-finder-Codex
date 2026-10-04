/** Status and opaque identity for the exact verified display in this response.
 * CURRENT means current at its version check, never a promise about later commits.
 */
export interface PublicSnapshotRefresh {
  state: "CURRENT" | "UPDATING" | "FAILED";
  version: string;
  /** Opaque server check returned only for this bounded follow-up round. */
  check?: string;
}
