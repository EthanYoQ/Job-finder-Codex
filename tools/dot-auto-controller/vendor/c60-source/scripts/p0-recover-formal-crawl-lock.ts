import {loadCurrentReleaseIdentity} from "../src/readiness/currentReleaseIdentity";
import {runFormalCleanup} from "../src/crawler/formalCleanup";
const args=process.argv.slice(2);
const allowed=["--expected-sha256=","--operator-id=","--reason="];
const unknown=args.find(arg=>!allowed.some(prefix=>arg.startsWith(prefix)));
if(unknown)throw new Error(`Unknown recovery argument: ${unknown}`);
const expected=args.find(x=>x.startsWith("--expected-sha256="))?.split("=")[1]??"";
const operatorId=args.find(x=>x.startsWith("--operator-id="))?.slice("--operator-id=".length)??"";
const reason=args.find(x=>x.startsWith("--reason="))?.slice("--reason=".length)??"";
const identity=await loadCurrentReleaseIdentity();
const [{acquireFormalAdvisoryLock},{PrismaClient},{recoverFormalCrawlLockAfterDbCheck}]=await Promise.all([import("../src/crawler/formalAdvisoryLock"),import("@prisma/client"),import("../src/crawler/formalCrawlLock")]);
const advisoryLock=await acquireFormalAdvisoryLock({databaseUrl:process.env.DATABASE_URL??""});
const prisma=new PrismaClient();
try{
  const result=await recoverFormalCrawlLockAfterDbCheck({db:prisma as never,identity,expectedSha256:expected,operatorId,reason});
  console.log(`Quarantined stale formal crawl lock at ${result.quarantine}; audit ${result.auditPath}`);
}finally{await runFormalCleanup([{name:"Prisma disconnect",run:()=>prisma.$disconnect()},{name:"PostgreSQL advisory lock release",run:()=>advisoryLock.release()}]);}
