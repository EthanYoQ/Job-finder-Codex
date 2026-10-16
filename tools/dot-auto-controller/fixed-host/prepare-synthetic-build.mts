/** Offline preparation only, excluded from runtime authority. No registered ID. */
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../vendor/c60-source');
// Synthetic unregistered provenance marker, explicitly not a real Git commit.
const build=createBuildIdentity(root,'1111111111111111111111111111111111111111');
writeFileSync(root+'/build-identity.json',JSON.stringify(build,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(build));
