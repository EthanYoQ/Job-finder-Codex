// Observer wrapper only. Does not navigate, mutate page state, or emit a formal capture.
var jnjRunReadinessAttempt = async function(helpers, tab, page, expectedTotal, timeoutMs) {
  const attemptStartedAt = new Date().toISOString();
  try {
    const result = await helpers.waitForListReadiness(tab, page, expectedTotal, timeoutMs);
    nodeRepl.write(JSON.stringify({kind:'NONQUALIFYING_REAL_READINESS_HELPER_RESULT',qualifyingCapture:false,attemptStartedAt,finishedAt:new Date().toISOString(),ok:true,result}));
    return {ok:true,result};
  } catch (error) {
    const diagnostic = {kind:'NONQUALIFYING_REAL_READINESS_HELPER_FAILURE',qualifyingCapture:false,attemptStartedAt,finishedAt:new Date().toISOString(),ok:false,error:{name:error?.name??'Error',message:String(error?.message??error),nonqualifyingState:error?.nonqualifyingState??null}};
    nodeRepl.write(JSON.stringify(diagnostic));
    return {ok:false,diagnostic};
  }
};
// The caller MUST branch on ok. Only an ok result permits a formal complete list read.
// A false result ends that attempt after preserving the diagnostic; no navigation or retry.
