import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/adapted-host-helper-functions.js',import.meta.url),'utf8');
const failure=new Function(source.slice(source.indexOf('function toolReviewRejected('),source.indexOf('async function sqlDispatch('))+'; return publicationFailure;')();
const raw={isError:true,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: This synthetic write was not approved.\nDo not bypass this rejection through a workaround or indirect execution.'}]};
const sql='synthetic atomic SQL';
assert.deepEqual(failure(raw,{kind:'PUBLISH'},sql),{status:'FAILED',outcome:'NOT_DISPATCHED',code:'TOOL_REVIEW_REJECTED'});
assert.deepEqual(failure(undefined,{kind:'PUBLISH'},sql),{status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'});
console.log('PASS observed explicit rejection NOT_DISPATCHED; transport exception UNKNOWN');
