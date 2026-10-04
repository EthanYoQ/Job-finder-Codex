import {describePortableRuntimeError} from "../src/crawler/portableRuntimeDiagnostics";
import {PrismaClient} from "@prisma/client";
import {setTimeout as wait} from "node:timers/promises";
import {nextP0SchedulerWindow} from "../src/crawler/schedule";
import {resolveCurrentStagedScheduleAuthority,type StagedScheduleAuthorityDb} from "../src/crawler/stagedScheduleAuthority";
import {runPortableScheduledCrawl} from "../src/crawler/portableScheduledCrawl";

// Operational windows selected from the existing schedule: 00:01 and 12:01 China time. Partial rounds
// do not become tight retry loops or fabricated full successes.
// Reuse one independent pool per role for the entire scheduler lifetime.
const db=new PrismaClient(),clients=[db],stop=new AbortController();
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>stop.abort());
let attemptedLocally:Date|undefined;
try{
  const leaseDb=new PrismaClient();clients.push(leaseDb);
  while(!stop.signal.aborted){
    try{
      const authority=await resolveCurrentStagedScheduleAuthority(db as unknown as StagedScheduleAuthorityDb);
      const latest=await db.crawlBatch.findFirst({where:{releaseCandidateId:authority.identity.releaseCandidateId,kind:"SCHEDULED"},select:{startedAt:true},orderBy:{startedAt:"desc"}});
      const last=attemptedLocally&&(!latest||attemptedLocally>latest.startedAt)?attemptedLocally:latest?.startedAt;
      const next=nextP0SchedulerWindow(new Date(),last);
      console.log(JSON.stringify({event:"NEXT_PORTABLE_WINDOW",startsAt:next.startsAt,chinaWindow:next.label}));
      await wait(Math.max(0,Date.parse(next.startsAt)-Date.now()),undefined,{signal:stop.signal});
      if(stop.signal.aborted)break;
      attemptedLocally=new Date();
      const report=await runPortableScheduledCrawl({db,leaseDb,workspaceRoot:process.cwd()});
      console.log(JSON.stringify({event:"PORTABLE_WINDOW_FINISHED",requiredSources:report.coverage.requiredSourceIds.length,...report.result}));
    }catch(error){
      if(stop.signal.aborted)break;
      console.error(JSON.stringify({event:"PORTABLE_SCHEDULER_ERROR",diagnostic:describePortableRuntimeError(error)}));
      await wait(60*60*1000,undefined,{signal:stop.signal}).catch(()=>{});
    }
  }
}finally{await Promise.allSettled(clients.map(client=>Promise.resolve().then(()=>client.$disconnect())));}
