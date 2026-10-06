import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [capturePath,validationPath,...extra]=process.argv.slice(2);
if(!capturePath||!validationPath||extra.length)throw Error('Usage: describe-inputs.mjs <reviewed-worker-capture.json> <independent-validation.json>');
async function descriptor(p){p=resolve(p);if(!(await lstat(p)).isFile())throw Error('REGULAR_INPUT_REQUIRED');const b=await readFile(p);return {path:p,sha256:createHash('sha256').update(b).digest('hex')};}
console.log(JSON.stringify({currentCapture:await descriptor(capturePath),independentValidation:await descriptor(validationPath)},null,2));
