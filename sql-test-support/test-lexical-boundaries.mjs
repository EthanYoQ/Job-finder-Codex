import assert from 'node:assert/strict';
import {PGlite} from './node_modules/native-single-test/index.js';
import {prepareSql} from './node_modules/native-single-test/sql-framing.js';
const db=await PGlite.create(),checks=[];
async function check(name,sql,values,expected){assert.deepEqual((await db.query(sql,values)).rows,expected);checks.push(name);}
try{
 await check('ordinary-consecutive-LF',"SELECT 'a\n\nb' AS value",[],[{value:'a\n\nb'}]);
 await check('ordinary-semicolon-double-LF',"SELECT 'a;\n\nb' AS value",[],[{value:'a;\n\nb'}]);
 await check('ordinary-quotes-backslashes-and-LF',"SELECT 'can''t $1\n\n\\b' AS value, $1::text AS bound",['real'],[{value:"can't $1\n\n\\b",bound:'real'}]);
 await check('E-string-physical-and-escaped-LF',"SELECT E'a\n\n\\nb' AS value",[],[{value:'a\n\n\nb'}]);
 await check('quoted-and-comment-parameters',"SELECT '$1' AS literal, $1::text AS bound -- $2\n /* $3 /* $4 */ $5 */",['real'],[{literal:'$1',bound:'real'}]);
 await check('nested-comment-code-parameter',"/* outer $8 /* inner $9 */ still $7 */ SELECT $1::text AS value",['bound'],[{value:'bound'}]);
 await check('line-comment-isolated-CR',"SELECT 1 -- ignored $2\r + 1 AS value",[],[{value:2}]);
 await check('line-comment-CRLF',"SELECT 1 -- ignored $2\r\n + 1 AS value",[],[{value:2}]);
 await check('dollar-body-parameter-and-LF',"SELECT $body$$1;\n\n'$2'$body$ AS value, $1::text AS bound",['real'],[{value:"$1;\n\n'$2'",bound:'real'}]);
 await check('quoted-identifier-parameter', 'SELECT 1 AS "key$1", $1::text AS bound',['real'],[{'key$1':1,bound:'real'}]);
 await check('unquoted-identifier-dollar', 'SELECT 1 AS key$1, $1::text AS bound',['real'],[{'key$1':1,bound:'real'}]);
 await check('repeated-real-placeholder','SELECT $1::int AS a, $1::int AS b, $2::text AS c',[7,'x'],[{a:7,b:7,c:'x'}]);
 const nbsp='\u00a0SELECT 1 AS value\u00a0';assert.equal(prepareSql(nbsp),nbsp);
 await assert.rejects(()=>db.query(nbsp),/ERROR:/);checks.push('NBSP-code-not-normalized');
 for(const [name,sql,values] of [
  ['adjacent-string-unsupported',"SELECT 'a'\n'b'",[]],
  ['unterminated-string',"SELECT 'abc",[]],
  ['unterminated-dollar','SELECT $body$abc',[]],
  ['non-ASCII-dollar-tag-unsupported','SELECT $标签$a\n\nb$标签$',[]],
  ['unterminated-nested-comment','SELECT 1 /* /* */',[]],
  ['missing-parameter','SELECT $1',[]],
  ['unused-comment-parameter','SELECT 1 /* $1 */',['x']],
  ['unused-literal-parameter',"SELECT '$1'",['x']],
  ['invalid-parameter-suffix','SELECT $1oops',['x']],
  ['zero-parameter','SELECT $0',['x']],
  ['unicode-quote-unsupported',"SELECT U&'a'",[]]
 ]){assert.throws(()=>prepareSql(sql,values),/NATIVE_SINGLE_/);checks.push(name);}
 console.log(JSON.stringify({status:'PASS_LEXICAL_BOUNDARIES_NATIVE_SINGLE',checks,failed:0,networkUsed:false,engine:'official PostgreSQL 17.5 --single',scope:'narrow supported lexical forms; unsupported forms fail closed'}));
}finally{await db.close();}
