/** Read-only current Servier B input check. Never captures, rewrites time, or executes SQL. */
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseBGradeIndependentTraversalValidation,evaluateBGradeValidationRequirement,B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS} from '../../../../producer/src/crawler/traversalCertificate.ts';
import {servierHybridFinishedAt} from '../../../../producer/src/crawler/servierMokaRenderedTraversal.ts';
const SOURCE='source-servier-china-social',CONFIG='3c87c89d3bdc74275a0b66a9a27a9eaf76f99da8ee7aa3af835eb87e2b028e17';
export function verifyIndependentValidationInput(bytes:Uint8Array,expectedSha256:string,now=new Date()){
 if(!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('SERVIER_B_INPUT_HASH');
 const validation=parseBGradeIndependentTraversalValidation(JSON.parse(Buffer.from(bytes).toString('utf8')));
 if(validation.schemaVersion!=='official-json-browser-network-traversal-v1'||validation.sourceId!==SOURCE||validation.companyId!=='company-servier-china'||validation.sourceConfigSha256!==CONFIG||validation.retrievalPath!=='CUA_DOM_LIST_PLUS_INDEPENDENT_HTTP_DETAILS')throw Error('SERVIER_B_INPUT_SCOPE');
 const result=evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'CURRENT_RUN',validation,now});
 if(!result.acceptable)throw Error('SERVIER_B_INPUT_'+result.reason);
 const independentFinishedAt=servierHybridFinishedAt(validation.pages);
 if(Date.parse(independentFinishedAt)>now.getTime())throw Error('SERVIER_B_INPUT_FUTURE_RECEIPT');
 const deadline=Math.min(Date.parse(validation.expiresAt),Date.parse(validation.observedAt)+B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS);
 if(now.getTime()>=deadline)throw Error('SERVIER_B_INPUT_EXPIRED');
 return {status:'VALIDATED_CURRENT_RUN',sourceId:SOURCE,sourceConfigSha256:CONFIG,independentValidationSha256:expectedSha256,observedAt:validation.observedAt,independentFinishedAt,expiresAt:validation.expiresAt,currentRunExpiresAt:new Date(deadline).toISOString(),pageCount:validation.pages.length,rawCount:validation.pages.reduce((n,p)=>n+p.rawRows.length,0),noNetwork:true,noSql:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [path,expected,...extra]=process.argv.slice(2);
 if(!path||!expected||extra.length||!isAbsolute(path)||!lstatSync(path).isFile()||realpathSync(path)!==path)throw Error('SERVIER_B_INPUT_DESCRIPTOR');
 console.log(JSON.stringify(verifyIndependentValidationInput(readFileSync(path),expected)));
}
