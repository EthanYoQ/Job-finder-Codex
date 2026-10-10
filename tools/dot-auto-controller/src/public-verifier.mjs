import {equal,requireTime} from './gates.mjs';
import {sha,canonical} from './journal.mjs';
/** readAll must fetch every public job and full coverage via the actual reader.
 * No cached snapshot, screenshot/count-only pass, or write inference is allowed.
 */
export async function verifyCurrentPublic(expected,readAll,{now=Date.now,maxMs=45000}={}) {
  if(maxMs!==45000)throw Error('PUBLIC_WINDOW_CANNOT_EXPAND');
  const startedAt=now(),deadline=startedAt+maxMs,abort=new AbortController();let timer;
  try {
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('PUBLIC_CURRENT_45S_EXPIRED'));},maxMs);});
    const actual=await Promise.race([readAll({startedAt,deadline,signal:abort.signal,cache:'no-store'}),timeout]);
    const finishedAt=now();if(finishedAt>=deadline||finishedAt<startedAt)throw Error('PUBLIC_CURRENT_45S_EXPIRED');
    if(actual.mode!=='CURRENT'||actual.cache!=='no-store'||actual.complete!==true||actual.hasMore!==false)throw Error('PUBLIC_INCOMPLETE_OR_SNAPSHOT');
    if(requireTime(actual.observedAt,'PUBLIC_OBSERVED_TIME')<startedAt||requireTime(actual.observedAt,'PUBLIC_OBSERVED_TIME')>finishedAt)throw Error('PUBLIC_OLD_SNAPSHOT');
    equal(actual.deployedIdentity,expected.deployedIdentity,'PUBLIC_DEPLOYMENT_CHANGED');
    equal(actual.projection,expected.projection,'PUBLIC_ALL_FIELDS_MISMATCH');
    return {schemaVersion:1,mode:'CURRENT',startedAt,finishedAt,projectionSha256:sha(canonical(actual.projection)),deployedIdentity:actual.deployedIdentity};
  }finally{clearTimeout(timer);}
}
