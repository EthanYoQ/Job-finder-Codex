// Original private Drive backup, sequentially after a verified successful source.
async function backupSuccessfulSource({command,save,q,D,run,relay,requestIds}) {
 const directory=run+'/backup',archive=directory+'/success-evidence.tar.gz';
 let stage='PACKAGE',fileId=null;
 try {
  const packed=JSON.parse(await command('mkdir -p '+q(directory)+' && python3 '+q(D+'/package-success-evidence.py')+' --run '+q(run)+' --relay '+q(relay)+' --output '+q(archive)+requestIds.map(id=>' --request-id '+q(id)).join('')));
  await save(directory+'/LOCAL_PACKAGE.json',packed);
  stage='UPLOAD';
  await save(directory+'/UPLOAD_STARTED.json',{startedAt:new Date().toISOString(),sha256:packed.sha256});
  const uploaded=await tools.mcp__codex_apps__google_drive_upload_file({file_uri:archive,file_name:run.split('/').at(-1)+'-success-evidence.tar.gz',mime_type:'application/gzip',parent_folder_id:'11IB7F0xjEWueTzBLRfWv2oZGEoTW7u0J'});
  if(uploaded.isError){
   const detail=(uploaded.content??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ').replace(/https?:\/\/[^\s"'<>]+/gi,'[URL]').replace(/(authorization|cookie|[a-z_-]*token|[a-z_-]*session[a-z_-]*|api[_-]?key|password)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1=[REDACTED]').replace(/Bearer\s+[^\s,;}]+/gi,'Bearer [REDACTED]');
   throw Error('DRIVE_UPLOAD_FAILED: '+(detail||'tool isError without text').slice(0,500));
  }
  fileId=uploaded.structuredContent?.id;
  if(typeof fileId!=='string'||!fileId)throw Error('DRIVE_UPLOAD_ID_UNCONFIRMED');
  await save(directory+'/UPLOADED.json',{fileId,sha256:packed.sha256});
  stage='READBACK';
  const fetched=await tools.mcp__codex_apps__google_drive_fetch({url:'https://drive.google.com/file/d/'+fileId+'/view',download_raw_file:true,include_base64:false});
  const downloadUrl=fetched.structuredContent?.file_uri?.download_url;
  if(fetched.isError||typeof downloadUrl!=='string')throw Error('DRIVE_READBACK_UNAVAILABLE');
  const downloaded=directory+'/remote-readback.tar.gz';
  const restored=JSON.parse(await command('python3 -c '+q("import shutil,urllib.request;\nwith urllib.request.urlopen("+JSON.stringify(downloadUrl)+") as response, open("+JSON.stringify(downloaded)+",'wb') as output: shutil.copyfileobj(response,output)")+' && '+'python3 '+q(D+'/package-success-evidence.py')+' --verify '+q(downloaded)));
  if(restored.sha256!==packed.sha256||restored.verifiedMembers!==packed.members)throw Error('DRIVE_READBACK_MISMATCH');
  const receipt={status:'REMOTE_RESTORE_VERIFIED',fileId,...packed,verifiedAt:new Date().toISOString()};
  await save(directory+'/REMOTE_BACKUP_READBACK.json',receipt);
  return receipt;
 } catch(error) {
  const pending={status:'PENDING',stage,fileId,reason:String(error).slice(0,300),automaticRetry:false};
  try {await save(run+'/EVIDENCE_BACKUP_PENDING.json',pending);}catch{}
  return pending;
 }
}
return {backupSuccessfulSource};
