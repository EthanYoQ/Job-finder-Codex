/** Does not claim to cancel a SQL statement or prove rollback. */
export async function withinDeadline(operation,deadline,{now=Date.now,signal}={}){
 if(!Number.isSafeInteger(deadline)||now()>=deadline)throw Error('ORIGINAL_BUDGET_EXHAUSTED');
 let timer;
 const timeout=new Promise((_,reject)=>{const tick=()=>{const left=deadline-now();if(left<=0||signal?.aborted)reject(Error('ORIGINAL_BUDGET_EXHAUSTED'));else timer=setTimeout(tick,Math.min(100,left));};tick();});
 try{const result=await Promise.race([Promise.resolve().then(operation),timeout]);if(now()>=deadline||signal?.aborted)throw Error('ORIGINAL_BUDGET_EXHAUSTED');return result;}finally{clearTimeout(timer);}
}
