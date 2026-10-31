import {randomUUID} from 'node:crypto';

// A silent background crawl must not depend on CPU load to avoid idle suspension.
export async function startActivityLease(machine, apiKey, {
  request=fetch, every=setInterval, cancel=clearInterval, report=console.error
}={}) {
  const url=`https://api.instabox.sh/v1/machines/${machine}/activity-leases/jobfinder-${randomUUID()}`;
  async function send(method) {
    const response=await request(url,{method,headers:{'X-API-Key':apiKey,'Content-Type':'application/json'},
      ...(method==='PUT'?{body:JSON.stringify({ttlSeconds:300})}:{}),signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error(`ACTIVITY_LEASE_${method}_FAILED`);
    await response.arrayBuffer();
  }
  await send('PUT');
  let pending=Promise.resolve();
  const timer=every(()=>{
    pending=pending.then(()=>send('PUT')).catch(()=>report(JSON.stringify({status:'ACTIVITY_LEASE_RENEWAL_FAILED'})));
  },120_000);
  return async()=>{
    cancel(timer);
    await pending;
    try {await send('DELETE');}
    catch {report(JSON.stringify({status:'ACTIVITY_LEASE_RELEASE_FAILED',expiresWithinSeconds:300}));}
  };
}
