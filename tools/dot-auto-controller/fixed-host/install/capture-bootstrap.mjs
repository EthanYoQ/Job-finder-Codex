// Test helper: captures the real functions bootstrap command without running it.
import fs from 'node:fs';import {canonical} from './facts.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const source=JSON.parse(fs.readFileSync(0,'utf8')).source;
const shaSource=read('../functions/sha256.js'),digest=new Function(shaSource+'\nreturn responseDigest;')();
const b={schemaVersion:1,repo:'EthanYoQ/Job-finder-Codex',projectId:'yiopvxysxrtrnvqxwgbx',commitSha:'a'.repeat(40),treeSha:'b'.repeat(40),holderSource:source,holderSha256:digest(source).sha256};b.bindingSha256=digest(canonical(b)).sha256;
const code=read('./install.functions.template.js').replace('__FIXED_INSTALL_BINDING__',JSON.stringify(b)).replace('__FIXED_SHA256_SOURCE__',JSON.stringify(shaSource)).replace('__FIXED_FACTS_SOURCE__',JSON.stringify(read('./facts.mjs').replace(/^export \{[^\n]+\};\n?$/m,'')));
const noop=async()=>{throw Error('UNEXPECTED_TOOL');};
const tools={exec_command:async args=>{process.stdout.write(JSON.stringify(args));throw Error('CAPTURED');},write_stdin:noop,mcp__codex_apps__github_fetch_commit:noop,mcp__codex_apps__github_fetch:noop,mcp__codex_apps__supabase_execute_sql:noop};
try{await new Function('tools',code)(tools).installFixedController();throw Error('NOT_CAPTURED');}catch(error){if(error.message!=='CAPTURED')throw error;}
