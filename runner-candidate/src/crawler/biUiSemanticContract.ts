import { parse } from "@babel/parser";

/** Newly reviewed reconstruction. Never evaluate the downloaded script. */
export const BI_UI_RECONSTRUCTION_POLICY = "BI_UI_SEMANTIC_RECONSTRUCTION_20261001_V1";
export const BI_ENTRY_URL = "https://campus.51job.com/BI/recruitSociety.html";
export const BI_SCRIPT_URL = "https://campus.51job.com/BI/scripts/recruit.js?v=1";
export const BI_DETAIL_URL = "https://campus.51job.com/BI/recruit_article_detail3.html";
export const BI_API_URL = "https://coapi.51job.com/job_list.php";

const REQUEST_DECLARATION = `var params = { ctmid: "3479", pagesize: 500, pagenum: 1,
  sort: "issuedate", sequence: "0", keyword: null, jobarea: null, functype: null, divid: null, poscode: null };`;
const FILTER_DECLARATION = `var filteredJobList = jobList.filter(function(job) {
  return !sxsPosCode.some(function(item) {
    return job.jobname.includes(item.code) && job.jobareaname.includes(item.jobareaname);
  });
});`;
export interface BiUiSemanticContract {
  params: Record<string, string | number | null>;
  exclusions: Array<{ code: string; jobareaname: string }>;
}

/** Read only the native unfiltered request, dataflow and literal exclusion list.
 * Tracking, display handlers and statement positions do not define the source's job inventory. */
export function replayBiUiSemanticContract(script: string): BiUiSemanticContract | undefined {
  try {
    const program = parse(script, { sourceType: "script", errorRecovery: false }).program;
    const callbacks=program.body.flatMap(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&node.expression.arguments[0]?.type==='FunctionExpression'?[node.expression.arguments[0]]:[]);
    if(callbacks.length!==1||callbacks[0]!.params.length!==0)return;
    const statements=callbacks[0]!.body.body;
    const declarations=(name:string)=>statements.filter(node=>node.type==='VariableDeclaration'&&node.declarations.some(d=>d.id.type==='Identifier'&&d.id.name===name));
    const functions=(name:string)=>statements.filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===name);
    const request=declarations('params'),rules=declarations('sxsPosCode'),fetch=functions('getJobList'),renders=functions('renderJob');
    if(request.length!==1||rules.length!==1||fetch.length!==1||renders.length!==1)return;
    const params=literalDeclaration(request[0]),exclusions=literalDeclaration(rules[0]);
    if(!sameAst(params,literalDeclaration(statement(REQUEST_DECLARATION)))||!Array.isArray(exclusions)||
      exclusions.some(rule=>!rule||typeof rule!=='object'||typeof rule.code!=='string'||!/^\d+$/u.test(rule.code)||typeof rule.jobareaname!=='string'||!rule.jobareaname.trim()))return;
    const fetchNode=fetch[0]!,render=renders[0]!;
    if(fetchNode.type!=='FunctionDeclaration'||render.type!=='FunctionDeclaration')return;
    const calls=fetchNode.body.body.flatMap(node=>node.type==='ExpressionStatement'&&node.expression.type==='CallExpression'&&
      node.expression.callee.type==='MemberExpression'&&node.expression.callee.object.type==='Identifier'&&node.expression.callee.object.name==='coapi'&&
      node.expression.callee.property.type==='Identifier'&&node.expression.callee.property.name==='getJobList'?[node.expression]:[]);
    if(calls.length!==1||calls[0]!.arguments[0]?.type!=='Identifier'||calls[0]!.arguments[0].name!=='params'||calls[0]!.arguments[1]?.type!=='FunctionExpression')return;
    const callback=calls[0]!.arguments[1];
    const dataflow=['jobList = data.resultbody.joblist || null;','totalNum = data.resultbody.totalnum || 0;','renderJob();'].map(statement);
    if(dataflow.some(expected=>callback.body.body.filter(node=>sameAst(node,expected)).length!==1))return;
    const positions=dataflow.map(expected=>callback.body.body.findIndex(node=>sameAst(node,expected)));
    if(positions[0]!>positions[2]!||positions[1]!>positions[2]!)return;
    if(render.body.body.filter(node=>sameAst(node,statement(FILTER_DECLARATION))).length!==1)return;
    const inventoryAssignments=['jobList = data.resultbody.joblist || null;','totalNum = data.resultbody.totalnum || 0;'].map(statement);
    const queryAssignments=['divid:business','functype:functype','jobarea:jobarea','poscode:jobid'].map(pair=>{const [field,value]=pair.split(':');return statement(`params.${field} = ${value} === "null" ? null : ${value};`);});
    if(changesInventory(statements,[request[0],rules[0],...queryAssignments])||changesInventory(callback.body.body,inventoryAssignments)||changesInventory(render.body.body,[statement(FILTER_DECLARATION)]))return;
    const expectedLoop=statement('for (var index = 0; index < filteredJobList.length; index++) {}');
    if(expectedLoop.type!=='ForStatement'||render.body.body.filter(node=>node.type==='ForStatement'&&sameAst(node.init,expectedLoop.init)&&sameAst(node.test,expectedLoop.test)&&sameAst(node.update,expectedLoop.update)).length!==1)return;
    return {params:params as BiUiSemanticContract['params'],exclusions:exclusions as BiUiSemanticContract['exclusions']};
  } catch { return undefined; }
}

