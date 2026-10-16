/** Local-only refresh from actual 962979 Git objects. No dependency or qualification changes. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {SHARED_COMPLETENESS_GUARD_BASE_COMMIT,SHARED_COMPLETENESS_GUARD_BASE_HASHES,SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,refreshSharedCompletenessGuardSourceManifest} from './shared-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',SHARED_COMPLETENESS_GUARD_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of SHARED_COMPLETENESS_GUARD_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative),record=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==SHARED_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.sha256!==SHARED_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.bytes!==bytes.length)throw Error('SHARED_COMPLETENESS_GUARD_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshSharedCompletenessGuardSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'SHARED_COMPLETENESS_GUARD_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:SHARED_COMPLETENESS_GUARD_BASE_COMMIT,changedRecords:SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,unaffectedRecordsPreserved:baseManifest.files.length-SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.length,productionQualified:false}));
