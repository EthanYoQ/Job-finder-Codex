/** Test process boundary only: deny live sockets, then install synthetic HTTP. */
import fs from 'node:fs';
import {createUcbPhenomSynthetic} from '../test/fixtures/ucb-phenom-synthetic.mts';
const file=process.env.JOBFINDER_UCB_SYNTHETIC_INPUT;
if(!file||process.env.JOBFINDER_OWNED_PIPE_MODE!=='TEST_ONLY')throw Error('SYNTHETIC_COMMAND_ONLY');
const input=JSON.parse(fs.readFileSync(file,'utf8'));
if(input.kind!=='SYNTHETIC_EXTERNAL_HTTP_ONLY')throw Error('SYNTHETIC_COMMAND_INPUT');
const http=createUcbPhenomSynthetic(input.options);
globalThis.fetch=http.fetch;
process.on('exit',()=>fs.writeFileSync(input.httpLog,JSON.stringify({kind:'SYNTHETIC_EXTERNAL_HTTP_ONLY',requests:http.requests,realNetworkCalls:0}),{flag:'wx',mode:0o600}));
