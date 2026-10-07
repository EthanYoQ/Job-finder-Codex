// Local, non-executing parser for the frozen compiler's exact JSON declarations.
import { readFileSync,existsSync,realpathSync,lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyNodeRuntimeProfile } from '../../../../producer/scripts/verify-node-runtime-profile.ts';
import { resolve,dirname,basename,join,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAtomicJsonDeclarations } from '../../../..//producer/src/db/atomicJsonDeclarations.ts';
import { unwrapJobProjectionSourceRow } from '../../../..//producer/src/db/jobProjectionDeltaCompiler.ts';
import { parseJobProjectionDeltaReceipt, hashProjectionJson, canonicalProjectionJson } from '../../../..//producer/src/domain/jobProjectionDeltaReceipt.ts';
import { compileCloudPilotPublicationContextSql } from '../../../../producer/src/db/cloudPilotSqlControl.ts';
const FROZEN_CONTEXT_SCHEMA_SHA256='a869bf0bf8508eeb3361612fb3eadcfc1de167d4cff3aa762343e216598edce1';
const FROZEN_JSON_COMPILER_SHA256='346d5af4ee2ebecb88e81aede9886d315dc39732c35ff2ce1c4da28e3f2f5b2e';
const sha = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
export function decodeDeclarations(source:string,origin?:any) {
  let offset=0;const variables=new Map<string,unknown>();
  const requireText=(text:string)=>{if(!source.startsWith(text,offset))throw Error('HOST_JSON_DECLARATION_SYNTAX');offset+=text.length;};
  const literal=()=>{requireText("E'");let text='';while(offset<source.length){const c=source[offset++]!;if(c==='\\'){const n=source[offset++]!;if(n!=='\\')throw Error('HOST_JSON_ESCAPE');text+=n;}else if(c==="'"){if(source[offset]==="'"){offset++;text+="'";}else return text;}else text+=c;}throw Error('HOST_JSON_UNTERMINATED');};
  const expression=():unknown=>{
    if(source.startsWith("E'",offset)){const text=literal();requireText('::jsonb');return JSON.parse(text);}
    for(const kind of ['jsonb_build_array','jsonb_build_object'])if(source.startsWith(kind+'(',offset)){
      requireText(kind+'(');const values:unknown[]=[];
      while(source[offset]!==')'){if(values.length)requireText(',');values.push(kind==='jsonb_build_object'&&values.length%2===0?literal():expression());}
      requireText(')');if(kind==='jsonb_build_array')return values;
      if(values.length%2)throw Error('HOST_JSON_OBJECT_ARITY');const obj:Record<string,unknown>={};
      for(let i=0;i<values.length;i+=2)Object.defineProperty(obj,String(values[i]),{value:values[i+1],enumerable:true,writable:true,configurable:true});return obj;
    }
    if(source[offset]==='('){offset++;let result=expression();while(source.startsWith(' || ',offset)){offset+=4;const next=expression();if(Array.isArray(result)&&Array.isArray(next))result=[...result,...next];else if(result&&next&&typeof result==='object'&&typeof next==='object'&&!Array.isArray(result)&&!Array.isArray(next))result={...result,...next};else throw Error('HOST_JSON_CONCAT_TYPES');}requireText(')');return result;}
    const match=/^atomic_json_[0-9]+/.exec(source.slice(offset));if(!match||!variables.has(match[0]))throw Error('HOST_JSON_REFERENCE');offset+=match[0].length;return variables.get(match[0]);
  };
  while(offset<source.length){const match=/^(atomic_json_[0-9]+|source_result_data|expected_context_data) jsonb := /.exec(source.slice(offset));if(!match||variables.has(match[1]!))throw Error('HOST_JSON_DECLARATION');offset+=match[0].length;variables.set(match[1]!,expression());requireText(';');if(offset<source.length)requireText('\n');}
  const terminal=variables.get('source_result_data'),decodedContext=variables.get('expected_context_data');
  if(origin&&canonicalProjectionJson(origin.context)!==canonicalProjectionJson(decodedContext))throw Error('HOST_CONTEXT_ORIGIN_SEMANTIC_MISMATCH');
  const context=origin?origin.context:decodedContext;
  if(!terminal||!context||compileAtomicJsonDeclarations(terminal,context)!==source)throw Error('HOST_JSON_COMPILER_ROUNDTRIP');
  return {terminal:terminal as Record<string,any>,context:context as Record<string,any>};
}
export function inspectPacketSql(sql:string,origin?:any){
  const match=/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\nDECLARE affected bigint; job_data jsonb; ([\s\S]*?) current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\n([\s\S]*)\nEND;\n\1;$/.exec(sql);
  if(!match||match[2]!.includes(match[1]!)||match[3]!.includes(match[1]!))throw Error('HOST_ATOMIC_PACKET_SHAPE');
  const {terminal,context}=decodeDeclarations(match[2]!,origin);
  if(origin&&(terminal.batchId!==origin.batchId||terminal.sourceId!==origin.sourceId||terminal.sourceConfigHash!==origin.sourceConfigSha256||terminal.releaseCandidateId!==origin.candidateId))throw Error('HOST_CONTEXT_ORIGIN_TERMINAL_TUPLE');
  const receipt=parseJobProjectionDeltaReceipt(terminal.completenessCertificate,terminal.completenessCertificateSha256);
  if(hashProjectionJson(receipt.legacyCertificate)!==receipt.legacyCertificateSha256)throw Error('HOST_DELTA_LEGACY_HASH');
  const legacy=unwrapJobProjectionSourceRow(terminal);
  return {terminal,context,legacyCertificate:legacy.completenessCertificate,delta:{schemaVersion:receipt.schemaVersion,manifestSha256:receipt.manifestSha256,memberCount:receipt.members.length,observedAt:receipt.observedAt,verifiedAt:receipt.verifiedAt},sqlSha256:sha(sql),declarationMode:'FROZEN_COMPILER_SHARED_JSON_V1'};
}
export function inspectRequest(request:any,origin?:any){
  const {requestSha256,...body}=request;
  if(request.kind!=='PUBLISH'||sha(JSON.stringify(body))!==requestSha256||typeof request.payload?.sql!=='string')throw Error('HOST_PUBLICATION_REQUEST_HASH');
  const packet=inspectPacketSql(request.payload.sql,origin);
  if(request.payload.projectId!=='yiopvxysxrtrnvqxwgbx')throw Error('HOST_PUBLICATION_PROJECT');
  return {...packet,requestId:request.requestId,requestSha256,validated:true,...(origin?{contextOriginSha256:origin.originSha256,contextReadRequestId:origin.contextRequestId,contextReadResponseSha256:origin.responseSha256}:{})};
}
// Context order is recovered only from a parent-pinned original read receipt.
// Its JSON meaning must match the decoded SQL, then the original compiler must
// recreate the complete declaration bytes. No SQL/value canonicalization replaces that gate.
export function loadBoundPublicationContext(requestPath:string,request:any):any|undefined {
  const relay=dirname(resolve(requestPath)),run=dirname(relay),host=dirname(run);
  const activationPath=join(host,'activation.json');
  if(!existsSync(activationPath))return undefined;
  const binding=JSON.parse(readFileSync(activationPath,'utf8'));
  const reference=binding.reviewContextOrigins?.[request.requestSha256];
  if(reference===undefined)return undefined;
  const fail=(ok:unknown,code:string)=>{if(!ok)throw Error('HOST_CONTEXT_ORIGIN_'+code);};
  const readPinned=(path:string,pin:string)=>{
    fail(typeof path==='string'&&isAbsolute(path)&&realpathSync(path)===path&&lstatSync(path).isFile()&&/^[a-f0-9]{64}$/.test(pin),'FILE');
    const bytes=readFileSync(path);fail(sha(bytes)===pin,'FILE_HASH');return JSON.parse(bytes.toString('utf8'));
  };
  fail(reference&&Object.keys(reference).sort().join(',')==='path,sha256'&&reference.path===join(run,'review-context-origin.json'),'REFERENCE');
  const origin=readPinned(reference.path,reference.sha256),cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
  const control=JSON.parse(readFileSync(join(host,'control-base.json'),'utf8'));
  fail(basename(relay)==='relay'&&resolve(requestPath)===join(relay,request.requestId+'.request.json')&&cfg.root===host,'RUN_PATH');
  fail(binding.status==='REGISTERED_VERIFIED'&&control.candidate?.id===binding.candidate?.id&&control.build?.commitSha===binding.build?.commitSha&&binding.build.commitSha==='28402a299bb04cbf5873da66c2fe8ca76827c0d1','CANDIDATE');
  fail(origin.schemaVersion===1&&origin.requestId===request.requestId&&origin.requestSha256===request.requestSha256&&origin.sqlSha256===sha(request.payload.sql),'PUBLISH_BINDING');
  fail(origin.batchId===basename(run)&&origin.sourceId===cfg.sourceId&&origin.sourceConfigSha256===cfg.sourceConfigSha256&&origin.candidateId===binding.candidate.id,'SCOPE');
  const reqRef=origin.contextRequest,resRef=origin.contextResponse,hostRef=origin.contextHostResult;
  fail(reqRef&&resRef&&hostRef&&/^[a-f0-9-]{36}$/.test(reqRef.id)&&reqRef.path===join(relay,reqRef.id+'.request.json')&&resRef.path===join(relay,reqRef.id+'.response.json')&&hostRef.path===join(relay,reqRef.id+'.host-result.json'),'READ_PATH');
  const readRequest=readPinned(reqRef.path,reqRef.sha256),response=readPinned(resRef.path,resRef.sha256),hostResult=readPinned(hostRef.path,hostRef.sha256);
  const {requestSha256:readHash,...readBody}=readRequest;
  fail(readRequest.schemaVersion===1&&readRequest.kind==='READ_PUBLICATION_CONTEXT'&&readRequest.requestId===reqRef.id&&readHash===reqRef.requestSha256&&sha(JSON.stringify(readBody))===readHash,'READ_REQUEST');
  fail(readRequest.payload?.projectId===cfg.project&&readRequest.payload.sql===compileCloudPilotPublicationContextSql(control),'READ_COMPILER');
  fail(response.schemaVersion===1&&response.kind===readRequest.kind&&response.requestId===reqRef.id&&response.requestSha256===readHash&&hostResult.requestId===reqRef.id&&hostResult.requestSha256===readHash,'READ_RESPONSE');
  fail(canonicalProjectionJson(response.result)===canonicalProjectionJson(hostResult.result),'HOST_RESULT');
  fail(response.result?.status==='SUCCEEDED'&&response.result.rows?.length===1,'READ_RESULT');
  const raw=response.result.rows[0].context;
  const keys=['checkedAt','sourceId','sourceConfigSha256','jobs','latestAccepted','firstAccepted','candidateRow','sourceRow','companyRow'];
  fail(raw&&Object.keys(raw).sort().join(',')===[...keys].sort().join(',')&&raw.sourceId===cfg.sourceId&&raw.sourceConfigSha256===cfg.sourceConfigSha256&&raw.candidateRow?.id===binding.candidate.id,'READ_CONTEXT');
  fail(sha(readFileSync(join(cfg.repo,'src/db/cloudPilotSqlControl.ts'),'utf8'))===FROZEN_CONTEXT_SCHEMA_SHA256&&sha(readFileSync(join(cfg.repo,'src/db/atomicJsonDeclarations.ts'),'utf8'))===FROZEN_JSON_COMPILER_SHA256,'FROZEN_COMPILER');
  // These are the exact root field positions in the hash-pinned native z.object.
  // Nested records remain the exact original receipt values and insertion order.
  return {context:Object.fromEntries(keys.map(key=>[key,raw[key]])),batchId:origin.batchId,sourceId:origin.sourceId,sourceConfigSha256:origin.sourceConfigSha256,candidateId:origin.candidateId,originSha256:reference.sha256,contextRequestId:reqRef.id,contextRequestSha256:readHash,responseSha256:resRef.sha256};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await verifyNodeRuntimeProfile();
  const [requestPath,mode,...extra]=process.argv.slice(2);if(!requestPath||extra.length||mode&&mode!=='summary')throw Error('HOST_PACKET_REVIEW_ARGUMENTS');
  const request=JSON.parse(readFileSync(requestPath,'utf8'));
  const out=inspectRequest(request,loadBoundPublicationContext(requestPath,request));
  if(mode==='summary'){const {terminal,context,legacyCertificate,delta,...summary}=out;console.log(JSON.stringify(summary));}else console.log(JSON.stringify(out));
}
