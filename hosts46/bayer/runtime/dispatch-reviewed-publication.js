// Parent-only one-time dispatch. Never called by the loader, starter, or relay monitor.
const A=Object.getPrototypeOf(async function(){}).constructor,h=await new A(load('restored46:bayer:cloudPilotHostHelpers'))();
const request=load('restored46:bayer:cloudPilotPublishRequest'),dir=load('restored46:bayer:cloudPilotPublishDirectory'),run=load('restored46:bayer:refreshCurrentRun');
if(!request||request.kind!=='PUBLISH'||dir!==run+'/relay'||!run.startsWith(h.cfg.root+'/'))throw Error('PUBLICATION_REVIEW_SCOPE');
const review=JSON.parse((await h.readFile(run+'/publication-review.json')).text),packet=await h.readFile(dir+'/'+request.requestId+'.request.json.sql');
if(review.requestId!==request.requestId||review.requestSha256!==request.requestSha256||review.sqlSha256!==packet.hash||packet.text!==request.payload.sql||review.frozenCertificateVerification?.status!=='PASS')throw Error('PUBLICATION_REVIEW_BINDING');
if(Date.now()>=Date.parse(request.payload.dispatchBefore))throw Error('PUBLICATION_DISPATCH_EXPIRED');
const result=await h.sqlDispatch(request,dir,packet.text);store('restored46:bayer:publicationDispatchResult',result);notify({phase:'ONE_TIME_PUBLICATION_DISPATCH_RETURNED',status:result.status});
await new A(load('restored46:bayer:continuousPortableRelayCodeWithPoll'))();
