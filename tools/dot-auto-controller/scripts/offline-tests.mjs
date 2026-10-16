/** Repeatable package-only suite; no application CI or deployment changes. */
import {spawnSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),guard=path.join(root,'test/no-network.cjs');
const tests=['test','transport','reader-identity/test'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>dir+'/'+n));
const commands=[['--test','--test-concurrency=1',...tests],['--import','tsx','test/native-domain.mts'],['--import','tsx','test/sanitized-native.mts'],['--import','tsx','test/external-registration.mts'],['--import','tsx','test/schema50-profile.mts'],['reader-identity/integration/verify-client-contract.mjs',root],['run-takeda.mjs','--check']];
for(const args of commands){const r=spawnSync(process.execPath,['--max-old-space-size=384','--require',guard,...args],{cwd:root,env:{...process.env,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',REVIEW_RUNTIME_ROOT:path.join(root,'vendor/c60-source')},stdio:'inherit'});if(r.status!==0||r.signal)process.exit(r.status??1);}
console.log(JSON.stringify({status:'OFFLINE_PACKAGE_SUITE_PASS',network:false,database:false,liveQualification:false}));
