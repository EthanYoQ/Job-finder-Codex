// Test-only preload. No production source imports this file. No network or signals.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
if (process.argv[1]?.endsWith('/supervise-cancel.mjs') && process.argv[2] === 'start') {
  const fault = process.env.SYNTHETIC_SUPERVISOR_FAULT;
  const receipt = process.env.SYNTHETIC_SUPERVISOR_FAULT_RECEIPT;
  const original = Object.fromEntries(['openSync','readFileSync','writeSync','fsyncSync','closeSync','writeFileSync'].map(k=>[k,fs[k]]));
  const descriptors = new Map();
  let injections = 0, identityReads = 0, lastEvent;
  const inject = name => {
    injections++;
    original.writeFileSync(receipt,JSON.stringify({fault,injections,name,pid:process.pid})+'\n');
    throw Object.assign(new Error('SYNTHETIC_'+name),{code:'EIO'});
  };
  fs.openSync = function(path,...args) {
    const p=String(path);
    if ((fault==='descriptor-open' && p.endsWith('/descriptor.json')) || (fault==='terminal-open' && p.endsWith('/terminal.json'))) inject(fault);
    const fd=original.openSync.call(this,path,...args);descriptors.set(fd,p);return fd;
  };
  fs.readFileSync = function(path,...args) {
    if (/^\/proc\/[0-9]+\/stat$/.test(String(path))) {
      identityReads++;
      if ((fault==='spawn-identity' && identityReads===1) || (fault==='poll-identity' && identityReads>1)) inject(fault);
    }
    if(fault==='wrapper-events-read' && String(path).endsWith('/process.jsonl'))inject(fault);
    const result=original.readFileSync.call(this,path,...args);
    if (/^\/proc\/[0-9]+\/stat$/.test(String(path)) &&
        (fault==='spawn-identity-mismatch' && identityReads===1 || fault==='poll-reused-pid' && identityReads>1)) {
      original.writeFileSync(receipt,JSON.stringify({fault,injections:++injections})+'\n');
      const cut=result.lastIndexOf(')')+2,fields=result.slice(cut).trim().split(/\s+/);
      if(fault==='spawn-identity-mismatch')fields[1]='0';else fields[19]=String(Number(fields[19])+1);
      return result.slice(0,cut)+fields.join(' ')+'\n';
    }
    return result;
  };
  fs.writeSync = function(fd,data,...args) {
    const p=descriptors.get(fd) ?? '', text=Buffer.isBuffer(data)?data.toString():String(data);
    if(p.endsWith('/supervisor.jsonl')) {
      const event=/"event":"([^"]+)"/.exec(text)?.[1];lastEvent=event;
      if (fault==='log-ready-write' && event==='SUPERVISOR_READY' ||
          fault==='log-rejected-write' && event==='CANCEL_REJECTED' ||
          fault==='log-accepted-write' && event==='CANCEL_ACCEPTED' ||
          fault==='log-signal-write' && event==='SIGNAL_SENT' ||
          fault==='log-exit-write' && event==='WRAPPER_EXIT' ||
          fault==='all-logging')inject(fault);
      if(fault==='log-rejected-partial-write' && event==='CANCEL_REJECTED') {
        if(!injections) {
          original.writeFileSync(receipt,JSON.stringify({fault,injections:++injections})+'\n');
          return original.writeSync(fd,Buffer.from(data),0,9);
        }
        inject(fault);
      }
      if(fault==='log-zero-write'){original.writeFileSync(receipt,JSON.stringify({fault,injections:++injections})+'\n');return 0;}
    }
    if(fault==='all-logging' && fd===2)inject('stderr-write');
    if(p.endsWith('/descriptor.json')) {
      if(fault==='descriptor-write')inject(fault);
      if(fault==='descriptor-short-write' && !injections) {
        original.writeFileSync(receipt,JSON.stringify({fault,injections:++injections})+'\n');
        const buffer=Buffer.from(data);return original.writeSync(fd,buffer,0,5);
      }
    }
    return original.writeSync.call(this,fd,data,...args);
  };
  fs.fsyncSync = function(fd,...args) {
    const p=descriptors.get(fd)??'';
    if(fault==='descriptor-fsync' && p.endsWith('/descriptor.json') ||
       fault==='directory-fsync' && p.endsWith('/control') ||
       fault==='log-ready-fsync' && p.endsWith('/supervisor.jsonl') && lastEvent==='SUPERVISOR_READY' ||
       fault==='log-accepted-fsync' && p.endsWith('/supervisor.jsonl') && lastEvent==='CANCEL_ACCEPTED' ||
       fault==='log-exit-fsync' && p.endsWith('/supervisor.jsonl') && lastEvent==='WRAPPER_EXIT' ||
       fault==='terminal-fsync' && p.endsWith('/terminal.json'))inject(fault);
    return original.fsyncSync.call(this,fd,...args);
  };
  fs.closeSync = function(fd,...args) {
    const p=descriptors.get(fd)??'';
    if(fault==='lifecycle-close' && p.endsWith('/supervisor.jsonl') || fault==='directory-close' && p.endsWith('/control') || fault==='descriptor-close' && p.endsWith('/descriptor.json') || fault==='terminal-close' && p.endsWith('/terminal.json'))inject(fault);
    const result=original.closeSync.call(this,fd,...args);descriptors.delete(fd);return result;
  };
  syncBuiltinESMExports();
}
