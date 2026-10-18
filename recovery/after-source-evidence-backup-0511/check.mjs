import assert from 'node:assert/strict';
import fs from 'node:fs';
const X=new URL('./',import.meta.url), A=Object.getPrototypeOf(async function(){}).constructor;
const code=fs.readFileSync(new URL('after/evidence-backup-functions.js',X),'utf8');
for(const failure of [false,true]){
 let uploads=0,fetches=0,commands=[],saved={};
 const tools={mcp__codex_apps__google_drive_upload_file:async args=>{uploads++;assert.equal(args.parent_folder_id,'11IB7F0xjEWueTzBLRfWv2oZGEoTW7u0J');assert.equal(args.file_uri,'/run/backup/success-evidence.tar.gz');if(failure)throw Error('transport unavailable');return {structuredContent:{id:'file-id'}};},mcp__codex_apps__google_drive_fetch:async()=>{fetches++;return{structuredContent:{file_uri:{download_url:'https://example.invalid/download'}}};}};
 const {backupSuccessfulSource}=await new A('tools',code)(tools);
 const result={status:'WEB_VERIFIED'};
 result.evidenceBackup=await backupSuccessfulSource({command:async c=>{commands.push(c);return c.includes(' --verify ')?JSON.stringify({sha256:'hash',verifiedMembers:3}):c.includes(' --run ')?JSON.stringify({sha256:'hash',members:3,bytes:17}):'';},save:async(p,v)=>saved[p]=v,q:s=>JSON.stringify(s),D:'/D',run:'/run',relay:'/relay'});
 assert.equal(result.status,'WEB_VERIFIED');assert.equal(uploads,1);
 assert.equal(fetches,failure?0:1);
 assert.equal(result.evidenceBackup.status,failure?'PENDING':'REMOTE_RESTORE_VERIFIED');
 if(failure)assert.equal(saved['/run/EVIDENCE_BACKUP_PENDING.json'].automaticRetry,false);
}
const entry=fs.readFileSync(new URL('after/run-original-functions.js',X),'utf8');new A(entry);
assert(entry.includes("if(result.status==='WEB_VERIFIED')"));
assert(entry.includes("if(sourceId!=='source-novo-nordisk-china-social')return undefined;"));
console.log('PASS: successful remote readback, upload failure pending without changing WEB_VERIFIED or retrying, entry syntax and Novo hook retained');
