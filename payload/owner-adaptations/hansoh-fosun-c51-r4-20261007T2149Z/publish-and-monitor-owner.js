// functions.exec AsyncFunction factory body. Parameter: env.
// No shell/network implementation of SQL. Existing stages.h.sqlDispatch owns it.
const {tools, load, store, notify, text, Date: Clock = Date, setTimeout: schedule = setTimeout} = env;
const A = Object.getPrototypeOf(async function(){}).constructor;
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const fail = code => { throw Error(code); };
return async function publishAndMonitorOwner(input) {
  const {sourceKey, stages, monitorCode, request: suppliedRequest, sql, mode = 'publish'} = input;
  if (typeof sourceKey !== 'string' || sourceKey.length > 64 || sourceKey !== sourceKey.trim() || !/^(?:[a-z][a-z0-9]*|boehringer-ingelheim)$/.test(sourceKey) || !['publish','resume'].includes(mode)) fail('OWNER_ARGUMENT');
  const ns = 'proxyNode22:' + sourceKey + ':', h = stages?.h;
  if (!h || typeof stages.handle !== 'function' || typeof monitorCode !== 'string') fail('OWNER_DEPENDENCY');
  const r = clone(suppliedRequest), cfg = h.cfg;
  const sourceScope={"hansoh": {"sourceId": "source-hansoh-social", "sourceConfigSha256": "94d0982064af5a70386e017dec29cec1115c08480df2934e8d4cf0ddf644d740"}, "fosun": {"sourceId": "source-fosun-pharma-social", "sourceConfigSha256": "0227ec8d384900a48b2973f128908f7e9435d4bc991efd9a5b14ea5a3d1042b2"}};
  if (!sourceScope[sourceKey] || cfg.sourceId !== sourceScope[sourceKey].sourceId || cfg.sourceConfigSha256 !== sourceScope[sourceKey].sourceConfigSha256) fail('OWNER_SOURCE_SCOPE');
  const run = load(ns+'refreshCurrentRun'), batch = load(ns+'refreshCurrentBatch');
  const originalSessionId = load(ns+'refreshSession'), binding = load(ns+'registeredCandidateBinding');
  const review = load(ns+'publicationReview'), reviewedSource = review?.sourceResult;
  if (r?.kind !== 'PUBLISH' || typeof sql !== 'string' || sql !== r.payload?.sql || r.payload.projectId !== cfg.project ||
      !/^[a-f0-9]{64}$/.test(r.requestSha256) || !/^[a-zA-Z0-9._-]+$/.test(r.requestId) ||
      !Number.isSafeInteger(originalSessionId) || originalSessionId < 1 || typeof batch !== 'string' ||
      run !== cfg.root+'/'+batch || load(ns+'cloudPilotPublishDirectory') !== run+'/relay' ||
      !same(load(ns+'cloudPilotPublishRequest'), suppliedRequest)) fail('OWNER_ORIGINAL_REQUEST_BINDING');
  const expectedBuild={"schemaVersion": 2, "commitSha": "28402a299bb04cbf5873da66c2fe8ca76827c0d1", "sourceTreeSha256": "114011f4dedc6de630200fb12ab9a2177b91b575ff7843fbe3d7d36c9683ace6", "runtimeTreeSha256": "26beba5064ba95e0e916ee4e7d38c9e9a30b23d64ff7d50d9840e430c7ce893a", "contentSha256": "6651fbf50b53f2c5666135935300c3c479112d898beed9b354a057d4591a1d4d"};
  if (!binding?.build || Object.keys(binding.build).length !== Object.keys(expectedBuild).length || Object.entries(expectedBuild).some(([key,value])=>binding.build[key]!==value)) fail('OWNER_REVIEW_BINDING');
  if (binding?.status !== 'REGISTERED_VERIFIED' || binding.build?.commitSha !== '28402a299bb04cbf5873da66c2fe8ca76827c0d1' ||
      !Number.isSafeInteger(binding.candidate?.version) || binding.candidate.version !== 51 || binding.candidate.id !== 'dot-cloud-delta-proxy-28402a29-20261007' || binding.candidate.goalId !== 'jobfinder-portable-required-40' || review?.requestId !== r.requestId || review?.requestSha256 !== r.requestSha256 ||
      reviewedSource?.id !== batch+'--'+cfg.sourceId || reviewedSource.sourceId !== cfg.sourceId ||
      reviewedSource.sourceConfigHash !== cfg.sourceConfigSha256 || reviewedSource.releaseCandidateId !== binding.candidate.id ||
      !/^[a-f0-9]{64}$/.test(review.sqlSha256)) fail('OWNER_REVIEW_BINDING');
  // Immutable original authority snapshots. Awaited code must not silently
  // replace candidate, build, source/config, review or the original request.
  const frozenCfg=clone(cfg),frozenBinding=clone(binding),frozenReview=clone(review),frozenRequest=clone(suppliedRequest);
  // This exact, checked seam only replaces the monitor's dependency lookup.
  // It supplies the same single monitor loop; this owner adds no polling loop.
  const seam = 'const A=Object.getPrototypeOf(async function(){}).constructor;\nconst s=await new A(load("'+ns+'cloudPilotHostStages"))();';
  if (monitorCode.split(seam).length !== 2) fail('OWNER_MONITOR_SEAM');
  const scopedMonitorCode = monitorCode.replace(seam, 'const s=ownerStages;');
  const monitorLease = load(ns+'durableMonitorLease:'+run);
  if (monitorLease?.active) fail('OWNER_MONITOR_ALREADY_ACTIVE');
  if (monitorLease && Clock.now() >= monitorLease.stopAt) fail('OWNER_MONITOR_ORIGINAL_BUDGET_EXHAUSTED');
  const key = ns+'publishMonitorOwner:'+r.requestId;
  const identity = {sourceKey, sourceId:cfg.sourceId, batch, run, originalSessionId, requestId:r.requestId,
    requestSha256:r.requestSha256, sqlSha256:review.sqlSha256, dispatchBefore:r.payload.dispatchBefore, expiresAt:r.expiresAt};
  let state = load(key);
  if (mode === 'publish') {
    if (state) fail('OWNER_ALREADY_CLAIMED_NO_PUBLISH_RETRY');
    const expiry = Clock.parse(r.expiresAt), cutoff = Clock.parse(r.payload.dispatchBefore ?? r.expiresAt);
    if (r.expired || r.dispatchRecorded || !Number.isFinite(expiry) || !Number.isFinite(cutoff) ||
        Clock.now() >= expiry || Clock.now() >= cutoff) fail('OWNER_STALE_OR_UNCERTAIN_NO_SUBMIT');
    // Same-store reentry guard only; not an atomic cross-isolate/process lock.
    // The existing host dispatch marker and formal DB atomic lock remain the
    // authorities. This owner is still the single designated publisher.
    state = {schemaVersion:1, identity, active:true, invocation:1, phase:'DISPATCHING',
      outcome:'UNKNOWN', noWriteEstablished:false, retryAuthorized:false, dispatchAttempted:true};
  } else {
    if (!state || !same(state.identity,identity) || state.active || state.retryAuthorized !== false ||
        state.dispatchAttempted !== true) fail('OWNER_RESUME_BINDING_OR_ACTIVE');
    if (state.phase === 'TERMINATED_VALIDATED') return clone(state.result);
    if (state.result?.continuation?.mode === 'reconcile-retained-terminal') fail('OWNER_TERMINAL_REQUIRES_RECONCILIATION');
    state = {...state, active:true, invocation:state.invocation+1, phase:'MONITORING'};
  }
  store(key, clone(state));
  const assertScope = () => {
    if (load(ns+'refreshCurrentRun') !== run || load(ns+'refreshCurrentBatch') !== batch ||
        load(ns+'refreshSession') !== originalSessionId) fail('OWNER_ACTIVE_SCOPE_CHANGED');
    if (!same(h.cfg,frozenCfg)||!same(load(ns+'cloudPilotHostConfig'),frozenCfg)||
        !same(load(ns+'registeredCandidateBinding'),frozenBinding)||
        !same(load(ns+'publicationReview'),frozenReview)||
        !same(load(ns+'cloudPilotPublishRequest'),frozenRequest)||
        load(ns+'cloudPilotPublishDirectory')!==run+'/relay') fail('OWNER_ACTIVE_BINDING_CHANGED');
  };
  const frozenLoads = new Map([[ns+'refreshCurrentRun',run],[ns+'refreshCurrentBatch',batch],[ns+'refreshSession',originalSessionId]]);
  const scopedLoad = name => frozenLoads.has(name) ? frozenLoads.get(name) : load(name);
  let rawPoll, validatedSummary, monitorResult, monitorError, dispatchError, checkedBudget;
  const finalSqlGuardFor = req => {
    const frozenRelayRequest=clone(req);
    const expiry=Clock.parse(req.expiresAt),cutoff=Clock.parse(req.payload?.dispatchBefore??req.expiresAt);
    return ()=>{
      assertScope();
      if(!same(req,frozenRelayRequest))fail("OWNER_RELAY_REQUEST_CHANGED");
      if(!checkedBudget?.budget||Clock.now()>=checkedBudget.budget.stopAt)fail("OWNER_MONITOR_ORIGINAL_BUDGET_EXHAUSTED");
      if(!Number.isFinite(expiry)||!Number.isFinite(cutoff)||Clock.now()>=expiry||Clock.now()>=cutoff)fail("OWNER_STALE_OR_UNCERTAIN_NO_SUBMIT");
      return true;
    };
  };
  const scopedStore = (name,value) => {
    if (name === ns+'lastPortableExecPollRaw') rawPoll = clone(value);
    if (name === ns+'lastPortableExecPoll' && value?.exit_code !== undefined && value?.session_id === undefined &&
        !value?.classification && value?.originalSessionId === originalSessionId) {
      assertScope();
      // The monitor has already compared exit_code against the durable wrapper.
      // Delay accepted state until the *full actual raw* is persisted and reread.
      validatedSummary = clone(value);
      return;
    }
    store(name,value);
  };
  const ownerStages = {
    ...stages,
    monitorOwnerIdentity: identity,
    assertOwnerScope: assertScope,
    monitorInvocationMode: mode === 'publish' ? 'start' : 'resume',
    h: {...h, next: async dir => {
      assertScope();
      if (dir !== run+'/relay') fail('OWNER_RELAY_SCOPE');
      const req = await h.next(dir);
      assertScope();
      if (req?.kind === 'PUBLISH') {
        if (req.requestId !== r.requestId || req.requestSha256 !== r.requestSha256 ||
            req.payload?.sql !== sql || req.expiresAt !== r.expiresAt ||
            req.payload?.dispatchBefore !== r.payload.dispatchBefore || req.dispatchRecorded !== true) {
          fail('OWNER_PENDING_PUBLICATION_MISMATCH');
        }
        // Never stage or dispatch PUBLISH again. On review hold, original next()
        // alone settles UNKNOWN at original expiry; without a hold it retains
        // DISPATCH_UNCERTAIN. No owner-created response, deadline, or marker.
        return undefined;
      }
      return req;
    }},
    handle: async (req,dir) => {
      assertScope();
      if (dir !== run+'/relay' || req.kind === 'PUBLISH') fail('OWNER_NO_PUBLISH_REPLAY');
      const ownedRequest=clone(req);
      const result=await stages.handle(ownedRequest,dir,finalSqlGuardFor(ownedRequest));
      assertScope();
      return result;
    }
  };
  const scopedTools = {...tools, write_stdin: async args => {
    assertScope();
    if (args.session_id !== originalSessionId || args.chars !== '') fail('OWNER_ORIGINAL_SESSION_ONLY');
    return tools.write_stdin(args);
  }};
  try {
    // Read the original durable launch budget before the only SQL dispatch.
    // Reuse the monitor's validator; this preflight has no relay/poll loop.
    await new A('ownerStages','load','store','tools','notify','text','Date','setTimeout',scopedMonitorCode)(
      {...ownerStages,monitorBudgetCheckOnly:true},scopedLoad,scopedStore,scopedTools,notify,
      value=>{checkedBudget=clone(value);},Clock,schedule);
    if (checkedBudget?.status !== 'MONITOR_BUDGET_VERIFIED') {
      monitorResult=checkedBudget;
      fail('OWNER_ORIGINAL_BUDGET_UNVERIFIED_NO_PUBLISH');
    }
    ownerStages.expectedMonitorBudget=checkedBudget.budget;
    if (Clock.now() >= checkedBudget.budget.stopAt) fail('OWNER_MONITOR_ORIGINAL_BUDGET_EXHAUSTED');
    // Recheck the live owner scope after the awaited budget read, before dispatch.
    assertScope();
    if (mode === 'publish') {
      try {
        state.publicationResult = clone(await h.sqlDispatch(r,run+'/relay',sql,finalSqlGuardFor(r)));
      } catch (error) {
        dispatchError = String(error);
        state.dispatchError = dispatchError;
        // h.sqlDispatch may have marked or sent already. Do not infer rollback,
        // zero writes, or retry permission from an exception.
        state.publicationResult = {status:'UNKNOWN',outcome:'UNKNOWN'};
      }
    }
    const dispatchBoundary=load(ns+'sqlDispatchBoundary:'+r.requestId);
    if(dispatchBoundary)state.dispatchBoundary=clone(dispatchBoundary);
    state.phase = 'MONITORING';
    state.outcome = state.publicationResult?.outcome ?? 'UNKNOWN';
    store(key,clone(state));
    // There is no asynchronous gap or return between dispatch and this await.
    // notify does not await user messages/reports; a yielded cell remains alive.
    notify({phase:'PUBLISH_MONITOR_ATTACHED',...identity,publicationStatus:state.publicationResult?.status,
      retryAuthorized:false,noWriteEstablished:false});
    await new A('ownerStages','load','store','tools','notify','text','Date','setTimeout',scopedMonitorCode)(
      ownerStages,scopedLoad,scopedStore,scopedTools,notify,value=>{monitorResult=clone(value);},Clock,schedule);
  } catch (error) {
    monitorError = String(error);
  }
  let evidencePath = rawPoll?.evidencePath ?? monitorResult?.evidencePath ?? null;
  let evidenceError = monitorResult?.evidenceError ?? null;
  const actualRawTerminal = rawPoll?.originalSessionId === originalSessionId &&
    rawPoll.raw?.exit_code !== undefined && rawPoll.raw?.session_id === undefined;
  if (actualRawTerminal && rawPoll.evidenceVerified === true) {
    evidencePath = run+'/owner-relay-evidence/'+r.requestId+'/invocation-'+state.invocation+'-original-exec-tool-terminal.json';
    try {
      const complete = {...rawPoll,ownerIdentity:identity,invocation:state.invocation};
      const serialized = JSON.stringify(complete);
      await h.save(evidencePath, complete);
      const savedText = (await h.readFile(evidencePath)).text;
      // apply_patch Add File writes one final LF. Accept that exact transport
      // form, or exact JSON bytes; never trim arbitrary whitespace/content.
      if (savedText !== serialized && savedText !== serialized+'\n') fail('OWNER_TERMINAL_EVIDENCE_READBACK');
    } catch (error) { evidenceError = String(error); }
  }
  // Final acceptance follows awaited evidence persistence/readback, too.
  try{assertScope();}catch(error){monitorError=String(error);}
  const valid = !monitorError && !evidenceError && rawPoll?.evidenceVerified === true && actualRawTerminal && Number.isInteger(rawPoll.raw.exit_code) &&
    validatedSummary?.originalSessionId === originalSessionId && validatedSummary.exit_code === rawPoll.raw.exit_code &&
    monitorResult?.status === 'PROCESS_TERMINATED' && monitorResult.originalExec?.state === 'TERMINATED' &&
    monitorResult.originalExec?.sessionId === originalSessionId && monitorResult.originalExec.exitCode === rawPoll.raw.exit_code &&
    same(monitorResult.terminalToolPoll,rawPoll.raw) && monitorResult.levels?.wrapper?.record?.wrapperExitCode === rawPoll.raw.exit_code;
  let result;
  if (valid) {
    const accepted = {...validatedSummary,raw:rawPoll.raw,validated:true,evidencePath,identity};
    store(ns+'lastPortableExecPoll',accepted);
    store(ns+'lastPortableExecTerminalAccepted',accepted);
    result = {status:'PROCESS_TERMINATED',originalExec:monitorResult.originalExec,evidencePath,
      publicationResult:state.publicationResult,dispatchBoundary:state.dispatchBoundary??null,dispatchError:dispatchError??state.dispatchError??null,
      publicationReconciled:false,successfulCompletionEligible:rawPoll.raw.exit_code===0,
      noWriteEstablished:false,retryAuthorized:false};
    state.phase = 'TERMINATED_VALIDATED';
  } else {
    result = {status:state.publicationResult?.status==='AWAITING_OWNER_RECONCILIATION'
      ? 'AWAITING_OWNER_RECONCILIATION' : 'ORIGINAL_EXEC_UNKNOWN',
      originalSessionId,evidencePath,evidenceError,monitorError,monitorResult:monitorResult??null,
      publicationResult:state.publicationResult,dispatchBoundary:state.dispatchBoundary??null,dispatchError:dispatchError??state.dispatchError??null,
      outcome:'UNKNOWN',noWriteEstablished:false,retryAuthorized:false,
      continuation:{mode:actualRawTerminal?'reconcile-retained-terminal':'resume',sourceKey,requestId:r.requestId,requestSha256:r.requestSha256,originalSessionId}};
    state.phase = 'UNRESOLVED';
  }
  state.active = false;
  state.result = result;
  store(key,clone(state));
  text(result);
  return result;
};
