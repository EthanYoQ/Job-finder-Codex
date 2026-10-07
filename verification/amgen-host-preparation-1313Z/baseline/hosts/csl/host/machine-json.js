// Function body: (output, record). Only the exact inherited Node warning is ignored.
// The complete original output remains available to the caller for diagnostics.
if(typeof output!=='string'||typeof record!=='function')throw Error('HOST_MACHINE_JSON_ARGUMENT');
const lines=output.split('\n'),kept=[],warnings=[];
const warning=/^\(node:[1-9][0-9]*\) \[UNDICI-EHPA\] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time\.$/;
const trace='(Use `node --trace-warnings ...` to show where the warning was created)';
for(let i=0;i<lines.length;i++){
 if(warning.test(lines[i])){
  warnings.push(lines[i]);
  if(lines[i+1]===trace)warnings.push(lines[++i]);
 }else kept.push(lines[i]);
}
record({rawOutput:output,recognizedWarningLines:warnings});
return JSON.parse(kept.join('\n'));
