import {describe,it,expect,vi} from 'vitest';
import {createPortableFencedRuntimeDatabase} from '../../src/db/portableRuntimeDatabase';
import {acquirePortableCrawlLease} from '../../src/crawler/portableCrawlLease';
async function setup(){
 let holder='';const events:string[]=[];
 const lease=await acquirePortableCrawlLease({$transaction:async work=>work({$queryRawUnsafe:async <T>(_sql:string,...v:unknown[])=>{holder=String(v[1]);return [{holderId:holder}] as T;}})});
 const tx={$queryRawUnsafe:vi.fn(async(sql:string)=>{events.push(sql.startsWith('SELECT')?'LOCK':'FENCE');return sql.startsWith('SELECT')?[{id:'formal-crawl'}]:[{holderId:holder}];}),crawlBatch:{update:vi.fn(async(args:unknown)=>{events.push('UPDATE');return args;})}};
 const db={$transaction:vi.fn(async(work:(t:typeof tx)=>Promise<unknown>,_options?:unknown)=>work(tx)),crawlBatch:{update:vi.fn(),findMany:vi.fn(function(this:unknown){return this;})}};
 return {db,tx,lease,events,fenced:createPortableFencedRuntimeDatabase(db,lease)};
}
describe('portable runtime write seams',()=>{
 it('fences planning, source success and failure transactions before callback writes',async()=>{const f=await setup();await f.fenced.$transaction(async()=>{f.events.push('WRITE')});expect(f.events).toEqual(['LOCK','FENCE','WRITE']);expect(f.db.$transaction.mock.calls[0]![1]).toEqual({maxWait:10000,timeout:120000});});
 it('runs final success mutation inside a fenced transaction',async()=>{const f=await setup();await f.fenced.crawlBatch.update({status:'SUCCESS'} as never);expect(f.events).toEqual(['LOCK','FENCE','UPDATE']);expect(f.db.crawlBatch.update).not.toHaveBeenCalled();});
 it('snapshots finalization arguments before waiting for ownership',async()=>{const f=await setup();const args={status:'PARTIAL'};const pending=f.fenced.crawlBatch.update(args as never);args.status='SUCCESS';expect(await pending).toEqual({status:'PARTIAL'});});
 it('rejects a lost holder before any callback write',async()=>{const f=await setup();f.tx.$queryRawUnsafe.mockResolvedValue([]);const write=vi.fn();await expect(f.fenced.$transaction(write)).rejects.toThrow(/LEASE_LOST/);expect(write).not.toHaveBeenCalled();});
 it('preserves read receivers and rejects noninteractive operations',async()=>{const f=await setup();expect(f.fenced.crawlBatch.findMany()).toBe(f.db.crawlBatch);expect(()=>f.fenced.$transaction([] as never)).toThrow(/INTERACTIVE/);});
});
