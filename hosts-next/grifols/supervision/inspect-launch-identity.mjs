// Read-only prelaunch normalization and per-run control-label derivation.
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const [batch] = process.argv.slice(2);
if(typeof batch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch)) throw Error('BATCH_ID');
console.log(JSON.stringify({nodePath:process.execPath,nodeRealPath:realpathSync(process.execPath),cwd:process.cwd(),cwdRealPath:realpathSync(process.cwd()),wrapperPath:resolve('scripts/run-with-http-diagnostics.mjs'),wrapperRealPath:realpathSync('scripts/run-with-http-diagnostics.mjs'),controlRunId:'jb-'+createHash('sha256').update(batch,'utf8').digest('hex')}));
