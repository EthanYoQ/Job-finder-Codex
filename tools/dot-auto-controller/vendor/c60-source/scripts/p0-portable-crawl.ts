import { describePortableRuntimeError } from "../src/crawler/portableRuntimeDiagnostics";
import { PrismaClient } from "@prisma/client";
import { runPortableScheduledCrawl } from "../src/crawler/portableScheduledCrawl";

const args=process.argv.slice(2);
if(args.some(arg=>arg!=="--force")||args.length>1){
  console.error("Usage: p0-portable-crawl.ts [--force]");process.exitCode=2;
}else{
  // Separate pools, same existing datasource. Never share the publishing pool
  // with background lease control, even when connection_limit is one.
  const db=new PrismaClient(),clients=[db];
  try{
    const leaseDb=new PrismaClient();clients.push(leaseDb);
    const report=await runPortableScheduledCrawl({db,leaseDb,workspaceRoot:process.cwd(),force:args.includes("--force")});
    console.log(JSON.stringify({policyId:report.policyId,releaseCandidateId:report.identity.releaseCandidateId,...report.result}));
    process.exitCode=report.result.status==="SUCCESS"?0:1;
  }catch(error){
    // Do not print raw connection/driver messages that may embed credentials.
    console.error(JSON.stringify({ok:false,code:"PORTABLE_CRAWL_FAILED",diagnostic:describePortableRuntimeError(error)}));
    process.exitCode=1;
  }finally{await Promise.allSettled(clients.map(client=>Promise.resolve().then(()=>client.$disconnect())));}
}
