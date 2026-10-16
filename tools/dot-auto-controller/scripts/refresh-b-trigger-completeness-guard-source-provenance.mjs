/** Local-only refresh from actual f7c011 Git objects. No dependency or qualification changes. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES,B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,refreshBTriggerCompletenessGuardSourceManifest} from './b-trigger-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative),record=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.sha256!==B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.bytes!==bytes.length)throw Error('B_TRIGGER_COMPLETENESS_GUARD_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshBTriggerCompletenessGuardSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'B_TRIGGER_COMPLETENESS_GUARD_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,changedRecords:B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,unaffectedRecordsPreserved:baseManifest.files.length-B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.length,productionQualified:false}));
