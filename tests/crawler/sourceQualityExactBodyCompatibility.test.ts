import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {sourceQualityPageBodiesMatchFingerprints} from '../../src/crawler/sourceQualityAdmission';
import type {PersistentSourceFetchEvidence} from '../../src/crawler/sourceFetchEvidence';
function evidence(){const body='{"public":"official job body"}';return {artifacts:[{logicalKey:'page1',body}],pages:[{artifactLogicalKey:'page1',responseFingerprintSha256:createHash('sha256').update(body).digest('hex')}]} as PersistentSourceFetchEvidence;}
describe('exact retained-body representation compatibility',()=>{
 it('accepts historical absent marker only with physical byte equality',()=>{const e=evidence();expect(sourceQualityPageBodiesMatchFingerprints(e)).toBe(true);e.artifacts[0]!.body+=' ';expect(sourceQualityPageBodiesMatchFingerprints(e)).toBe(false)});
 it('accepts explicit EXACT with the same physical check',()=>{const e=evidence();e.artifacts[0]!.bodyRepresentation='EXACT';expect(sourceQualityPageBodiesMatchFingerprints(e)).toBe(true);e.pages[0]!.responseFingerprintSha256='f'.repeat(64);expect(sourceQualityPageBodiesMatchFingerprints(e)).toBe(false)});
 it.each(['REDACTED','unmarked-raw-hash','unmarked-descriptors','exact-with-raw-hash','duplicate','missing'])("rejects %s ambiguity",kind=>{const e=evidence();const a=e.artifacts[0]!;
  if(kind==='REDACTED')a.bodyRepresentation='REDACTED';
  if(kind==='unmarked-raw-hash'||kind==='exact-with-raw-hash')a.rawBodySha256='a'.repeat(64);
  if(kind==='exact-with-raw-hash')a.bodyRepresentation='EXACT';
  if(kind==='unmarked-descriptors')a.redactionDescriptors=[];
  if(kind==='duplicate')e.artifacts.push({...a});if(kind==='missing')e.artifacts=[];
  expect(sourceQualityPageBodiesMatchFingerprints(e)).toBe(false);
 });
});
