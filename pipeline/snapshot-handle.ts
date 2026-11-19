import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import { createGunzip, createGzip } from "node:zlib";
import type { PortablePublicSnapshot } from "../web-candidate/src/db/portablePublicSnapshotRepository";
import { validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";

const rawSnapshotName = /^public-([a-f0-9]{64})\.json$/;
const gzipSnapshotName = /^public-([a-f0-9]{64})\.json\.gz$/;
const maxRetainedOtherRawSnapshots = 4;
const maxCompressedSnapshotAgeMs = 30 * 24 * 3600_000;

async function hashFile(file: string, compressed = false): Promise<string> {
  const sha = createHash("sha256");
  const sink = new Writable({ write(chunk, _encoding, done) { sha.update(chunk); done(); } });
  if (compressed) await pipeline(createReadStream(file), createGunzip(), sink);
  else await pipeline(createReadStream(file), sink);
  return sha.digest("hex");
}

/** Keep current + 4 newest raw snapshots; gzip older ones and prune archives >30d old. */
export async function archiveInactiveSnapshots(directory: string, currentSnapshotFile: string, now = Date.now()): Promise<void> {
  const snapshots = resolve(directory);
  const current = resolve(currentSnapshotFile);
  const entries = await readdir(snapshots, { withFileTypes: true });
  const raw: Array<{ path: string; expectedSha: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = rawSnapshotName.exec(entry.name);
    if (!match) continue;
    const path = join(snapshots, entry.name);
    if (path === current) continue;
    raw.push({ path, expectedSha: match[1]!, mtimeMs: (await stat(path)).mtimeMs });
  }
  raw.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  for (const item of raw.slice(maxRetainedOtherRawSnapshots)) {
    const actualSha = await hashFile(item.path).catch(() => undefined);
    if (actualSha !== item.expectedSha) continue;
    const cold = `${item.path}.gz`;
    const existingColdSha = await hashFile(cold, true).catch(() => undefined);
    if (existingColdSha !== item.expectedSha) {
      const temporary = `${item.path}.gz.tmp`;
      try {
        await pipeline(createReadStream(item.path), createGzip({ level: 6 }), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
        const synced = await open(temporary, "r+");
        try {
          await synced.sync();
        } finally {
          await synced.close();
        }
        const compressedSha = await hashFile(temporary, true);
        if (compressedSha !== item.expectedSha) throw Error(`Compressed snapshot SHA mismatch: ${item.path}`);
        await rm(cold, { force: true });
        await rename(temporary, cold);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    await rm(item.path, { force: true });
  }
  for (const entry of await readdir(snapshots, { withFileTypes: true })) {
    if (!entry.isFile() || !gzipSnapshotName.test(entry.name)) continue;
    const path = join(snapshots, entry.name);
    if (now - (await stat(path)).mtimeMs > maxCompressedSnapshotAgeMs) {
      await rm(path, { force: true });
    }
  }
}

export async function selectRoundSnapshotHandle(directory:string,slot:string|null,snapshot:PortablePublicSnapshot) {
  const snapshots=resolve(directory),bytes=Buffer.from(JSON.stringify(snapshot));
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const fresh={snapshotFile:join(snapshots,`public-${sha256}.json`),sha256,bytes:bytes.length,
    generatedAt:snapshot.generatedAt,lastUpdatedAt:snapshot.lastUpdatedAt,totalJobs:snapshot.totalJobs,snapshotReused:false};
  if(!slot||!/^\d{13}$/.test(slot))return fresh;
  try {
    const receipt=JSON.parse(await readFile(join(snapshots,"latest.json"),"utf8"));
    if(receipt.status!=="SNAPSHOT_SAVED"||receipt.slot!==slot||!/^[a-f0-9]{64}$/.test(receipt.sha256))return fresh;
    const previousFile=join(snapshots,`public-${receipt.sha256}.json`);
    if(receipt.snapshotFile!==previousFile)return fresh;
    const previousBytes=await readFile(previousFile);
    const previousHash=createHash("sha256").update(previousBytes).digest("hex");
    if(previousBytes.length!==receipt.bytes||previousHash!==receipt.sha256)return fresh;
    const previous=validateSavedSnapshot(JSON.parse(previousBytes.toString("utf8")));
    if(receipt.generatedAt!==previous.generatedAt||receipt.lastUpdatedAt!==previous.lastUpdatedAt||receipt.totalJobs!==previous.totalJobs)return fresh;
    const {generatedAt:_previousTime,...previousProjection}=previous;
    const {generatedAt:_currentTime,...currentProjection}=JSON.parse(bytes.toString("utf8"));
    if(!isDeepStrictEqual(currentProjection,previousProjection))return fresh;
    return {...fresh,snapshotFile:previousFile,sha256:previousHash,bytes:previousBytes.length,
      generatedAt:previous.generatedAt,snapshotReused:true};
  } catch {
    // An unreadable or unverified previous artifact cannot replace the fresh SQL projection.
    return fresh;
  }
}
