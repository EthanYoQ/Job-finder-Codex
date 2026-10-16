import {describe,expect,it} from 'vitest';
import {describePortableRuntimeError} from '../../src/crawler/portableRuntimeDiagnostics';
describe('closed portable runtime diagnostics',()=>{
 it('reports nested driver codes without messages, URL, stack, metadata or arbitrary error names',()=>{
  const driver=Object.assign(new Error('postgresql://user:password@host/db'),{name:'PrismaClientKnownRequestError',code:'P2028',meta:{password:'hidden'}});
  const lease=Object.assign(new Error('CRAWL_LEASE_LOST',{cause:driver}),{name:'PortableCrawlLeaseError',code:'CRAWL_LEASE_LOST'});
  const result=describePortableRuntimeError(new AggregateError([lease,new Error('secret')],'private database message'));
  expect(result).toEqual({type:'AggregateError',errors:[{type:'PortableCrawlLeaseError',code:'CRAWL_LEASE_LOST',reason:'CRAWL_LEASE_LOST',cause:{type:'PrismaClientKnownRequestError',code:'P2028'}},{type:'Error'}]});
  expect(JSON.stringify(result)).not.toMatch(/secret|password|postgresql|private|hidden/);
 });
 it('does not copy arbitrary code/name fields or thrown objects',()=>{
  expect(describePortableRuntimeError(Object.assign(new Error('private'),{name:'private',code:'PASSWORD'}))).toEqual({type:'Other'});
  expect(describePortableRuntimeError({name:'Error',password:'private'})).toEqual({type:'Unknown'});
 });
 it('bounds cycles, depth and child counts',()=>{
  const cyclic=new Error('private');cyclic.cause=cyclic;
  expect(describePortableRuntimeError(cyclic)).toEqual({type:'Error',cause:{type:'Other',truncated:true}});
  const aggregate=describePortableRuntimeError(new AggregateError(Array.from({length:20},()=>new Error('x'))));
  expect(aggregate.errors).toHaveLength(6);expect(aggregate.truncated).toBe(true);
 });
});
