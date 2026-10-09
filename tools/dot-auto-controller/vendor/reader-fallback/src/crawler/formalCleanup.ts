export async function runFormalCleanup(steps:readonly {name:string;run:()=>Promise<unknown>}[]):Promise<void>{
  const results=await Promise.allSettled(steps.map(step=>step.run()));
  const failures=results.flatMap((result,index)=>result.status==="rejected"?[new Error(`${steps[index]!.name} cleanup failed`,{cause:result.reason})]:[]);
  if(failures.length)throw new AggregateError(failures,"CRITICAL: one or more formal cleanup operations failed");
}
