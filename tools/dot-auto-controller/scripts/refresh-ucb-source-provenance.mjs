/** Local-only refresh. Never rewrites unrelated source provenance or dependency pins. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {UCB_BASE_COMMIT,UCB_BASE_HASHES,UCB_SHARED_SOURCE_PATHS,UCB_NEW_SOURCE_PATH,refreshUcbSourceManifest} from './ucb-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',UCB_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of UCB_SHARED_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative);
 const recorded=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==UCB_BASE_HASHES[relative]||recorded?.bytes!==bytes.length)throw Error('UCB_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshUcbSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'UCB_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:UCB_BASE_COMMIT,changedRecords:[...UCB_SHARED_SOURCE_PATHS,UCB_NEW_SOURCE_PATH],unaffectedRecordsPreserved:baseManifest.files.length-UCB_SHARED_SOURCE_PATHS.length,productionQualified:false}));
