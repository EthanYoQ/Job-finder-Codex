// @vitest-environment node
import {beforeAll,describe,expect,it,vi} from "vitest";
import {certificateFixture,LATER,jd,row,nativeId} from "../helpers/sanofiHeaderFixture";
import {sanofiHash} from "../../src/crawler/sanofiChineseNative";
import {replaySanofiChineseIndependent} from "../../src/crawler/sanofiChineseRenderedTraversal";
import {canonicalStringSetSha256} from "../../src/crawler/sourceFetchEvidence";
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt} from "../../src/crawler/traversalCertificate";
import {bindSanofiPersistedArtifacts,type PortableSourceResultRow,type PortableSnapshotTransactionDb} from "../../src/db/portablePublicSnapshotRepository";

const canonical=(v:unknown):string=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.entries(v).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
let fixture:Awaited<ReturnType<typeof certificateFixture>>;
beforeAll(async()=>{fixture=await certificateFixture();expect(fixture.issued.status).toBe("CERTIFIED");});
function reader(){
  const {issued,p,input,result,captured}=fixture;if(issued.status!=="CERTIFIED")throw Error("Expected test certificate");
  return {certificate:structuredClone(issued.certificate) as any,certificateSha256:issued.certificateSha256,now:new Date(LATER),expected:{...input.binding,sourceId:p.source.id,
    canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(replaySanofiChineseIndependent(captured.pages).rawEvidenceIds),
    sanofiArtifacts:result.fetchEvidence!.artifacts.map(a=>({...input.binding,sourceId:p.source.id,kind:a.kind,extractorLocator:a.extractorLocator,sha256:sanofiHash(String(a.body))}))}};
}
function rehash(input:ReturnType<typeof reader>){input.certificateSha256=sanofiHash(canonical(input.certificate));return input;}

