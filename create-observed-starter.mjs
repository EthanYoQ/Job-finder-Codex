// Prepare a separate starter copy; never execute it or modify an active host.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildObservedCommand } from './build-observed-command.mjs';

export const SAMPLER_SHA256 = '18bc3c99319b3af0941b6499bf71b5bfcd7d5808003a6b2c8e8a1a20eae88a85';
export const SAMPLER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sample_process_tree.py');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const launch = 'const started=await tools.exec_command({cmd:command,workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});';
const finalFreshness = '{const observedBootstrapAge=Date.now()-new Date(row.checkedAt).getTime();if(!Number.isFinite(observedBootstrapAge)||observedBootstrapAge<0||observedBootstrapAge>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");}';

export function addMemoryObservation(original) {
  if (original.includes('buildObservedCommand') || original.includes('MEMORY_SAMPLER_HASH_MISMATCH')) throw Error('ALREADY_OBSERVED');
  if (original.split(launch).length !== 2) throw Error('UNSUPPORTED_LAUNCH_SEAM');
  const position = original.indexOf(launch);
  const before = original.slice(0, position);
  const reviewedParts = before.split(/await h\.save\(run\+["']\/reviewed-command\.txt["'],command\);/);
  const tail = reviewedParts[1]?.trim();
  const knownBrowserStores = /^store\('[^']+:refreshCurrentRun',run\);store\('[^']+:refreshCurrentBatch',batch\);store\('[^']+:cloudPilotPublishRequest',null\);store\('[^']+:cloudPilotPendingRequest',null\);$/;
  if (!before.includes('scripts/run-with-http-diagnostics.mjs') ||
      !before.includes('const command=') || !before.includes('FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH') ||
      reviewedParts.length !== 2 || (tail !== '' && !knownBrowserStores.test(tail))) throw Error('UNSUPPORTED_REVIEWED_COMMAND_SEAM');
  const inserted = [
    '// BEGIN EXTERNAL_MEMORY_OBSERVATION',
    buildObservedCommand.toString(),
    'const samplerPath=' + JSON.stringify(SAMPLER_PATH) + ';',
    'const samplerHashCheck=await tools.exec_command({cmd:"sha256sum -- "+h.q(samplerPath),yield_time_ms:1000,max_output_tokens:500});',
    'if(samplerHashCheck.exit_code!==0||samplerHashCheck.session_id||samplerHashCheck.output.trim()!==' + JSON.stringify(SAMPLER_SHA256 + '  ' + SAMPLER_PATH) + ')throw Error("MEMORY_SAMPLER_HASH_MISMATCH");',
    'const observedCommand=buildObservedCommand(command,{samplerPath,expectedArg:"scripts/run-with-http-diagnostics.mjs",outputDir:run+"/memory-observation",label:h.cfg.sourceId+"/"+batch},h.q);',
    'await h.save(run+"/reviewed-observer-command.txt",observedCommand);',
    finalFreshness,
    '// END EXTERNAL_MEMORY_OBSERVATION',
    ''
  ].join('\n');
  return before + inserted + original.slice(position).replace(launch, launch.replace('cmd:command,', 'cmd:observedCommand,'));
}

export function stripMemoryObservation(observed) {
  return observed.replace(/\/\/ BEGIN EXTERNAL_MEMORY_OBSERVATION\n[\s\S]*?\/\/ END EXTERNAL_MEMORY_OBSERVATION\n/, '').replace('cmd:observedCommand,workdir:h.cfg.repo', 'cmd:command,workdir:h.cfg.repo');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, expectedOriginalSha256, output] = process.argv.slice(2);
  if (!input || !output || !/^[a-f0-9]{64}$/.test(expectedOriginalSha256 || '')) throw Error('USAGE: node create-observed-starter.mjs INPUT EXPECTED_SHA256 NEW_OUTPUT');
  const inputPath = realpathSync(input), outputPath = resolve(output);
  if (inputPath === outputPath || !/^start-monitor-.*-observed\.js$/.test(basename(outputPath))) throw Error('SEPARATE_OBSERVED_COPY_REQUIRED');
  const bytes = readFileSync(inputPath);
  if (sha(bytes) !== expectedOriginalSha256) throw Error('ORIGINAL_STARTER_HASH_MISMATCH');
  if (sha(readFileSync(SAMPLER_PATH)) !== SAMPLER_SHA256) throw Error('MEMORY_SAMPLER_HASH_MISMATCH');
  const original = bytes.toString('utf8'), observed = addMemoryObservation(original);
  if (stripMemoryObservation(observed) !== original) throw Error('ORIGINAL_BYTES_NOT_PRESERVED');
  writeFileSync(outputPath, observed, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({status:'PREPARED_NOT_LAUNCHED',input:inputPath,inputSha256:sha(bytes),output:outputPath,outputSha256:sha(observed),samplerPath:SAMPLER_PATH,samplerSha256:SAMPLER_SHA256,originalRecoveredByteForByte:true}));
}
