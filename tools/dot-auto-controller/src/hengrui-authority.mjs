import fs from 'node:fs';import path from 'node:path';
import {canonical,sha} from './journal.mjs';
/** Existing authority is mandatory. Missing state NEVER bootstraps a new owner. */
export function requireAuthority(deployment,route,{reconcile=false}={}){
 if(deployment.activated!==true)throw Error('ACTIVATION_REQUIRED');
 const dir=deployment.authorityDirectory;if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('FIXED_AUTHORITY_REQUIRED');
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||fs.realpathSync(dir)!==dir)throw Error('PRIVATE_AUTHORITY_REQUIRED');
 for(const name of ['controller','controller/runs','controller/source-claims','transport','hengrui']){const p=path.join(dir,name);if(!fs.existsSync(p)||!fs.lstatSync(p).isDirectory()||fs.lstatSync(p).isSymbolicLink())throw Error('AUTHORITY_STRUCTURE_MISSING');}
 const bytes=fs.readFileSync(path.join(dir,'authority-identity.json'));if(sha(bytes)!==deployment.authorityIdentitySha256)throw Error('AUTHORITY_IDENTITY_CHANGED');
 const identity=JSON.parse(bytes);if(identity.schemaVersion!==1||identity.projectId!==route.projectId||identity.sourceId!==route.sourceId||identity.kind!=='DURABLE_AUTO_AUTHORITY_V1')throw Error('AUTHORITY_SCOPE');
 // Current database/ledger/reader proof is required separately by the fixed
 // bootstrap's control-plane client; no persisted boolean grants authority.
 return {directory:dir,identity};
}
