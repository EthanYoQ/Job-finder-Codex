// @vitest-environment node
// Artificial fixture only. No network, production database, or captured real pages.
import {expect,it} from 'vitest';
import {certificateFixture,nativeId} from '../helpers/sanofiHeaderFixture';
import {sanofiHash} from '../../src/crawler/sanofiChineseNative';
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,SANOFI_INDEPENDENT_ORIGINAL_LOCATOR} from '../../src/crawler/traversalCertificate';

it('rejects changed internal records when their official sourcePid disagrees',async()=>{
  const fixture=await certificateFixture(),input=structuredClone(fixture.input),pages=structuredClone(fixture.captured.pages);
  const native=pages[0]!.rawRows[1]!.rawPayload.nativeResponse as {body:string;bodySha256:string};
  native.body=native.body.replaceAll(nativeId(2),'f'.repeat(24))+'<input id="sourcePid" value="222">';
  native.bodySha256=sanofiHash(native.body);
  const main=input.evidence.artifacts.find(a=>a.logicalKey==='sanofi-cn-tupu-R9000002')!;
  main.body=String(main.body)+'<input id="sourcePid" value="111">';
  const validation=createOfficialJsonRenderedTraversalValidation({...fixture.validationInput,pages});
  const oracle=input.evidence.artifacts.find(a=>a.logicalKey==='sanofi-cn-module-anomalies-v2')!;
  oracle.body=JSON.stringify({...JSON.parse(String(oracle.body)),independentArtifactSha256:validation.artifactSha256});
  const tuple={...input.binding,sourceId:input.plan.source.id};
  const artifacts=input.evidence.artifacts.map(a=>({...tuple,kind:a.kind,extractorLocator:a.extractorLocator,sha256:sanofiHash(String(a.body)),byteCount:Buffer.byteLength(String(a.body)),capturedAt:a.capturedAt}));
  const raw=JSON.stringify(validation),independentOriginal={sha256:sanofiHash(raw),byteCount:Buffer.byteLength(raw),canonicalArtifactSha256:validation.artifactSha256};
  artifacts.push({...tuple,kind:'COMMAND_OUTPUT',extractorLocator:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,sha256:independentOriginal.sha256,byteCount:independentOriginal.byteCount,capturedAt:input.now.toISOString()});
  expect(issueBGradeTraversalCertificate({...input,independentValidation:validation,sanofiArchive:{artifacts,independentOriginal}})).toMatchObject({status:'REJECTED',blockerCodes:['INDEPENDENT_JOB_SET_MISMATCH']});
});
