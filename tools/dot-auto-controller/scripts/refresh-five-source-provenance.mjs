/** Revalidate complete current/base source views before writing approved host records. No runtime action. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {FIVE_BASE_COMMIT,FIVE_SOURCE_PATHS,refreshFiveSourceManifest} from './five-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),file=root+'/vendor/C60_SOURCE_MANIFEST.json';
const baseManifest=JSON.parse(execFileSync('git',['show',FIVE_BASE_COMMIT+':tools/dot-auto-controller/vendor/C60_SOURCE_MANIFEST.json'],{cwd:root,maxBuffer:8*1024*1024}));
const manifest=refreshFiveSourceManifest({baseManifest,currentManifest:JSON.parse(fs.readFileSync(file)),readSource:relative=>fs.readFileSync(root+'/vendor/c60-source/'+relative)});
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({kind:'FIVE_SOURCE_SOURCE_ONLY_PROVENANCE',baseCommit:FIVE_BASE_COMMIT,changedRecords:FIVE_SOURCE_PATHS,productionQualified:false}));
