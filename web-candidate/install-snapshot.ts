import { installSavedSnapshot } from "./src/server/savedPublicSnapshot";

const [candidate, destination, sha256] = process.argv.slice(2);
if (!candidate || !destination || !sha256 || process.argv.length !== 5) {
  throw new Error("Usage: tsx install-snapshot.ts CANDIDATE DESTINATION TRUSTED_SHA256");
}
console.info(await installSavedSnapshot(candidate, destination, sha256));
