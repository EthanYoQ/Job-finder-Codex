import { createHash } from "node:crypto";
import { parse } from "@babel/parser";

/** Newly reviewed reconstruction. Never evaluate the downloaded script. */
export const BI_UI_RECONSTRUCTION_POLICY = "BI_UI_SEMANTIC_RECONSTRUCTION_20261001_V1";
const REVIEWED_WHOLE_PROGRAM_AST_SHA256 = "2bedc4f3fc84d6e38cc2321ad87b4d6340b8c4360e027f570b04df66efd3ff0d";
export const BI_ENTRY_URL = "https://campus.51job.com/BI/recruitSociety.html";
export const BI_SCRIPT_URL = "https://campus.51job.com/BI/scripts/recruit.js?v=1";
export const BI_DETAIL_URL = "https://campus.51job.com/BI/recruit_article_detail3.html";
export const BI_API_URL = "https://coapi.51job.com/job_list.php";

const REQUEST_DECLARATION = `var params = { ctmid: "3479", pagesize: 500, pagenum: 1,
  sort: "issuedate", sequence: "0", keyword: null, jobarea: null, functype: null, divid: null, poscode: null };`;
const EXCLUSIONS_DECLARATION = `let sxsPosCode = [
  {code:"205901",jobareaname:"南昌"}, {code:"204542",jobareaname:"上海"},
  {code:"204542",jobareaname:"北京"}, {code:"204023",jobareaname:"上海"},
  {code:"205909",jobareaname:"上海"}, {code:"206067",jobareaname:"上海"},
  {code:"207401",jobareaname:"上海"}, {code:"205538",jobareaname:"上海"} ];`;
const FILTER_DECLARATION = `var filteredJobList = jobList.filter(function(job) {
  return !sxsPosCode.some(function(item) {
    return job.jobname.includes(item.code) && job.jobareaname.includes(item.jobareaname);
  });
});`;
const FETCH_FUNCTION = `function getJobList(params) {
  coapi.getJobList(params, function(data) {
    jobList = data.resultbody.joblist || null;
    totalNum = data.resultbody.totalnum || 0;
    pageTotal = Math.ceil(totalNum / 8);
    console.log(data, jobList);
    renderJob();
  });
}`;

export interface BiUiSemanticContract {
  params: Record<string, string | number | null>;
  exclusions: Array<{ code: string; jobareaname: string }>;
}

/** Whole-program AST identity + explicit request/dataflow/exclusion/render checks.
 * Formatting and comments may change without changing the accepted program.
 * The AST pin covers every reviewed branch, including search/detail/apply handlers outside
 * the unfiltered list path. New/changed branches require a new review, never a best guess. */
export function replayBiUiSemanticContract(script: string): BiUiSemanticContract | undefined {
  try {
    const program = parse(script, { sourceType: "script", errorRecovery: false }).program;
    if (hash(structural(program)) !== REVIEWED_WHOLE_PROGRAM_AST_SHA256 || program.body.length !== 1) return undefined;
    const ready = program.body[0];
    if (ready?.type !== "ExpressionStatement" || ready.expression.type !== "CallExpression") return undefined;
    const callback = ready.expression.arguments[0];
    if (callback?.type !== "FunctionExpression" || callback.params.length !== 0) return undefined;
    const statements = callback.body.body;
    if (statements.length !== 26 || !sameAst(statements[4], statement(REQUEST_DECLARATION)) ||
        !sameAst(statements[11], statement(FETCH_FUNCTION)) ||
        !sameAst(statements[14], statement(EXCLUSIONS_DECLARATION))) return undefined;
    const render = statements[15];
    if (render?.type !== "FunctionDeclaration" || render.id?.name !== "renderJob" ||
        !sameAst(render.body.body[0], statement(FILTER_DECLARATION))) return undefined;
    const loop = render.body.body[3];
    const expectedLoop = statement("for (var index = 0; index < filteredJobList.length; index++) {}");
    if (loop?.type !== "ForStatement" || expectedLoop.type !== "ForStatement" ||
        !sameAst(loop.init, expectedLoop.init) || !sameAst(loop.test, expectedLoop.test) ||
        !sameAst(loop.update, expectedLoop.update)) return undefined;
    // These are literal-only AST projections, not JavaScript evaluation.
    const params = literalDeclaration(statements[4]);
    const exclusions = literalDeclaration(statements[14]);
    if (!params || typeof params !== "object" || Array.isArray(params) || !Array.isArray(exclusions)) return undefined;
    return { params: params as BiUiSemanticContract["params"], exclusions: exclusions as BiUiSemanticContract["exclusions"] };
  } catch { return undefined; }
}

function statement(source: string) { return parse(source, { sourceType: "script" }).program.body[0]!; }
function sameAst(left: unknown, right: unknown): boolean { return structural(left) === structural(right); }
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
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