function statement(source: string) { return parse(source, { sourceType: "script" }).program.body[0]!; }
function sameAst(left: unknown, right: unknown): boolean { return structural(left) === structural(right); }
function changesInventory(value:unknown,allowed:readonly unknown[]):boolean{
  if(Array.isArray(value))return value.some(node=>changesInventory(node,allowed));
  if(!value||typeof value!=='object'||allowed.some(node=>sameAst(value,node)))return false;
  const node=value as Record<string,unknown>,type=node.type;
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(String(type)))return false;
  const name=(target:unknown):unknown=>{if(!target||typeof target!=='object')return;const n=target as Record<string,unknown>;return n.type==='Identifier'?n.name:n.type==='MemberExpression'?name(n.object):undefined;};
  const protectedNames=new Set(['params','jobList','totalNum','sxsPosCode','filteredJobList']);
  if((type==='AssignmentExpression'&&protectedNames.has(String(name(node.left))))||(type==='UpdateExpression'&&protectedNames.has(String(name(node.argument))))||
    (type==='VariableDeclarator'&&node.init!=null&&protectedNames.has(String(name(node.id))))||
    (type==='CallExpression'&&node.callee&&typeof node.callee==='object'&&(node.callee as Record<string,unknown>).type==='MemberExpression'&&protectedNames.has(String(name((node.callee as Record<string,unknown>).object)))&&['push','pop','shift','unshift','splice','sort','reverse','copyWithin','fill'].includes(String(((node.callee as Record<string,unknown>).property as Record<string,unknown>)?.name))))return true;
  return Object.entries(node).some(([key,child])=>!NON_SEMANTIC_AST_KEYS.has(key)&&changesInventory(child,allowed));
}
const NON_SEMANTIC_AST_KEYS = new Set(["start", "end", "loc", "extra", "leadingComments", "innerComments", "trailingComments", "comments", "tokens", "errors"]);
function structural(value: unknown): string { return JSON.stringify(canonicalAst(value)); }
function canonicalAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAst);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).filter(key => !NON_SEMANTIC_AST_KEYS.has(key)).sort()
      .map(key => [key, canonicalAst(record[key])]));
  }
  return value;
}
function literalDeclaration(node: unknown): unknown {
  const value = node as { type: string; declarations?: Array<{ init: unknown }> };
  if (value.type !== "VariableDeclaration" || value.declarations?.length !== 1) throw new Error("Nonliteral declaration");
  return literal(value.declarations[0]!.init);
}
function literal(value: unknown): unknown {
  const node = value as { type: string; value?: unknown; properties?: Array<{ type: string; computed: boolean; key: { type: string; name: string }; value: unknown }>; elements?: unknown[] };
  if (node.type === "NullLiteral") return null;
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return node.value;
  if (node.type === "ArrayExpression") return node.elements!.map(literal);
  if (node.type === "ObjectExpression") return Object.fromEntries(node.properties!.map(property => {
    if (property.type !== "ObjectProperty" || property.computed || property.key.type !== "Identifier") throw new Error("Nonliteral property");
    return [property.key.name, literal(property.value)];
  }));
  throw new Error("Unsupported literal syntax");
}
