// Offline verification entrypoint for this unregistered next-host template.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
execFileSync('/bin/bash',[resolve(import.meta.dirname,'../../../host-gate-tests/run-offline.sh')],{stdio:'inherit'});
