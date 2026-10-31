import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

// Private debugging only. Never supplied to a source adapter or publication replay.
export async function savePrivateDomFailure({observe,directory,filePrefix,context}) {
  let timer, observation;
  try {
    observation=await Promise.race([observe(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('PRIVATE_DOM_CAPTURE_TIMEOUT')),5000);
    })]);
  } catch {observation={captureUnavailable:true};}
  finally {clearTimeout(timer);}
  const bytes=JSON.stringify({capturedAt:new Date().toISOString(),...context,observation},null,2)+'\n';
  const file=`${filePrefix}-${randomUUID()}.json`;
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(join(directory,file),bytes,{flag:'wx',mode:0o600});
  return {file,sha256:createHash('sha256').update(bytes).digest('hex')};
}
