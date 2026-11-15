import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PortablePublicSnapshot } from "../web-candidate/src/db/portablePublicSnapshotRepository";
import { validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";

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
