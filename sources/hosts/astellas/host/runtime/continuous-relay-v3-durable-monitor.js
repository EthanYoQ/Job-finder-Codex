
const A=Object.getPrototypeOf(async function(){}).constructor;
const s=await new A(load("proxyNode22:astellas:cloudPilotHostStages"))();
const run=load("proxyNode22:astellas:refreshCurrentRun"),dir=run+"/relay";
let lastHeartbeat=0,lastStatus=0;
const loopStarted=Date.now(),stopAt=loopStarted+30*60*1000;
while(Date.now()<stopAt){
 let req;try{req=await s.h.next(dir);}catch(error){if(!(Date.now()-loopStarted<60000&&String(error).includes("ENOENT")&&String(error).includes("scandir '"+dir+"'")))throw error;}
 if(req){
  notify({at:new Date().toISOString(),phase:req.kind,requestId:req.requestId,expiresAt:req.expiresAt});
  const out=await s.handle(req,dir);store("proxyNode22:astellas:freshLastRelayResult",out);
  notify({at:new Date().toISOString(),phase:req.kind,status:out.status,rowCount:out.rows?.length});
  if(req.kind==="PUBLISH"){text(out);break;}
 }
 if(Date.now()-lastStatus>20000){
  const status=JSON.parse(await s.h.cmd("python3 - "+s.h.q(run)+" <<'PY'\nimport json,pathlib,sys,collections\np=pathlib.Path(sys.argv[1])\ndef lines(n):\n q=p/n\n return [json.loads(x) for x in q.read_text().splitlines() if x] if q.exists() else []\ndef obj(n):\n q=p/n\n return json.loads(q.read_text()) if q.exists() else None\na=lines('diagnostics/process.jsonl');b=lines('diagnostics/http-requests.jsonl');last=a[-1] if a else {};counts=collections.Counter(x.get('event') for x in b);print(json.dumps({'process':last,'supervisor':obj('cancel-control/terminal.json'),'observer':obj('memory-observation/summary.json'),'http':dict(counts),'lastAt':b[-1].get('recordedAt') if b else None}))\nPY",2000));
  store("proxyNode22:astellas:portableCurrentProcessStatus",status);lastStatus=Date.now();
  if(status.process?.event==="CHILD_EXIT"){
    const activeSession=load("proxyNode22:astellas:refreshSession");
    if(!Number.isSafeInteger(activeSession))throw Error("NO_ORIGINAL_EXEC_SESSION");
    const levels={wrapper:{state:"TERMINATED",record:status.process},supervisor:{state:status.supervisor?"RECEIPT_PRESENT":"UNKNOWN",record:status.supervisor??null},observer:{state:status.observer?.status==="TARGET_TREE_EXITED"?"OBSERVED_EXIT":"UNKNOWN",record:status.observer??null}};
    let announcedRunning=false;
    while(Date.now()<stopAt){
      let poll;
      try{poll=await tools.write_stdin({session_id:activeSession,chars:"",yield_time_ms:1000,max_output_tokens:1200});}
      catch(error){
        const diagnostic={at:new Date().toISOString(),originalSessionId:activeSession,error:String(error),classification:"TERMINAL_OUTPUT_POLL_UNRESOLVED_NO_RETRY",levels};
        store("proxyNode22:astellas:lastPortableExecPoll",diagnostic);notify(diagnostic);
        text({status:"ORIGINAL_EXEC_UNKNOWN",levels,originalSessionId:activeSession});return;
      }
      store("proxyNode22:astellas:lastPortableExecPollRaw",{at:new Date().toISOString(),originalSessionId:activeSession,raw:poll});
      if(poll.exit_code!==undefined&&poll.session_id===undefined){
        if(!Number.isInteger(poll.exit_code)||poll.exit_code!==status.process.wrapperExitCode){
          const diagnostic={at:new Date().toISOString(),originalSessionId:activeSession,classification:"DURABLE_EXIT_TOOL_EXIT_MISMATCH",levels};
          store("proxyNode22:astellas:lastPortableExecPoll",diagnostic);notify(diagnostic);
          throw Error("DURABLE_EXIT_TOOL_EXIT_MISMATCH");
        }
        // Only a validated original-session terminal can feed completion.
        store("proxyNode22:astellas:lastPortableExecPoll",{at:new Date().toISOString(),originalSessionId:activeSession,exit_code:poll.exit_code});
        text({status:"PROCESS_TERMINATED",levels,originalExec:{state:"TERMINATED",sessionId:activeSession,exitCode:poll.exit_code},terminalToolPoll:poll});return;
      }
      if(poll.session_id!==activeSession||poll.exit_code!==undefined){
        const diagnostic={at:new Date().toISOString(),originalSessionId:activeSession,classification:"ORIGINAL_EXEC_POLL_SHAPE_UNKNOWN",levels};
        store("proxyNode22:astellas:lastPortableExecPoll",diagnostic);notify(diagnostic);
        text({status:"ORIGINAL_EXEC_UNKNOWN",levels,originalSessionId:activeSession});return;
      }
      store("proxyNode22:astellas:lastPortableExecPoll",{at:new Date().toISOString(),originalSessionId:activeSession,session_id:activeSession,classification:"ORIGINAL_EXEC_RUNNING"});
      if(!announcedRunning){notify({status:"WRAPPER_EXIT_ORIGINAL_EXEC_STILL_RUNNING",levels,originalSessionId:activeSession});announcedRunning=true;}
      // Only the original session is polled again. No restart or alternate route.
    }
    const diagnostic={at:new Date().toISOString(),originalSessionId:activeSession,classification:"ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED",levels};
    store("proxyNode22:astellas:lastPortableExecPoll",diagnostic);notify(diagnostic);
    text({status:"ORIGINAL_EXEC_UNKNOWN",levels,originalSessionId:activeSession});return;
  }
  if(Date.now()-lastHeartbeat>55000){notify({at:new Date().toISOString(),status:"CAPTURE_OR_CONTROL_RUNNING",...status});lastHeartbeat=Date.now();}
 }
 await new Promise(resolve=>setTimeout(resolve,1200));
}

if(Date.now()>=stopAt)throw Error("HOST_MONITOR_TOTAL_BUDGET_EXHAUSTED");
