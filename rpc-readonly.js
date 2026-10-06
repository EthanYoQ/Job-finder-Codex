
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hashes=['1aef4f1','13c39a6','4b64b20','26d4235','9ca7f1b','b7ca7cb','afffcd4','0a1f60c'];
const names=new Set(hashes.map(h=>'jobfinder-portable-'+h));
let sock=null,done=false,timer;
function finish(x){if(done)return;done=true;clearTimeout(timer);try{if(sock)sock.close()}catch(e){}process.stdout.write(JSON.stringify(x)+'\n');setTimeout(()=>process.exit(0),10)}
const roots=['/opt/node22/lib/node_modules/pm2','/usr/local/lib/node_modules/pm2','/usr/lib/node_modules/pm2'];
for(const bin of ['/opt/node22/bin/pm2','/usr/local/bin/pm2','/usr/bin/pm2']){try{const p=fs.realpathSync(bin);if(p.endsWith('/pm2/bin/pm2'))roots.push(path.dirname(path.dirname(p)))}catch(e){}}
let axon,rpc,used;
for(const r of [...new Set(roots)]){for(const sub of ['modules','node_modules']){try{const a=path.join(r,sub,'pm2-axon'),b=path.join(r,sub,'pm2-axon-rpc');if(fs.existsSync(a)&&fs.existsSync(b)){axon=require(a);rpc=require(b);used=r;break}}catch(e){}}if(axon&&rpc)break}
if(!axon||!rpc){finish({state:'unavailable',reason:'existing RPC transport modules not found'});}else{
 timer=setTimeout(()=>finish({state:'unavailable',reason:'RPC timeout'}),5000);
 try{
  sock=axon.socket('req');const client=new rpc.Client(sock);
  sock.once('error',e=>finish({state:'unavailable',reason:'socket error',code:/^[A-Z0-9_]+$/.test(e.code||'')?e.code:null}));
  sock.once('reconnect attempt',()=>finish({state:'unavailable',reason:'socket unavailable; reconnect stopped'}));
  sock.once('connect',()=>client.call('getMonitorData',{},(err,list)=>{
   if(err||!Array.isArray(list)){finish({state:'unavailable',reason:'RPC returned error'});return;}
   const out=list.filter(p=>names.has((p.pm2_env||{}).name||p.name)).map(p=>{const e=p.pm2_env||{},args=JSON.stringify(e.args||[]),known=['scripts/p0-portable-worker.ts','scripts/p0-scheduler.ts','scripts/p0-portable-scheduler.ts','src/crawler/worker.ts','src/server/httpServer.ts'];return {name:e.name||p.name,pid:typeof p.pid==='number'?p.pid:null,status:['online','stopped','stopping','launching','errored','waiting restart','one-launch-status'].includes(e.status)?e.status:'[withheld]',uptimeMs:e.status==='online'&&typeof e.pm_uptime==='number'?Math.max(0,Date.now()-e.pm_uptime):0,knownCwdMatch:hashes.some(h=>e.pm_cwd==='/opt/jobfinder-candidates/'+h),knownNodePathMatch:e.pm_exec_path==='/opt/node22/bin/node',knownScriptMatches:known.filter(k=>args.includes(k)),argsSha256:crypto.createHash('sha256').update(args).digest('hex')}});
   finish({state:'success',method:'getMonitorData',transportRoot:used,entries:out,missingNames:[...names].filter(n=>!out.some(p=>p.name===n))});
  }));
  sock.connect('/root/.pm2/rpc.sock');
 }catch(e){finish({state:'unavailable',reason:'RPC transport exception'})}
}
