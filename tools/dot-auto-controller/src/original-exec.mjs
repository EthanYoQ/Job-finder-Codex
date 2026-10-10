/** The only producer of accepted original-exec tokens invokes the original
 * tool poll and existing native chain validator, rather than reading a JSON file.
 * Tokens cannot survive restart or be created from saved success-shaped JSON.
 */
import {withinDeadline} from './deadline.mjs';
import {equal,verifyOriginalTerminal} from './gates.mjs';
export function createOriginalExecObserver({pollOriginal,validateNativeChain,now=Date.now}) {
  const receipts=new WeakMap();
  if(typeof pollOriginal!=='function'||typeof validateNativeChain!=='function')throw Error('ORIGINAL_EXEC_ADAPTER_REQUIRED');
  return Object.freeze({
    async observe(expected,{stopAt,onPoll=()=>{}}={}) {
      while(now()<stopAt){
        const raw=await withinDeadline(()=>pollOriginal({session_id:expected.originalSessionId,chars:'',yield_time_ms:Math.min(1000,Math.max(1,stopAt-now())),max_output_tokens:10000}),stopAt,{now});
        await onPoll(raw);
        if(raw.session_id!==undefined){if(raw.session_id!==expected.originalSessionId)throw Error('ORIGINAL_EXEC_SESSION_CHANGED');continue;}
        if(!Number.isInteger(raw.exit_code))throw Error('ORIGINAL_EXEC_MISSING_REAL_TERMINAL');
        const native=await validateNativeChain(expected,raw);
        const value={...native,schemaVersion:1,originalSessionId:expected.originalSessionId,originalLaunchSha256:expected.originalLaunchSha256,bindingSha256:expected.bindingSha256,raw};
        verifyOriginalTerminal(expected,value);
        const token=Object.freeze({});receipts.set(token,{expected:structuredClone(expected),value});return token;
      }
      throw Error('ORIGINAL_MONITOR_BUDGET_EXHAUSTED');
    },
    accept(token,expected){const r=receipts.get(token);if(!r)throw Error('ORIGINAL_EXEC_REAL_POLL_TOKEN_REQUIRED');equal(expected,r.expected,'ORIGINAL_EXEC_TOKEN_IDENTITY');return structuredClone(r.value);}
  });
}
