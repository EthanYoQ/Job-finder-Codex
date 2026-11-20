import {randomUUID} from 'node:crypto';

// A silent background crawl must not depend on CPU load to avoid idle suspension.
export async function startActivityLease(machine, apiKey, {
  request=fetch, every=setInterval, cancel=clearInterval, report=console.error
}={}) {
  const url=`https://api.instabox.sh/v1/machines/${machine}/activity-leases/jobfinder-${randomUUID()}`;
  let lastSuccessfulPutAt=null;
  async function send(method) {
    const signal=AbortSignal.timeout(30_000);
    let httpStatus;
    try {
      const response=await request(url,{method,headers:{'X-API-Key':apiKey,'Content-Type':'application/json'},
        ...(method==='PUT'?{body:JSON.stringify({ttlSeconds:300})}:{}),signal});
      if(!response.ok){httpStatus=response.status;throw Error(`ACTIVITY_LEASE_${method}_FAILED`);}
      await response.arrayBuffer();
      if(method==='PUT')lastSuccessfulPutAt=new Date().toISOString();
    } catch(error) {
      const category=httpStatus!==undefined?'HTTP':signal.aborted||error?.name==='TimeoutError'?'TIMEOUT':'NETWORK';
      throw Object.assign(Error(`ACTIVITY_LEASE_${method}_FAILED`),{diagnostics:{
        category,...(httpStatus===undefined?{}:{httpStatus}),lastSuccessfulPutAt
      }});
    }
  }
  await send('PUT');
  let pending=Promise.resolve();
  const timer=every(()=>{
    pending=pending.then(()=>send('PUT')).catch(error=>report(JSON.stringify({status:'ACTIVITY_LEASE_RENEWAL_FAILED',...error.diagnostics})));
  },120_000);
  return async()=>{
    cancel(timer);
    await pending;
    try {await send('DELETE');}
    catch(error) {report(JSON.stringify({status:'ACTIVITY_LEASE_RELEASE_FAILED',expiresWithinSeconds:300,...error.diagnostics}));}
  };
}
