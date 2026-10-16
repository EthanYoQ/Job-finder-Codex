/** Real entry guards; no runtime or build/admission mocks. */
import {it,expect} from 'vitest';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
import {FilePilotRelay} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
const ownedUcbPipe={mode:'UCB_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)};
it.each(['ownedTakedaPipe','ownedBiogenPipe','ownedHengruiPipe'])('both original entry points reject UCB plus %s before any disk read or request',async other=>{await expect(runCloudPortableSourcePilot({ownedUcbPipe,[other]:{}} as any)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');await expect(runDbStartedCloudPublication({ownedUcbPipe:{},[other]:{}} as any)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');});
it('UCB rejects absent DB-started control before bootstrap/network',async()=>{await expect(runCloudPortableSourcePilot({ownedUcbPipe} as any)).rejects.toThrow('PILOT_OWNED_UCB_PIPE_SCOPE');});
it.each([{mode:'HENGRUI_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)},{...ownedUcbPipe,approved:true},{...ownedUcbPipe,launchChallenge:'bad'}])('UCB relay rejects a forged selector before loading producer/gate %j',async selection=>{await expect(new FilePilotRelay('/never-created-ucb').prepareOwnedUcbPublish({} as any,selection as any)).rejects.toThrow();});
it('original absolute deadline guard rejects missing deadline before control read',async()=>{await expect(runDbStartedCloudPublication({ownedUcbPipe:{}} as any)).rejects.toThrow('PILOT_OUTER_DEADLINE_REQUIRED');});
