# Gilead C52 continuous publication owner

This directory contains the actual three functions.exec entry fragments adapted from the reviewed d5 owner. It is separate from the earlier host-only gates. It accepts only sourceKey='gileadNext' and namespace proxyNode22:gileadNext:. The physical source remains source-gilead-china-social at hosts/gilead/host.

The fixed identity is producer d6190919d17c8ba4ee721daa2087d3c09bded7fa and registered candidate dot-cloud-gilead-mainland-d6190919-20261007, version52. These values were checked against the owner's request-input.json and normalized official registration readback. The database identity supplied by the owner is a bounded profile-metadata identity, not a business-data snapshot. No database call or source acquisition was performed while adapting this owner.

## Three fragments

- publish-and-monitor-owner.js: AsyncFunction factory body, parameter env. It retains d5's one original PUBLISH dispatch, immediately awaited original monitor, original READ_OUTCOME handling, exact session/expiry bindings, UNKNOWN behavior and full original terminal persistence. It checks the preloaded actual binding and fixed full d619 build/C52 tuple; changing candidate ID/version/build/config/binding after preload is rejected.
- preload-owner.exec.js: AsyncFunction body, parameter sourceKey='gileadNext'. It checks the owner and manifest hashes plus the five current host dependencies, then reads the installed control/activation/config and checks their exact agreement with the real loader's stored binding. It freezes that complete actual binding in publishMonitorPrepared. Null/unregistered binding is rejected; it never registers or activates anything.
- publish-reviewed-and-monitor.exec.js: AsyncFunction body, parameters sourceKey='gileadNext' and ownerMode='publish' or 'resume'. It requires the pinned owner/host bytes and unchanged exact binding, obtains the already reviewed original request, and awaits the full owner lifetime in the same functions.exec cell.

baseline-manifest.json binds exactly five files: host-helper-functions.js, host-stage-functions.js, runtime/continuous-relay-v3-durable-monitor.js, relay-files.mjs and runtime/review-packet-envelope.mts. It uses the physical Gilead host path, not a path constructed from the mixed-case owner alias.

## Owner-only sequence

1. Review/install the actual C52 PREPARED package from registration/host-prepared-C52-0718Z and activate through the existing verified owner flow. The package itself is PREPARED_NOT_ACTIVATED.
2. Execute the actual host runtime/load-source-runtime.js with its existing sourceKey='gilead'. That loader stores the new runtime under proxyNode22:gileadNext:.
3. Before launch or request deadlines, execute preload-owner.exec.js with sourceKey='gileadNext'. It must report OWNER_CODE_AND_ACTUAL_BINDING_PINNED_NO_LAUNCH with the actual C52 tuple.
4. Follow the existing supervised startup and original PUBLISH review. Execute publish-reviewed-and-monitor.exec.js with sourceKey='gileadNext', ownerMode='publish' in one awaited cell.
5. A yielded/running cell is continued with functions.wait, never duplicated. Only a returned UNRESOLVED continuation.mode='resume' allows a monitor-only resume. No path retries PUBLISH.
6. A validated original zero exit still requires the existing exact committed-row/observation/lock readback and public projection verification. PROCESS_TERMINATED is not a claim that SQL publication has been reconciled.

No source-key regex was broadened. No C51 host or running owner was edited. No source launch, SQL submission or registration was performed by this adaptation.

## Tests

Use the included tests/owner.test.mjs with the verified Node22. The original22 d5 behavior cases remain, with additional source/binding and real loader→preload→entry integration cases. Every SQL/HTTP/process result is synthetic; actual code, local Python hash verification and real apply_patch LF persistence are exercised. Test results and exact tested hashes are recorded in the delivery manifest.
