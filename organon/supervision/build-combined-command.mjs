import { buildObservedCommand } from '../build-observed-command.mjs';

// Used only for the reviewed fixed starter command, not arbitrary shell input.
export function buildCombinedCommand(command, metadata, quote) {
  const seam = ' node scripts/run-with-http-diagnostics.mjs ';
  const parts = command.split(seam);
  if (parts.length !== 2 || !parts[0].startsWith('env ') || !parts[1]) throw Error('ORIGINAL_WRAPPER_SEAM_REQUIRED');
  if (!/^jb-[a-f0-9]{64}$/.test(metadata.controlRunId)) throw Error('FULL_BATCH_HASH_REQUIRED');
  const captureCommand = parts[0] + ' ' + quote(metadata.nodePath) + ' ' + quote(metadata.supervisorPath)
    + ' start ' + quote(metadata.controlDirectory) + ' ' + quote(metadata.controlRunId)
    + ' -- ' + quote(metadata.nodePath) + ' ' + quote(metadata.wrapperPath) + ' ' + parts[1];
  return { captureCommand, observedCommand: buildObservedCommand(captureCommand, {
    samplerPath: metadata.samplerPath, expectedArg: metadata.supervisorPath,
    outputDir: metadata.outputDir, label: metadata.label
  }, quote), originalEnvironmentPrefix: parts[0], originalWrapperArgumentSuffix: parts[1] };
}
