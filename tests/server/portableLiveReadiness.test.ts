// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listCurrentPrismaMigrations } from "../../src/db/prismaMigrationManifest";
import { SOURCE_QUALITY_POLICY_ID } from "../../src/crawler/sourceQualityAdmission";
import { startServer } from "../../src/server/httpServer";
const state=vi.hoisted(()=>({handler:undefined as ((request:IncomingMessage,response:ServerResponse)=>void)|undefined,query:vi.fn(),
  read: vi.fn(async () => []), listen: vi.fn(), disconnect: vi.fn(async () => undefined)}));
vi.mock("pg",()=>({Client:class{connect=async()=>undefined;query=state.query;end=async()=>undefined;}}));
vi.mock("@prisma/client",()=>({PrismaClient:class{
  $disconnect=state.disconnect;
  $transaction=async(work:(tx:unknown)=>Promise<unknown>)=>work({crawlBatchSourceResult:{findMany:state.read},
    lifecycleSetEvidenceMember:{findMany:async()=>[]},job:{findMany:async()=>[]}});
}}));
vi.mock("../../src/ops/deploymentBootstrap",()=>({resolveDeploymentBootstrapConfig:()=>({databaseUrl:"postgresql://synthetic.invalid/test",adminEmail:"test@example.invalid",adminPasswordHash:"synthetic-only"})}));
vi.mock("node:http",()=>({createServer:(handler:typeof state.handler)=>{state.handler=handler;return {listen:(_port:number,_host:string,ready:()=>void)=>{state.listen();ready();},close:(closed:()=>void)=>closed()};}}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("keeps portable live readiness healthy after a compatible policy migration while legacy retains exact history checks",async()=>{
  const expected=listCurrentPrismaMigrations(process.cwd());
  const databaseHistory=[...expected,{migrationName:"20270101000000_compatible_source_policy",checksum:"a".repeat(64)}].map(m=>({migration_name:m.migrationName,checksum:m.checksum,finished_at:new Date(),rolled_back_at:null}));
  state.query.mockImplementation(async(sql:string)=>sql==="SELECT 1 AS readiness"?{rowCount:1,rows:[{readiness:1}]}:{rows:databaseHistory});
  const events=["SIGINT","SIGTERM"] as const,original=new Map(events.map(event=>[event,new Set(process.listeners(event))]));
  try{
    for(const [policy,status] of [[SOURCE_QUALITY_POLICY_ID,200],[undefined,503]] as const){
      vi.stubEnv("JOBFINDER_PUBLICATION_POLICY",policy);state.query.mockClear();await startServer();
      const response=await new Promise<{status:number;body:unknown}>(done=>{
        const res={statusCode:0,headersSent:false,setHeader:()=>undefined,hasHeader:()=>false,end:(body:string)=>done({status:res.statusCode,body:JSON.parse(body)})};
        state.handler!({method:"GET",url:"/readyz",headers:{},socket:{remoteAddress:"127.0.0.1"}} as IncomingMessage,res as unknown as ServerResponse);
      });
      expect(response).toEqual({status,body:{ok:status===200}});
      if(policy)expect(state.query.mock.calls).toEqual([["SELECT 1 AS readiness"]]);
      else expect(state.query.mock.calls[0]![0]).toContain('"_prisma_migrations"');
    }
  }finally{for(const event of events)for(const listener of process.listeners(event))if(!original.get(event)!.has(listener))process.removeListener(event,listener);}
});
it("does not listen or become ready if the initial verified public read fails",async()=>{
  vi.stubEnv("JOBFINDER_PUBLICATION_POLICY",SOURCE_QUALITY_POLICY_ID);
  state.read.mockRejectedValueOnce(new Error("initial public read failed"));
  await expect(startServer()).rejects.toThrow("initial public read failed");
  expect(state.listen).not.toHaveBeenCalled();
  expect(state.disconnect).toHaveBeenCalledOnce();
});
it("waits for the initial verified public read before listening",async()=>{
  vi.stubEnv("JOBFINDER_PUBLICATION_POLICY",SOURCE_QUALITY_POLICY_ID);
  let finish!:()=>void;
  state.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve([]);}));
  const events=["SIGINT","SIGTERM"] as const,original=new Map(events.map(event=>[event,new Set(process.listeners(event))]));
  try{
    const starting=startServer();
    await Promise.resolve();
    expect(state.listen).not.toHaveBeenCalled();
    finish(); await starting;
    expect(state.listen).toHaveBeenCalledOnce();
  }finally{for(const event of events)for(const listener of process.listeners(event))if(!original.get(event)!.has(listener))process.removeListener(event,listener);}
});
