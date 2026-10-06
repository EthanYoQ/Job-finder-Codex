/** Status and opaque identity for the exact verified display in this response.
 * CURRENT means current at its version check, never a promise about later commits.
 */
export interface PublicSnapshotRefresh {
  state: "CURRENT" | "UPDATING" | "FAILED";
  version: string;
}
