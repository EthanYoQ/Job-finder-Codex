/** Fixed builtin-only connection bootstrap used solely by the live supervisor. */
import {assertDeploymentBinding} from './biogen-deployment.mjs';
import fs from 'node:fs';import {pathToFileURL} from 'node:url';
import {sha} from './journal.mjs';import {requireAuthority} from './biogen-authority.mjs';
import {verifyRuntimeBeforeImport} from '../transport/runtime-integrity.mjs';
import {createPgConnectionFactory} from '../transport/pg-connection.mjs';
import {createControlPlane} from './control-plane.mjs';
export async function createCompletionControlPlane({route,deployment}){
 assertDeploymentBinding();requireAuthority(deployment,route);
 verifyRuntimeBeforeImport(route.producer,route.build,sha(fs.readFileSync(route.producer+'/package-lock.json')));
 const pg=await import(pathToFileURL(route.producer+'/node_modules/pg/lib/index.js').href);
 assertDeploymentBinding();
 const openConnection=createPgConnectionFactory({Client:pg.default.Client,config:deployment.pg,passwordProvider:async()=>{const s=process.env.JOBFINDER_PG_PASSWORD;if(!s)throw Error('SECURE_SECRET_NOT_PROVISIONED');return s;}});
 return createControlPlane({openConnection,assertScope:assertDeploymentBinding,onMutationAttempt:assertDeploymentBinding});
}
