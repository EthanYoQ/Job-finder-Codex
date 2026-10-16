/** Local-only refresh. Never rewrites unrelated source provenance or dependency pins. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {HENGRUI_BASE_COMMIT,HENGRUI_BASE_HASHES,HENGRUI_SHARED_SOURCE_PATHS,HENGRUI_NEW_SOURCE_PATH,refreshHengruiSourceManifest} from './hengrui-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',HENGRUI_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of HENGRUI_SHARED_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative);
 const recorded=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==HENGRUI_BASE_HASHES[relative]||recorded?.bytes!==bytes.length)throw Error('HENGRUI_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshHengruiSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'HENGRUI_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:HENGRUI_BASE_COMMIT,changedRecords:[...HENGRUI_SHARED_SOURCE_PATHS,HENGRUI_NEW_SOURCE_PATH],unaffectedRecordsPreserved:baseManifest.files.length-HENGRUI_SHARED_SOURCE_PATHS.length,productionQualified:false}));
