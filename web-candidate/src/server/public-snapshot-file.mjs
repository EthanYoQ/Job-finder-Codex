import {open, readFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

function parseSnapshot(text) {
  const snapshot = JSON.parse(text);
  if (snapshot?.schemaVersion !== 'portable-public-snapshot-v1' ||
      typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt)) ||
      !Array.isArray(snapshot.companies) || !Array.isArray(snapshot.sources)) {
    throw Error('PUBLIC_SNAPSHOT_INVALID');
  }
  return snapshot;
}

/** Takes the existing reader's public projection, not database rows or raw evidence.
 * Never exposes a partially written file; never changes verification time.
 */
export async function savePublicSnapshot(file, snapshot) {
  const text = JSON.stringify(snapshot);
  parseSnapshot(text);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const output = await open(temporary, 'wx', 0o600);
    try { await output.writeFile(text); await output.sync(); }
    finally { await output.close(); }
    await rename(temporary, file);
    try {
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); }
      finally { await directory.close(); }
    } catch (cause) {
      // Rename has committed a complete new file; never claim that the old file survived.
      throw new Error('PUBLIC_SNAPSHOT_DURABILITY_UNCONFIRMED', {cause});
    }
  } finally {
    await rm(temporary, {force: true});
  }
}

/** The caller must label this as a saved snapshot, never live DB verification. */
export async function readPublicSnapshot(file) {
  return parseSnapshot(await readFile(file, 'utf8'));
}
