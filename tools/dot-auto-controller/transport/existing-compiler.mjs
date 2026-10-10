/**
 * Trusted deployment factory. runtimeRoot is the checked-out producer root,
 * not a request argument. No workspace path, user evidence or secret is pinned.
 * Keep this factory isolated per source process: the original source authority
 * is captured when the original TypeScript modules are first imported.
 */
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyRuntimeBeforeImport } from './runtime-integrity.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {assertReaderCandidate,compileReviewedReaderSql,HISTORICAL_READER_CANDIDATE} from './reader-template.mjs';

// Original historical identity only; it does not identify the sanitized capsule.
export const HISTORICAL_C60_BUILD = Object.freeze({
  schemaVersion: 2, commitSha: '3a2400768e8b087b8600dd05e1a32ac006bd7102',
  sourceTreeSha256: 'b2292d55d4587ea4b6bfdb1bd13542f845dc47235f00785c794441f7002a7676',
  runtimeTreeSha256: 'b3b4adf7264a2445474fd6cb6d73ee695a7759e493d22b09971d739941be4ec5',
  contentSha256: '40afe22f68d8b8feaa327eb7ffc181e709a17b4d0372ccd9b3ffc7ab3e8db064'
});
export const REVIEWED_C60_LOCK_SHA = '3f45f2db3f910be83bb57630db121a175b0375fe216a2fa110cab99ec149fae9';
let registeredRuntime;
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => a && b && Object.keys(a).sort().join(',') === Object.keys(b).sort().join(',') && Object.entries(a).every(([k,v])=>v===b[k]);

