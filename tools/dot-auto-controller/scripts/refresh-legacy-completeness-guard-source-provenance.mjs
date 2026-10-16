/** Local-only refresh from actual a889c0 Git objects. No dependency or qualification changes. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,LEGACY_COMPLETENESS_GUARD_BASE_HASHES,LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,refreshLegacyCompletenessGuardSourceManifest} from './legacy-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifestPath=path.join(root,'vendor/C60_SOURCE_MANIFEST.json');
const gitPath='tools/dot-auto-controller/vendor/';
const gitBytes=relative=>execFileSync('git',['show',LEGACY_COMPLETENESS_GUARD_BASE_COMMIT+':'+gitPath+relative],{cwd:root,maxBuffer:8*1024*1024});
const baseManifest=JSON.parse(gitBytes('C60_SOURCE_MANIFEST.json'));
for(const relative of LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS){
 const bytes=gitBytes('c60-source/'+relative),record=baseManifest.files.find(file=>file.path===relative);
 if(createHash('sha256').update(bytes).digest('hex')!==LEGACY_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.sha256!==LEGACY_COMPLETENESS_GUARD_BASE_HASHES[relative]||record?.bytes!==bytes.length)throw Error('LEGACY_COMPLETENESS_GUARD_GIT_BASE_BYTES_MISMATCH:'+relative);
}
const manifest=refreshLegacyCompletenessGuardSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(manifestPath)),readSource:relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative))});
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({status:'LEGACY_COMPLETENESS_GUARD_LOCAL_SOURCE_PROVENANCE_REFRESHED',baseCommit:LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,changedRecords:LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,unaffectedRecordsPreserved:baseManifest.files.length-LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.length,productionQualified:false}));
