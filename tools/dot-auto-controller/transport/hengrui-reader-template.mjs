/** Fixed reviewed Hengrui reader. A multi-statement simple query cannot use pg
 * positional parameters. Only the factory-owned, strict identifier literal is
 * substituted after verifying every byte of the reviewed template. */
import {createHash} from 'node:crypto';
export const HISTORICAL_READER_CANDIDATE='dot-cloud-c51-recovered-3a240076-20261008';
export const READER_TEMPLATE_SHA256='5d5794bf4ed4b153be999eaf46a0da6213a79391d45bfeaa954d82e36fd4fc09';
export function assertReaderCandidate(candidateId){
  if(typeof candidateId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidateId))throw Error('COMPILER_READER_CANDIDATE_CONFIG');
}
export function compileReviewedReaderSql(template,candidateId){
  assertReaderCandidate(candidateId);
  if(typeof template!=='string'||createHash('sha256').update(template).digest('hex')!==READER_TEMPLATE_SHA256)throw Error('COMPILER_READER_QUERY_DRIFT');
  const literal="E'"+HISTORICAL_READER_CANDIDATE+"'";
  if(template.split(literal).length!==2)throw Error('COMPILER_READER_LITERAL_COUNT');
  return template.replace(literal,"E'"+candidateId+"'");
}