export async function createExistingCompiler({ runtimeRoot, expectedBuild,
  expectedLockSha256 = REVIEWED_C60_LOCK_SHA, expectedSourceId, expectedSourceConfigSha256,
  expectedReaderCandidateId = HISTORICAL_READER_CANDIDATE }) {
  if(!expectedBuild||expectedBuild.schemaVersion!==2)throw Error('EXPLICIT_REVIEWED_BUILD_REQUIRED');
  assertReaderCandidate(expectedReaderCandidateId);
  if (typeof runtimeRoot !== 'string' || !/^source-[a-z0-9-]+$/.test(expectedSourceId ?? '') ||
      !/^[a-f0-9]{64}$/.test(expectedSourceConfigSha256 ?? '') || !/^[a-f0-9]{64}$/.test(expectedLockSha256 ?? '') ||
      process.env.JOBFINDER_CLOUD_SOURCE_ID !== expectedSourceId) throw Error('COMPILER_DEPLOYMENT_CONFIG');
  const root = await realpath(runtimeRoot), pinnedBuild = structuredClone(expectedBuild);
  // No byte from runtimeRoot executes before the independently implemented
  // Node + full source/runtime/dependency tree check in this trusted package.
  verifyRuntimeBeforeImport(root,pinnedBuild,expectedLockSha256);
  const registrationKey=root+'\0'+expectedSourceId+'\0'+pinnedBuild.contentSha256;
  if(registeredRuntime && registeredRuntime!==registrationKey)throw Error('COMPILER_ONE_SOURCE_PROCESS_REQUIRED');
  if(!registeredRuntime){
    const {register}=await import(pathToFileURL(join(root,'node_modules/tsx/dist/esm/api/index.mjs')).href);
    // Default loader and canonical URLs are intentional: acquisition admission
    // WeakMaps must be shared with the same process's original producer modules.
    register({tsconfig:join(root,'tsconfig.json')});registeredRuntime=registrationKey;
  }
  const fromRoot = name => import(pathToFileURL(join(root,name)).href);
  const { verifyNodeRuntimeProfile } = await fromRoot('scripts/verify-node-runtime-profile.ts');
  const { createBuildIdentity } = await fromRoot('src/readiness/buildIdentity.ts');
  const { compileDbStartedCloudSourcePublication } = await fromRoot('src/db/ingestionRepository.ts');
  const { compileCloudPilotPublicationContextSql, CLOUD_PILOT_SOURCE } = await fromRoot('src/db/cloudPilotSqlControl.ts');
  async function verifyRuntime(control) {
    await verifyNodeRuntimeProfile();
    if (hash(await readFile(join(root,'package-lock.json'))) !== expectedLockSha256) throw Error('COMPILER_DEPENDENCY_LOCK_DRIFT');
    const build = verifyRuntimeBeforeImport(root,pinnedBuild,expectedLockSha256);
    if(!same(build,createBuildIdentity(root,build.commitSha)))throw Error('COMPILER_BUILD_ALGORITHM_DRIFT');
    if (!same(build,pinnedBuild) || control && !same(build,control.build)) throw Error('COMPILER_RUNTIME_BUILD_DRIFT');
    if (process.env.JOBFINDER_CLOUD_SOURCE_ID !== expectedSourceId || CLOUD_PILOT_SOURCE.id !== expectedSourceId ||
        CLOUD_PILOT_SOURCE.sourceConfigSha256 !== expectedSourceConfigSha256) throw Error('COMPILER_SOURCE_MODULE_DRIFT');
    return build;
  }
  function scope(binding,control) {
    if (binding.projectId !== 'yiopvxysxrtrnvqxwgbx' || binding.sourceId !== expectedSourceId ||
        binding.sourceConfigSha256 !== expectedSourceConfigSha256 ||
        control && (control.projectId !== binding.projectId || control.candidate.id !== binding.candidateId)) throw Error('COMPILER_SCOPE_BINDING');
  }
  await verifyRuntime();
  return async function existingCompiler(kind,input,binding) {
    if (kind === 'PUBLISH') {
      if(!input||Object.keys(input).some(k=>!['source','control','publicationDeadline','jobProjectionDelta'].includes(k))) throw Error('COMPILER_PUBLICATION_BINDING');
      // Capture caller-owned top-level inputs before the first await. Keep the
      // original issued admission/result/validation identities; clone only plain
      // control and pending/identity data. Never re-read mutable caller.control
      // after compilation when binding the durable ledger's expected batch.
      const originalSource=input.source,originalControl=input.control;
      const data={control:structuredClone(originalControl),source:{...originalSource,
        pending:structuredClone(originalSource.pending),identity:structuredClone(originalSource.identity)},
        publicationDeadline:input.publicationDeadline,
        ...(input.jobProjectionDelta===undefined?{}:{jobProjectionDelta:input.jobProjectionDelta})};
      await verifyRuntime(data.control); scope(binding,data.control);
      if (
          data.source.pending.id !== binding.sourceResultId || data.source.batchId !== binding.batchId ||
          data.source.pending.sourceId !== binding.sourceId || data.source.pending.sourceConfigHash !== binding.sourceConfigSha256 ||
          data.control.planned.batch.id !== binding.batchId || data.control.planned.batch.releaseCandidateId !== binding.candidateId ||
          data.publicationDeadline !== binding.expiresAt) throw Error('COMPILER_PUBLICATION_BINDING');
      const packet=await compileDbStartedCloudSourcePublication(data);
      const terminal=packet.commit.sourceResult;
      if(terminal.id!==binding.sourceResultId||terminal.batchId!==binding.batchId||
          terminal.releaseCandidateId!==binding.candidateId||terminal.sourceId!==binding.sourceId||
          terminal.sourceConfigHash!==binding.sourceConfigSha256) throw Error('COMPILER_COMPILED_BINDING');
      return {sql:packet.sql,atomic:true,expiresAt:packet.expiresAt,
        packet:{holderId:packet.holderId,expiresAt:packet.expiresAt,commit:packet.commit,
          expectedBatch:structuredClone(data.control.planned.batch)}};
    }
    if (kind === 'READ_CONTEXT' || kind === 'READ_PUBLICATION_CONTEXT') {
      const data=input; await verifyRuntime(data.control); scope(binding,data.control);
      if (Object.keys(data).some(k=>!['control','sourceAdmissionPolicy'].includes(k))) throw Error('COMPILER_READ_INPUT');
      return {sql:compileCloudPilotPublicationContextSql(data.control,data.sourceAdmissionPolicy)};
    }
    if (kind === 'READ_READER_CONTEXT') {
      await verifyRuntime(); scope(binding);
      if (input !== null || binding.sourceId !== 'source-takeda-china-social' ||
          binding.sourceConfigSha256 !== '048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f' ||
          binding.candidateId !== expectedReaderCandidateId) throw Error('COMPILER_READER_SCOPE');
      const template=await readFile(new URL('./queries/takeda-c60-reader-before.sql',import.meta.url),'utf8');
      return {sql:compileReviewedReaderSql(template,expectedReaderCandidateId)};
    }
    if (kind === 'READ_OUTCOME') {
      await verifyRuntime(); scope(binding);
      if (input!==null) throw Error('COMPILER_OUTCOME_INPUT');
      return {sql:`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=$1) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=$2) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`,values:[binding.sourceResultId,binding.batchId]};
    }
    throw Error('COMPILER_KIND_NOT_ALLOWED');
  };
}
