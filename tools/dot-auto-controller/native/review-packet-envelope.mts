// Local, non-executing parser for the frozen compiler's exact JSON declarations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyNodeRuntimeProfile } from '../vendor/c60-source/scripts/verify-node-runtime-profile.ts';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAtomicJsonDeclarations } from '../vendor/c60-source/src/db/atomicJsonDeclarations.ts';
import { unwrapJobProjectionSourceRow } from '../vendor/c60-source/src/db/jobProjectionDeltaCompiler.ts';
import { parseJobProjectionDeltaReceipt, hashProjectionJson } from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const sha = (value:string) => createHash('sha256').update(value).digest('hex');
export function decodeDeclarations(source:string) {
  let offset=0;const variables=new Map<string,unknown>();
  const requireText=(text:string)=>{if(!source.startsWith(text,offset))throw Error('HOST_JSON_DECLARATION_SYNTAX');offset+=text.length;};
  const literal=()=>{requireText("E'");let text='';while(offset<source.length){const c=source[offset++]!;if(c==='\\'){const n=source[offset++]!;if(n!=='\\')throw Error('HOST_JSON_ESCAPE');text+=n;}else if(c==="'"){if(source[offset]==="'"){offset++;text+="'";}else return text;}else text+=c;}throw Error('HOST_JSON_UNTERMINATED');};
  const packedRecords=():unknown=>{
    requireText('(SELECT jsonb_agg(');const common=expression();
    if(!common||typeof common!=='object'||Array.isArray(common))throw Error('HOST_JSON_COMMON');
    requireText(' || jsonb_build_object(');const fields:{key:string,index:number}[]=[];
    while(source[offset]!==')'){
      if(fields.length)requireText(', ');const key=literal();requireText(', tuple.value->');
      const match=/^[0-9]+/.exec(source.slice(offset));if(!match)throw Error('HOST_JSON_TUPLE_INDEX');
      offset+=match[0].length;fields.push({key,index:Number(match[0])});
    }
    requireText(') ORDER BY tuple.ordinality)\n    FROM jsonb_array_elements(');const rows=expression();
    requireText(') WITH ORDINALITY AS tuple(value, ordinality))');
    if(!Array.isArray(rows))throw Error('HOST_JSON_TUPLE_ROWS');
    return rows.map(row=>{
      if(!Array.isArray(row))throw Error('HOST_JSON_TUPLE_ROW');const result={...common};
      for(const {key,index} of fields){if(index>=row.length||Object.hasOwn(result,key))throw Error('HOST_JSON_TUPLE_FIELD');Object.defineProperty(result,key,{value:row[index],enumerable:true,writable:true,configurable:true});}
      return result;
    });
  };
  const expression=():unknown=>{
    if(source.startsWith('(SELECT jsonb_agg(',offset))return packedRecords();
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
  const terminal=variables.get('source_result_data'),context=variables.get('expected_context_data');
  if(!terminal||!context||compileAtomicJsonDeclarations(terminal,context)!==source)throw Error('HOST_JSON_COMPILER_ROUNDTRIP');
  return {terminal:terminal as Record<string,any>,context:context as Record<string,any>};
}
export function inspectPacketSql(sql:string){
  const match=/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\nDECLARE affected bigint; job_data jsonb; ([\s\S]*?) current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\n([\s\S]*)\nEND;\n\1;$/.exec(sql);
  if(!match||match[2]!.includes(match[1]!)||match[3]!.includes(match[1]!))throw Error('HOST_ATOMIC_PACKET_SHAPE');
  const {terminal,context}=decodeDeclarations(match[2]!);
  const receipt=parseJobProjectionDeltaReceipt(terminal.completenessCertificate,terminal.completenessCertificateSha256);
  if(hashProjectionJson(receipt.legacyCertificate)!==receipt.legacyCertificateSha256)throw Error('HOST_DELTA_LEGACY_HASH');
  const legacy=unwrapJobProjectionSourceRow(terminal);
  return {terminal,context,legacyCertificate:legacy.completenessCertificate,delta:{schemaVersion:receipt.schemaVersion,manifestSha256:receipt.manifestSha256,memberCount:receipt.members.length,observedAt:receipt.observedAt,verifiedAt:receipt.verifiedAt},sqlSha256:sha(sql),declarationMode:'FROZEN_COMPILER_SHARED_JSON_V1'};
}
export function inspectRequest(request:any){
  const {requestSha256,...body}=request;
  if(request.kind!=='PUBLISH'||sha(JSON.stringify(body))!==requestSha256||typeof request.payload?.sql!=='string')throw Error('HOST_PUBLICATION_REQUEST_HASH');
  const packet=inspectPacketSql(request.payload.sql);
  if(request.payload.projectId!=='yiopvxysxrtrnvqxwgbx')throw Error('HOST_PUBLICATION_PROJECT');
  return {...packet,requestId:request.requestId,requestSha256,validated:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await verifyNodeRuntimeProfile();
  const [requestPath,mode,...extra]=process.argv.slice(2);if(!requestPath||extra.length||mode&&mode!=='summary')throw Error('HOST_PACKET_REVIEW_ARGUMENTS');
  const out=inspectRequest(JSON.parse(readFileSync(requestPath,'utf8')));
  if(mode==='summary'){const {terminal,context,legacyCertificate,delta,...summary}=out;console.log(JSON.stringify(summary));}else console.log(JSON.stringify(out));
}
