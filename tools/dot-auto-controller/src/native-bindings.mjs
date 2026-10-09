/** Read-only loader of the original modules. No copied/reimplemented SQL,
 * serializer, certification policy, source adapter, reader or lifecycle logic.
 */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {sha} from './journal.mjs';
export function verifyPins(route) {
  for(const p of route.pins){const stat=fs.lstatSync(p.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==p.bytes||sha(fs.readFileSync(p.path))!==p.sha256)throw Error('NATIVE_DEPENDENCY_PIN_CHANGED:'+p.path);}
  return {checked:route.pins.length};
}
export async function loadPinnedNative(route) {
  verifyPins(route);
  if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==route.sourceId)throw Error('NATIVE_SOURCE_PROCESS_IDENTITY');
  if(fs.realpathSync(process.execPath)!==fs.realpathSync(route.node))throw Error('PINNED_NODE_REQUIRED');
  const module=relative=>import(pathToFileURL(route.producer+'/'+relative).href);
  const [repository,atomic,archive,relay,control]=await Promise.all([
    module('src/db/ingestionRepository.ts'),module('src/crawler/runtimeAtomicEvidence.ts'),
    module('src/crawler/artifactArchive.ts'),module('src/crawler/cloudSourcePilotRelay.ts'),module('src/db/cloudPilotSqlControl.ts')]);
  return Object.freeze({
    // Caller supplies actual in-process native objects, never deserialized
    // self-issued attestation flags. WeakMap/native guards remain unchanged.
    compilePublication:repository.compileDbStartedCloudSourcePublication,
    inspectPersistedOutcome:repository.inspectPersistedAtomicCommitOutcome,
    verifyCommit:atomic.verifyAtomicRuntimeCommitForPersistence,
    restoreArchive:relay.restoreArchiveBundle,
    verifyArchive:archive.verifyArchivedSourceEvidence,
    compilePublicationContext:control.compileCloudPilotPublicationContextSql
  });
}
