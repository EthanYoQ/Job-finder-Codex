/** Durable local orchestration journal. NOT the database publication mutex.
 * No cleanup, timestamp lease, PID stealing, state replacement or automatic retry.
 * A failed fsync may leave a claim visible; that claim still prohibits dispatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(v) { if (v instanceof Date) return v.toISOString(); if (Array.isArray(v)) return v.map(sort); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])); return v; }
const safe = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,200}$/.test(value) || ['.','..'].includes(value)) throw Error('JOURNAL_KEY'); return value; };
const syncDir = dir => { const fd=fs.openSync(dir,'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);} };
function mkdir(dir) { if (!fs.existsSync(dir)) { mkdir(path.dirname(dir)); try {fs.mkdirSync(dir,{mode:0o700});syncDir(path.dirname(dir));}catch(e){if(e.code!=='EEXIST')throw e;} } if(!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())throw Error('JOURNAL_DIRECTORY'); }
export class Journal {
  constructor(root, {fault = ()=>{}}={}) {this.root=path.resolve(root);this.fault=fault;mkdir(this.root);}
  file(run,key) {return path.join(this.root,'runs',safe(run),`${safe(key)}.json`);}
  put(run,key,value) {this.insert(this.file(run,key),{schemaVersion:1,runId:run,key,value,valueSha256:sha(canonical(value))});return value;}
  insert(file, value) {
    mkdir(path.dirname(file));const bytes=Buffer.from(canonical(value)),tmp=file+'.'+randomUUID()+'.tmp';let fd;
    try {fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);this.fault('before_file_fsync');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
      fs.linkSync(tmp,file);this.fault('after_link');syncDir(path.dirname(file));this.fault('after_directory_fsync');
      if(!fs.readFileSync(file).equals(bytes))throw Error('JOURNAL_READBACK');
      fs.unlinkSync(tmp);syncDir(path.dirname(file));return value;
    }finally{if(fd!==undefined)fs.closeSync(fd);/* Never remove a potentially published uncertain record. */}
  }
  get(run,key) {const file=this.file(run,key);try {if(fs.lstatSync(file).isSymbolicLink())throw Error('JOURNAL_SYMLINK');const obj=JSON.parse(fs.readFileSync(file));if(obj.schemaVersion!==1||obj.runId!==run||obj.key!==key||obj.valueSha256!==sha(canonical(obj.value)))throw Error('JOURNAL_INTEGRITY');return obj.value;}catch(e){if(e.code==='ENOENT')return undefined;throw e;}}
  claimSource(sourceId,runId) {
    safe(runId);const directory=path.join(this.root,'source-claims',sha(sourceId));mkdir(directory);
    const claims=fs.readdirSync(directory).filter(f=>/^\d{9}\.json$/.test(f)).sort();
    let ordinal=0;
    if(claims.length){const file=path.join(directory,claims.at(-1));if(fs.lstatSync(file).isSymbolicLink())throw Error('SOURCE_CLAIM_SYMLINK');const previous=JSON.parse(fs.readFileSync(file));
      if(previous.sourceId!==sourceId)throw Error('SOURCE_CLAIM_IDENTITY');
      const closure=this.get(previous.runId,'90-closure');
      if(!closure || closure.sourceId!==sourceId || closure.sourceClaimSha256!==sha(canonical(previous)) || closure.releaseEligible!==true)throw Error('SOURCE_HELD_RECONCILE_ORIGINAL');
      ordinal=Number(claims.at(-1).slice(0,9))+1;
    }
    const claim={schemaVersion:1,sourceId,runId,ordinal};
    try {this.insert(path.join(directory,String(ordinal).padStart(9,'0')+'.json'),claim);}catch(e){if(e.code==='EEXIST')throw Error('SOURCE_CONCURRENT_CLAIM');throw e;}
    this.put(runId,'01-source-claim',claim);return claim;
  }
  recordClosure(run,sourceId,details) {
    const claim=this.get(run,'01-source-claim');if(!claim || claim.sourceId!==sourceId)throw Error('SOURCE_CLAIM_REQUIRED');
    return this.put(run,'90-closure',{...details,sourceId,sourceClaimSha256:sha(canonical(claim))});
  }
}
