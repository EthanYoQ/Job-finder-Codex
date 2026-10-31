// Existing Functions/official connector, after a confirmed Novo producer terminal.
async function verifyNovoPublishedJobs({command,read,save,q,N,V,P,D,R,sql,official,rows}) {
 const sourceId='source-novo-nordisk-china-social',companyId='company-novo-nordisk-china';
 const S=R+'/novo-nordisk',directory=S+'/job-verification-'+new Date().toISOString().replace(/[-:.]/g,'');
 await command('mkdir -p '+q(directory));
 const cli=q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/p0-novo-job-verification.mts');
 const options=' --control '+q(S+'/control-base.json')+' --out '+q(directory);
 await command(cli+' prepare'+options);
 const inputReceipt=await official(await read(directory+'/read-input.sql'));
 await save(directory+'/INPUT_OFFICIAL_RECEIPT.json',inputReceipt);
 const input=rows(inputReceipt)[0]?.verification_input;if(!input)throw Error('NOVO_VERIFICATION_INPUT_MISSING');
 await save(directory+'/verification-input.json',input);
 await command('python3 '+q(D+'/readback-original-web.py')+' '+q(directory)+' '+q(companyId));
 const expiresAt=new Date(Date.now()+1800000).toISOString();
 await command(cli+' capture'+options+' --input '+q(directory+'/verification-input.json')+' --reader-root '+q(P+'/vendor/reader-main')+' --expires-at '+q(expiresAt));
 const result=JSON.parse(await read(directory+'/result.json'));
 if(result.outcome==='NO_CLOSED_EVIDENCE')return {...result,directory};
 if(result.outcome!=='CLOSURE_SQL_READY')throw Error('NOVO_CLOSURE_NOT_READY');
 if(Date.now()>=Date.parse(expiresAt))return {outcome:'NOT_DISPATCHED',reason:'NOVO_VERIFICATION_EXPIRED',directory};
 await save(directory+'/DISPATCH_STARTED.json',{startedAt:new Date().toISOString(),expiresAt});
 try {await save(directory+'/COMMIT_OFFICIAL_RECEIPT.json',await official(await read(directory+'/commit.sql')));}
 catch(error){await save(directory+'/COMMIT_TRANSPORT_ERROR.json',{outcome:'UNKNOWN',error:String(error)});}
 let outcome;
 try {
  const receipt=await official(await read(directory+'/readback.sql'));await save(directory+'/READBACK_OFFICIAL_RECEIPT.json',receipt);
  const data=rows(receipt)[0]?.verification;if(!data)throw Error('NOVO_VERIFICATION_READBACK_MISSING');
  await save(directory+'/readback.json',data);
  outcome=JSON.parse((await command(cli+' reconcile'+options+' --readback '+q(directory+'/readback.json')+' --expected '+q(directory+'/expected-captures.json'))).trim().split('\n').at(-1));
 } catch(error){outcome={outcome:'UNKNOWN',reason:String(error)};await save(directory+'/READBACK_ERROR.json',outcome);}
 if(outcome.outcome==='COMMITTED_EXACT'){
  try {
  const after=directory+'/post-commit';await command('mkdir -p '+q(after));
  const receipt=await official(await read(directory+'/read-input.sql'));await save(after+'/INPUT_OFFICIAL_RECEIPT.json',receipt);
  await save(after+'/verification-input.json',rows(receipt)[0].verification_input);
  await command(cli+' capture --control '+q(S+'/control-base.json')+' --out '+q(after)+' --input '+q(after+'/verification-input.json')+' --reader-root '+q(P+'/vendor/reader-main')+' --expires-at '+q(expiresAt)+' --plan-only');
  await command('mkdir -p '+q(directory+'/web-after'));
  await command('python3 '+q(D+'/readback-original-web.py')+' '+q(directory+'/web-after')+' '+q(companyId));
  outcome.web=JSON.parse(await command('python3 '+q(D+'/verify-novo-closure-web.py')+' '+q(directory)));
  }catch(error){outcome.web={status:'FAILED',reason:String(error)};await save(directory+'/WEB_READBACK_FAILED.json',outcome.web);}
 }
 return {...result,...outcome,directory};
}
return {verifyNovoPublishedJobs};
