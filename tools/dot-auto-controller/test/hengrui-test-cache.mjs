/** Test-only cache directory. Never store generated output in the source package. */
import {tmpdir} from 'node:os';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const SOURCE_ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
export function requireExternalHengruiTestCache(candidate,sourceRoot=SOURCE_ROOT){
 const root=resolve(sourceRoot),target=resolve(candidate),inside=relative(root,target);
 if(!inside||inside!=='..'&&!inside.startsWith('..'+sep))throw Error('HENGRUI_TEST_CACHE_MUST_BE_OUTSIDE_SOURCE');
 return target;
}
export function hengruiTestCacheDir(suite){
 if(!['native','connector'].includes(suite))throw Error('HENGRUI_TEST_CACHE_SUITE');
 return requireExternalHengruiTestCache(resolve(tmpdir(),'jobfinder-hengrui-'+suite+'-cache-'+process.pid));
}
