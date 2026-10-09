import {Client} from "pg";

export const FORMAL_ADVISORY_LOCK_KEYS=[0x4a4f4246,0x5048524d] as const;
const DEFAULT_TIMEOUT_MS=10_000;
interface AdvisoryClient {connect():Promise<void>;query<T extends Record<string,unknown>>(text:string,values?:readonly unknown[]):Promise<{rows:T[]}>;end():Promise<void>}
export interface FormalAdvisoryLock {release():Promise<void>}

export async function acquireFormalAdvisoryLock(input:{databaseUrl:string;clientFactory?:()=>AdvisoryClient;timeoutMs?:number}):Promise<FormalAdvisoryLock>{
  if(!input.databaseUrl.trim())throw new Error("DATABASE_URL is required for formal advisory coordination");
  const timeoutMs=input.timeoutMs??DEFAULT_TIMEOUT_MS;
  const client=input.clientFactory?.()??new Client({connectionString:input.databaseUrl,connectionTimeoutMillis:timeoutMs,query_timeout:timeoutMs,statement_timeout:timeoutMs,application_name:"job-finder-formal-coordinator"});
  try{
    await bounded(client.connect(),timeoutMs,"connect");
    const result=await bounded(client.query<{acquired:boolean}>("SELECT pg_try_advisory_lock($1, $2) AS acquired",FORMAL_ADVISORY_LOCK_KEYS),timeoutMs,"lock query");
    if(result.rows.length!==1||result.rows[0]?.acquired!==true)throw new Error("Another formal crawl or recovery session holds the PostgreSQL advisory lock");
  }catch(error){
    try{await bounded(client.end(),timeoutMs,"acquire cleanup end");}catch(endError){throw new AggregateError([error,endError],"CRITICAL: advisory acquisition failed and PostgreSQL session cleanup also failed");}
    throw new Error("Formal PostgreSQL advisory lock acquisition failed",{cause:error});
  }
  let released=false;
  return {release:async()=>{
    if(released)return;
    released=true;
    const failures:unknown[]=[];
    try{
      const result=await bounded(client.query<{unlocked:boolean}>("SELECT pg_advisory_unlock($1, $2) AS unlocked",FORMAL_ADVISORY_LOCK_KEYS),timeoutMs,"unlock query");
      if(result.rows.length!==1||result.rows[0]?.unlocked!==true)throw new Error("PostgreSQL advisory unlock was not confirmed");
    }catch(error){failures.push(error);}
    try{await bounded(client.end(),timeoutMs,"release end");}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,"CRITICAL: formal PostgreSQL advisory lock release failed");
  }};
}

async function bounded<T>(operation:Promise<T>,timeoutMs:number,label:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`CRITICAL: PostgreSQL ${label} timed out after ${timeoutMs}ms`)),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
