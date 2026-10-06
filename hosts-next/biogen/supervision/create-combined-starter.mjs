import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildCombinedCommand } from './build-combined-command.mjs';
import { buildObservedCommand } from '../build-observed-command.mjs';
const base=dirname(fileURLToPath(import.meta.url)),r2="/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z";
export const paths={base,r2,sampler:join(base,'sample_process_tree.py'),supervisor:join(base,'supervise-cancel.mjs'),inspector:join(base,'inspect-launch-identity.mjs'),wrapper:join(r2,'workspaces/producer-fb0-exact/scripts/run-with-http-diagnostics.mjs'),original:join(base,'../host/runtime/start-monitor-portable42.js')};
export const hashes={sampler:'3fa6daa1af1afee94d19801edfd8bcb538e1243476b5adb253e50de162a27bd6',supervisor:'489864d0691750583a7d99659aae80b43b63acc89659cf05a6138c37539175d4',wrapper:'f15522e6f209bfe99bfa258b5dffbce1f74d6af662c4c2ee682604e0798bbc88',original:'a5e73aaff7dfcdd82c88dad6b8e23afb8a18aca257e9c06ef269934956344b5d'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const launch='const started=await tools.exec_command({cmd:command,workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});';
export function addCombinedObservation(original) {
  if(sha(original)!==hashes.original || original.split(launch).length!==2)throw Error('FROZEN_TAKEDA_STARTER_REQUIRED');
  const inspectorHash=sha(readFileSync(paths.inspector));
  const expectedChecks=['sampler','supervisor','wrapper'].map(k=>hashes[k]+'  '+paths[k]).concat(inspectorHash+'  '+paths.inspector).join('\n');
  const inserted=[
    '// BEGIN COMBINED_MEMORY_CANCEL_PROPOSAL',
    buildObservedCommand.toString(),
    buildCombinedCommand.toString(),
    'const combinedPaths='+JSON.stringify(paths)+';',
    'const combinedHashes=await tools.exec_command({cmd:"sha256sum -- "+[combinedPaths.sampler,combinedPaths.supervisor,combinedPaths.wrapper,combinedPaths.inspector].map(h.q).join(" "),yield_time_ms:1000,max_output_tokens:1500});',
    'if(combinedHashes.exit_code!==0||combinedHashes.session_id||combinedHashes.output.trim()!=='+JSON.stringify(expectedChecks)+')throw Error("COMBINED_SOURCE_HASH_MISMATCH");',
    'const combinedIdentityCheck=await tools.exec_command({cmd:"node "+h.q(combinedPaths.inspector)+" "+h.q(batch),workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});',
    'if(combinedIdentityCheck.exit_code!==0||combinedIdentityCheck.session_id)throw Error("COMBINED_NORMALIZATION_CHECK");',
    'const combinedIdentity=JSON.parse(combinedIdentityCheck.output);',
    'if(combinedIdentity.cwd!==h.cfg.repo||combinedIdentity.cwdRealPath!==h.cfg.repo||combinedIdentity.wrapperPath!==combinedPaths.wrapper||combinedIdentity.wrapperRealPath!==combinedPaths.wrapper||combinedIdentity.nodePath!==combinedIdentity.nodeRealPath)throw Error("COMBINED_NORMALIZATION_MISMATCH");',
    'const combinedMetadata={nodePath:combinedIdentity.nodePath,supervisorPath:combinedPaths.supervisor,wrapperPath:combinedPaths.wrapper,samplerPath:combinedPaths.sampler,controlDirectory:run+"/cancel-control",controlRunId:combinedIdentity.controlRunId,outputDir:run+"/memory-observation",label:h.cfg.sourceId+"/"+batch+"/includes-supervisor"};',
    'const combined=buildCombinedCommand(command,combinedMetadata,h.q);',
    'await h.save(run+"/reviewed-combined-command.txt",combined.observedCommand);',
    'await h.save(run+"/reviewed-cancel-contract.json",{status:"PREPARED_REQUEST_NOT_SENT",originalBatch:batch,controlDirectory:combinedMetadata.controlDirectory,controlRunId:combinedMetadata.controlRunId,nodeNormalization:{original:"node",resolved:combinedIdentity.nodePath},wrapperNormalization:{original:"scripts/run-with-http-diagnostics.mjs",resolved:combinedPaths.wrapper},samplerExpectedArg:combinedPaths.supervisor,memoryScope:"Supervisor root, unchanged wrapper and observed descendants; sampler excluded",requestCommand:h.q(combinedIdentity.nodePath)+" "+h.q(combinedPaths.supervisor)+" request "+h.q(combinedMetadata.controlDirectory)+" "+h.q(combinedMetadata.controlRunId)});',
    '{const combinedBootstrapAge=Date.now()-new Date(row.checkedAt).getTime();if(!Number.isFinite(combinedBootstrapAge)||combinedBootstrapAge<0||combinedBootstrapAge>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");}',
    '// END COMBINED_MEMORY_CANCEL_PROPOSAL',
    ''
  ].join('\n');
  return original.replace(launch,inserted+launch.replace('cmd:command,','cmd:combined.observedCommand,'));
}
export function stripCombinedObservation(combined) {
  return combined.replace(/\/\/ BEGIN COMBINED_MEMORY_CANCEL_PROPOSAL\n[\s\S]*?\/\/ END COMBINED_MEMORY_CANCEL_PROPOSAL\n/,'').replace('cmd:combined.observedCommand,workdir:h.cfg.repo','cmd:command,workdir:h.cfg.repo');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  for(const key of ['sampler','supervisor','wrapper','original'])if(sha(readFileSync(paths[key]))!==hashes[key])throw Error('SOURCE_HASH_MISMATCH:'+key);
  const original=readFileSync(paths.original,'utf8'),combined=addCombinedObservation(original);
  if(stripCombinedObservation(combined)!==original)throw Error('ORIGINAL_NOT_PRESERVED');
  const output=join(base,'start-monitor-biogen47b-combined.js');
  writeFileSync(output,combined,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'PROPOSAL_NOT_LOADED_OR_LAUNCHED',originalSha256:sha(original),output,outputSha256:sha(combined),originalBytesPreserved:true}));
}
