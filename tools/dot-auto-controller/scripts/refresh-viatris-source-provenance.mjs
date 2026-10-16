/** Local source-only refresh; no registration, build, dependency or production action. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {VIATRIS_BASE_COMMIT,VIATRIS_BASE_HASHES,VIATRIS_SHARED_SOURCE_PATHS,VIATRIS_NEW_SOURCE_PATH,refreshViatrisSourceManifest} from './viatris-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',VIATRIS_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of VIATRIS_SHARED_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative),recorded=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==VIATRIS_BASE_HASHES[relative]||recorded?.bytes!==bytes.length)throw Error('VIATRIS_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshViatrisSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'VIATRIS_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:VIATRIS_BASE_COMMIT,changedRecords:[...VIATRIS_SHARED_SOURCE_PATHS,VIATRIS_NEW_SOURCE_PATH],unaffectedRecordsPreserved:baseManifest.files.length-VIATRIS_SHARED_SOURCE_PATHS.length,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false}));
