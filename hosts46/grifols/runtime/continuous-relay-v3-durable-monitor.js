
const A=Object.getPrototypeOf(async function(){}).constructor;
const s=await new A(load("restored46:grifols:cloudPilotHostStages"))();
const run=load("restored46:grifols:refreshCurrentRun"),dir=run+"/relay";
let lastHeartbeat=0,lastStatus=0;
const loopStarted=Date.now(),stopAt=loopStarted+30*60*1000;
while(Date.now()<stopAt){
 let req;try{req=await s.h.next(dir);}catch(error){if(!(Date.now()-loopStarted<60000&&String(error).includes("ENOENT")&&String(error).includes("scandir '"+dir+"'")))throw error;}
 if(req){
  notify({at:new Date().toISOString(),phase:req.kind,requestId:req.requestId,expiresAt:req.expiresAt});
  const out=await s.handle(req,dir);store("restored46:grifols:freshLastRelayResult",out);
  notify({at:new Date().toISOString(),phase:req.kind,status:out.status,rowCount:out.rows?.length});
  if(req.kind==="PUBLISH"){text(out);break;}
 }
 if(Date.now()-lastStatus>20000){
  const status=JSON.parse(await s.h.cmd("python3 - "+s.h.q(run)+" <<'PY'\nimport json,pathlib,sys,collections\np=pathlib.Path(sys.argv[1])\ndef lines(n):\n q=p/n\n return [json.loads(x) for x in q.read_text().splitlines() if x] if q.exists() else []\na=lines('diagnostics/process.jsonl');b=lines('diagnostics/http-requests.jsonl');last=a[-1] if a else {};counts=collections.Counter(x.get('event') for x in b);print(json.dumps({'process':last,'http':dict(counts),'lastAt':b[-1].get('recordedAt') if b else None}))\nPY",2000));
  store("restored46:grifols:portableCurrentProcessStatus",status);lastStatus=Date.now();
  if(status.process?.event==="CHILD_EXIT"){
    const activeSession=load("restored46:grifols:refreshSession");
    if(!Number.isSafeInteger(activeSession))throw Error("NO_ORIGINAL_EXEC_SESSION");
    let terminalPoll;
    try{
      const poll=await tools.write_stdin({session_id:activeSession,chars:"",yield_time_ms:1000,max_output_tokens:1200});
      store("restored46:grifols:lastPortableExecPoll",{at:new Date().toISOString(),...poll});
      terminalPoll=poll;
    }catch(error){
      const diagnostic={at:new Date().toISOString(),session:activeSession,error:String(error),classification:"TERMINAL_OUTPUT_POLL_UNRESOLVED_NO_RETRY",durableProcess:status.process};
      store("restored46:grifols:lastPortableExecPoll",diagnostic);notify(diagnostic);
      text({status:"DURABLE_CHILD_EXIT_OUTPUT_UNRESOLVED",...status});
    }
    if(terminalPoll){
      if(terminalPoll.exit_code!==undefined&&terminalPoll.exit_code!==status.process.wrapperExitCode)throw Error("DURABLE_EXIT_TOOL_EXIT_MISMATCH");
      text({status:"PROCESS_TERMINATED",...status,terminalToolPoll:terminalPoll});
    }
    break;
  }
  if(Date.now()-lastHeartbeat>55000){notify({at:new Date().toISOString(),status:"CAPTURE_OR_CONTROL_RUNNING",...status});lastHeartbeat=Date.now();}
 }
 await new Promise(resolve=>setTimeout(resolve,1200));
}

if(Date.now()>=stopAt)throw Error("HOST_MONITOR_TOTAL_BUDGET_EXHAUSTED");

