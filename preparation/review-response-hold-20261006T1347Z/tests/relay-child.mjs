// Synthetic child. Import the unchanged production file relay, but no runner,
// compiler, lease owner, network connector, live control, or live SQL.
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const [sourcePath, directory, durationText] = process.argv.slice(2);
const { FilePilotRelay, PilotSqlFailure } = await import(pathToFileURL(sourcePath));
const relay = new FilePilotRelay(directory);
const duration = Number(durationText);
const deadline = Date.now() + duration;
const payload = {projectId:'synthetic_project',sql:'SYNTHETIC PUBLICATION ONLY',dispatchBefore:new Date(deadline-100).toISOString()};
const emit = (event, details={}) => process.stdout.write(JSON.stringify({event,at:Date.now(),...details})+'\n');
emit('START', {deadline});
try {
  await relay.request('PUBLISH', payload, deadline, value => {
    if(value.status==='FAILED')throw new PilotSqlFailure(value.outcome,value.code);
    if(value.status!=='SUCCEEDED'||!Array.isArray(value.rows))throw Error('SYNTHETIC_BAD_RESULT');
    return value.rows;
  });
  emit('ACKNOWLEDGED');
} catch(error) {
  emit('FAILED', {message:error.message});
  // Exact settlement condition from the unchanged DB-started runner.
  if(!(error instanceof PilotSqlFailure&&error.outcome!=='UNKNOWN')&&Date.now()<deadline)await delay(deadline-Date.now());
}
emit('READ_OUTCOME');
const outcomeDeadline=Date.now()+5000;
await relay.request('READ_OUTCOME',{projectId:'synthetic_project',sql:'SELECT synthetic_outcome',dispatchBefore:new Date(outcomeDeadline-100).toISOString()},outcomeDeadline,value=>value);
emit('DONE');
