/** Early routing/mode gates only. No identity stubs, disk bootstrap, SQL or network. */
import {afterEach,expect,it,vi} from 'vitest';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
import {writeReviewedJobProjectionSidecar} from '../vendor/c60-source/src/crawler/viatrisFixedJobProjectionSidecar.ts';
const selection={mode:'VIATRIS_OWNED_PIPE_CANDIDATE_V1' as const,launchChallenge:'a'.repeat(64)};
afterEach(()=>vi.unstubAllEnvs());
it.each(['Takeda','Biogen','Hengrui','Ucb'])('rejects simultaneous Viatris/%s selection before bootstrap, identity or publication',async name=>{
 await expect(runCloudPortableSourcePilot({ownedViatrisPipe:selection,['owned'+name+'Pipe']:{}} as never)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');
 await expect(runDbStartedCloudPublication({ownedViatrisPipe:{selection},['owned'+name+'Pipe']:{}} as never)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');
});
it('cannot use the Viatris owned route without the DB-started control path',async()=>{await expect(runCloudPortableSourcePilot({ownedViatrisPipe:selection} as never)).rejects.toThrow('PILOT_OWNED_VIATRIS_PIPE_SCOPE');});
it('sidecar refuses mixed TEST_ONLY/LIVE mode before binding or writing a file',async()=>{vi.stubEnv('JOBFINDER_FIXED_PROJECTION_MODE','TEST_ONLY');vi.stubEnv('JOBFINDER_OWNED_PIPE_MODE','LIVE');await expect(writeReviewedJobProjectionSidecar({} as never,'/no-write')).rejects.toThrow('FIXED_PROJECTION_MODE');});
it('the fork explicitly loads the original network-denial preload',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url),guard=require.resolve('../test/no-network.cjs');
 // Fail before invoking any transport when a runner forgets the mandatory guard.
 expect(process.execArgv).toContain('--require');expect(process.execArgv).toContain(guard);expect(require.cache[guard]).toBeDefined();
 for(const invoke of [()=>require('node:net').connect({host:'127.0.0.1',port:1}),()=>require('node:net').createConnection({host:'127.0.0.1',port:1}),()=>require('node:http').get('http://127.0.0.1:1'),()=>require('node:http').request('http://127.0.0.1:1'),()=>require('node:https').get('https://127.0.0.1:1'),()=>require('node:https').request('https://127.0.0.1:1'),()=>require('node:tls').connect({host:'127.0.0.1',port:1}),()=>globalThis.fetch('https://127.0.0.1:1')])expect(invoke).toThrow('OFFLINE_NETWORK_FORBIDDEN');
});