describe("Sanofi complete per-job identity proof and persisted reader anchors",()=>{
  it("accepts the audited header fallback with independently read original artifact hashes",()=>{
    expect(verifyBGradeTraversalCertificateReceipt(reader())).toMatchObject({status:"PASS",finalUniqueJobCount:2});
  });
  it.each(["title","fullJD","nativeId","cities"])("issuer rejects independently coherent %s drift with unchanged ID sets",kind=>{
    const pages=structuredClone(fixture.captured.pages) as any;
    for(const page of pages)for(const r of page.rawRows){
      const v=r.rawPayload;
      if(kind==="title"){
        v.domPage.searchResultsHtml=v.domPage.searchResultsHtml.replaceAll(row().title,"另一完整岗位");
        if(v.domRow.id==="101")v.domRow.title="另一完整岗位";
        v.detailResponse.body=v.detailResponse.body.replaceAll(row().title,"另一完整岗位");
        v.nativeResponse.body=v.nativeResponse.body.replaceAll(row().title,"另一完整岗位");
      }else if(r.rawPayload.domRow.id==="101"){
        if(kind==="fullJD"){
          // The extra content sits beyond a prefix comparison's first 180 characters.
          const changed=jd()+"同".repeat(220)+"完整末段改变";
          v.detailResponse.body=v.detailResponse.body.replaceAll(jd(),changed);
          v.nativeResponse.body=v.nativeResponse.body.replaceAll(jd(),changed);
        }
        if(kind==="nativeId")v.nativeResponse.body=v.nativeResponse.body.replaceAll(nativeId(),"f".repeat(24));
        if(kind==="cities")v.nativeResponse.body=v.nativeResponse.body.replace("北京","天津");
      }
      v.detailResponse.bodySha256=sanofiHash(v.detailResponse.body);v.nativeResponse.bodySha256=sanofiHash(v.nativeResponse.body);
    }
    const independentValidation=createOfficialJsonRenderedTraversalValidation({...fixture.validationInput,pages});
    expect(issueBGradeTraversalCertificate({...fixture.input,independentValidation})).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])});
  });
  it.each(["title","fullJD","nativeId","cities","req","nativeJD"])("reader rejects changed proof %s even after certificate rehash",kind=>{
    const input=reader(),proof=input.certificate.mainTraversal.sanofiIdentityProof,oracle=JSON.parse(proof.oracleBody),d=oracle.decisions[0];
    if(kind==="title")d.title="另一完整岗位";
    if(kind==="fullJD")d.descriptionSha256="a".repeat(64);
    if(kind==="nativeId")d.nativePositionId="f".repeat(24);
    if(kind==="cities")d.nativeCities=["天津"];
    if(kind==="req")d.reqId="R9999999";
    if(kind==="nativeJD")d.nativeDescriptionSha256="b".repeat(64);
    proof.oracleBody=JSON.stringify(oracle);
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_INDEPENDENT_IDENTITY_MISMATCH");
  });
  it.each(["foreignTitle","foreignReq","foreignId","foreignApplyUrl","foreignDescriptionSha256"])("reader binds the actual foreign job's %s",field=>{
    const input=reader(),proof=input.certificate.mainTraversal.sanofiIdentityProof,oracle=JSON.parse(proof.oracleBody);
    oracle.entries[0][field]=field.includes("Sha256")?"a".repeat(64):field.includes("Url")?"https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999":"wrong";
    proof.oracleBody=JSON.stringify(oracle);
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_FOREIGN_HEADER_INDEPENDENT_MISMATCH");
  });
  it.each(["missingScript","wrongScript","missingVisibleTitle","wrongVisibleTitle","missingRedirect"])("fallback reader rejects independently weak %s while ordinary strict replay remains valid",kind=>{
    const input=reader(),pages=input.certificate.independentValidation.pages,payload=pages[0].rawRows[0].rawPayload,native=payload.nativeResponse;
    if(kind==="missingScript")native.body=native.body.replace(/<script>[^<]*<\/script>/u,"");
    if(kind==="wrongScript")native.body=native.body.replace(`var prevPositionId = "${nativeId()}"`,`var prevPositionId = "${nativeId(2)}"`);
    if(kind==="missingVisibleTitle")native.body=native.body.replace(/<h4 class="name">[^<]*<\/h4>/u,"");
    if(kind==="wrongVisibleTitle")native.body=native.body.replace(`<h4 class="name">${row().title}</h4>`,`<h4 class="name">${row(2).title}</h4>`);
    if(kind==="missingRedirect")delete native.redirect;
    native.bodySha256=sanofiHash(native.body);
    input.certificate.independentValidation=createOfficialJsonRenderedTraversalValidation({...fixture.validationInput,pages});
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow(/SANOFI_CN_FOREIGN_HEADER_(?:INDEPENDENT_NATIVE_)?UNPROVEN/u);
    expect(issueBGradeTraversalCertificate({...fixture.input,independentValidation:input.certificate.independentValidation})).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])});
  });
  it("fallback reader rejects the ordinary parser's native title alias",()=>{
    const input=reader(),pages=input.certificate.independentValidation.pages,alias="DBU Regional Manager HZ";
    for(const r of pages[0].rawRows){const v=r.rawPayload;
      v.domPage.searchResultsHtml=v.domPage.searchResultsHtml.replaceAll(row().title,alias);
      if(v.domRow.id!=="101")continue;
      v.domRow.title=alias;v.detailResponse.body=v.detailResponse.body.replaceAll(row().title,alias);
      v.detailResponse.bodySha256=sanofiHash(v.detailResponse.body);
      v.nativeResponse.body=v.nativeResponse.body.replaceAll(row().title,"Regional Manager");
      v.nativeResponse.bodySha256=sanofiHash(v.nativeResponse.body);
    }
    input.certificate.independentValidation=createOfficialJsonRenderedTraversalValidation({...fixture.validationInput,pages});
    const proof=input.certificate.mainTraversal.sanofiIdentityProof,oracle=JSON.parse(proof.oracleBody);
    oracle.decisions[0].title=alias;oracle.entries[0].title=alias;proof.oracleBody=JSON.stringify(oracle);
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_NATIVE_CHAIN_INVALID");
  });
  it("rejects rewritten independent native bytes after every inline hash is recomputed",()=>{
    const input=reader(),pages=input.certificate.independentValidation.pages,native=pages[0].rawRows[0].rawPayload.nativeResponse;
    native.body=native.body.replace(/<script>[^<]*<\/script>/u,"")+`<script>var prevPositionId = "${nativeId()}"; /* fabricated replacement */</script>`;
    native.bodySha256=sanofiHash(native.body);
    input.certificate.independentValidation=createOfficialJsonRenderedTraversalValidation({...fixture.validationInput,pages});
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_INDEPENDENT_ARTIFACT_MISMATCH");
    const proof=input.certificate.mainTraversal.sanofiIdentityProof,oracle=JSON.parse(proof.oracleBody);
    oracle.independentArtifactSha256=input.certificate.independentValidation.artifactSha256;proof.oracleBody=JSON.stringify(oracle);
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENT_MISMATCH");
  });
  it.each(["absent","oracleHash","oracleTuple","detailHash","detailTuple","duplicateOracle"])("reader rejects %s persisted commitments",kind=>{
    const input=reader(),artifacts=input.expected.sanofiArtifacts,oracle=artifacts.find(a=>a.kind==="ORACLE_RESULT"&&a.extractorLocator==="sanofi-cn-module-anomalies-v2")!,detail=artifacts.find(a=>a.extractorLocator===fixture.result.fetchEvidence!.artifacts.find(a=>a.logicalKey==="sanofi-cn-detail-101")!.extractorLocator)!;
    if(kind==="absent")input.expected.sanofiArtifacts=[];
    if(kind==="oracleHash")oracle.sha256="f".repeat(64);
    if(kind==="oracleTuple")oracle.sourceResultId="another-result";
    if(kind==="detailHash")detail.sha256="f".repeat(64);
    if(kind==="detailTuple")detail.batchId="another-batch";
    if(kind==="duplicateOracle")artifacts.push({...oracle});
    expect(()=>verifyBGradeTraversalCertificateReceipt(input)).toThrow(/SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENT/u);
  });
  it("rejects removing the anomaly and rehashing, and rejects removing the proof",()=>{
    const input=reader(),proof=input.certificate.mainTraversal.sanofiIdentityProof,oracle=JSON.parse(proof.oracleBody);
    oracle.entries=[];proof.oracleBody=JSON.stringify(oracle);
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENT_MISMATCH");
    delete input.certificate.mainTraversal.sanofiIdentityProof;
    expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow("SANOFI_CN_IDENTITY_ORACLE_REQUIRED");
  });
  it("rejects unknown proof fields and duplicate JSON keys",()=>{
    for(const kind of ["field","duplicate"]){
      const input=reader(),proof=input.certificate.mainTraversal.sanofiIdentityProof;
      if(kind==="field")proof.extra=true;else proof.oracleBody=proof.oracleBody.replace('"schemaVersion":3','"schemaVersion":3,"schemaVersion":3');
      expect(()=>verifyBGradeTraversalCertificateReceipt(rehash(input))).toThrow();
    }
  });
  it("queries only exact Sanofi tuple and locator metadata, and replaces untrusted prefilled commitments",async()=>{
    const input=reader(),r={...input.expected,id:input.expected.sourceResultId,atomicCommitState:"COMMITTED",completenessState:"VERIFIED",completenessCertificate:input.certificate,sanofiArtifacts:[{sha256:"untrusted"}]} as unknown as PortableSourceResultRow;
    const findMany=vi.fn(async()=>input.expected.sanofiArtifacts);
    await bindSanofiPersistedArtifacts({evidenceArtifact:{findMany}} as unknown as PortableSnapshotTransactionDb,[r]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args=(findMany.mock.calls as unknown as Array<[any]>)[0]![0];
    expect(args.select).toEqual({releaseCandidateId:true,batchId:true,sourceResultId:true,sourceId:true,kind:true,sha256:true,extractorLocator:true,byteCount:true,capturedAt:true});
    expect(args.where.OR).toHaveLength(1);expect(args.where.OR[0]).toMatchObject({releaseCandidateId:input.expected.releaseCandidateId,batchId:input.expected.batchId,sourceResultId:input.expected.sourceResultId,sourceId:"source-sanofi-china-social"});
    expect(args.where.OR[0].extractorLocator.in).toHaveLength(2);
    expect(verifyBGradeTraversalCertificateReceipt({...input,expected:{...input.expected,sanofiArtifacts:r.sanofiArtifacts!}}).status).toBe("PASS");
    const noSanofi=vi.fn(async()=>[]);
    await bindSanofiPersistedArtifacts({evidenceArtifact:{findMany:noSanofi}} as unknown as PortableSnapshotTransactionDb,[{...r,sourceId:"source-servier-china-social"}]);
    expect(noSanofi).not.toHaveBeenCalled();
  });
});
