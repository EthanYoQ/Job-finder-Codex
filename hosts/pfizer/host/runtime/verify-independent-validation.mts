/** Read-only Pfizer native DOM/JSON-LD input review. No HTTP, browser, timestamp rewriting or SQL. */
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseBGradeIndependentTraversalValidation,evaluateBGradeValidationRequirement,B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS} from '../../../../producer/src/crawler/traversalCertificate.ts';
import {replayOfficialJsonRenderedTraversal} from '../../../../producer/src/crawler/officialJsonRenderedTraversalValidator.ts';
const SOURCE='source-pfizer-china-social',CONFIG='84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413';
export function verifyIndependentValidationInput(bytes:Uint8Array,expectedSha256:string,now=new Date()){
 if(!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('PFIZER_B_INPUT_HASH');
 const validation=parseBGradeIndependentTraversalValidation(JSON.parse(Buffer.from(bytes).toString('utf8')));
 if(validation.schemaVersion!=='official-json-browser-network-traversal-v1'||validation.sourceId!==SOURCE||validation.companyId!=='company-pfizer-china'||validation.sourceConfigSha256!==CONFIG||validation.retrievalPath!=='PLAYWRIGHT_OFFICIAL_UI_JSONLD_TRAVERSAL'||validation.validatorImplementationId!=='pfizer-official-dom-jsonld-traversal-v1')throw Error('PFIZER_B_INPUT_SCOPE');
 const result=evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'CURRENT_RUN',validation,now});
 if(!result.acceptable)throw Error('PFIZER_B_INPUT_'+result.reason);
 const replay=replayOfficialJsonRenderedTraversal(SOURCE,validation.pages);
 const times=validation.pages.flatMap(p=>p.rawRows.flatMap(r=>[r.rawPayload.capturedAt,...(r.rawPayload.listPage?[((r.rawPayload.listPage as any).capturedAt)]:[])]));
 const finished=Math.max(...times.map(x=>Date.parse(String(x))));
 if(!Number.isFinite(finished)||finished>now.getTime()||times.some(x=>Date.parse(String(x))<Date.parse(validation.observedAt)))throw Error('PFIZER_B_INPUT_ORIGINAL_TIMES');
 const deadline=Math.min(Date.parse(validation.expiresAt),Date.parse(validation.observedAt)+B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS);
 if(now.getTime()>=deadline)throw Error('PFIZER_B_INPUT_EXPIRED');
 return {status:'VALIDATED_CURRENT_RUN',sourceId:SOURCE,sourceConfigSha256:CONFIG,independentValidationSha256:expectedSha256,observedAt:validation.observedAt,independentFinishedAt:new Date(finished).toISOString(),expiresAt:validation.expiresAt,currentRunExpiresAt:new Date(deadline).toISOString(),pageCount:validation.pages.length,rawCount:replay.rawCount,includedMainlandCount:replay.matchKeys.length,auditedIndiaExcludedCount:replay.excludedCount,noNetwork:true,noSql:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [path,expected,...extra]=process.argv.slice(2);
 if(!path||!expected||extra.length||!isAbsolute(path)||!lstatSync(path).isFile()||realpathSync(path)!==path)throw Error('PFIZER_B_INPUT_DESCRIPTOR');
 console.log(JSON.stringify(verifyIndependentValidationInput(readFileSync(path),expected)));
}
