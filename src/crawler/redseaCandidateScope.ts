import { load } from "cheerio";
import { parse } from "@babel/parser";
import { safeOfficialJsonId } from "./officialJsonEvidence";

const REDSEA_V2_ALPHABET = "y!89(*z02BCcdD_bEeGHIJKLmnNOPQopRMSTqrUklVstWXYZafgh3ij1uvwx456A7";
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const REDSEA_V2_SUFFIX = "yyryrtweasdasd";
const MAX_CANDIDATES = 10_000;

function rejectsCandidateWriteTarget(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "Identifier") return node.name === "requestId";
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const property = node.property as Record<string, unknown> | undefined;
    if (property?.type === "Identifier" && node.computed !== true) return property.name === "requestId";
    if (property?.type === "StringLiteral") return property.value === "requestId";
    const object = node.object as Record<string, unknown> | undefined;
    // A computed global write could name the declared variable dynamically.
    return node.computed === true && object?.type === "Identifier" &&
      ["window", "globalThis", "self", "top", "parent"].includes(String(object.name));
  }
  if (node.type === "ObjectProperty") return rejectsCandidateWriteTarget(node.value);
  if (node.type === "RestElement") return rejectsCandidateWriteTarget(node.argument);
  if (node.type === "AssignmentPattern") return rejectsCandidateWriteTarget(node.left);
  if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
    const children = (node.properties ?? node.elements) as unknown[];
    return children.some(rejectsCandidateWriteTarget);
  }
  return false;
}

function assertNoCandidateMutation(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(assertNoCandidateMutation); return; }
  const node = value as Record<string, unknown>;
  if (((node.type === "AssignmentExpression" || node.type === "ForInStatement" || node.type === "ForOfStatement") &&
      rejectsCandidateWriteTarget(node.left)) ||
      (node.type === "UpdateExpression" && rejectsCandidateWriteTarget(node.argument))) {
    throw new Error("candidate variable is dynamically mutated");
  }
  Object.values(node).forEach(assertNoCandidateMutation);
}

function collectScriptScopeDeclarations(value: unknown, declarations: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((child) => collectScriptScopeDeclarations(child, declarations)); return; }
  const node = value as Record<string, unknown>;
  // The real page uses a separate local requestId in its row/detail methods.
  // Blocks and loops do not introduce a new function scope for `var`.
  if (typeof node.type === "string" && /Function|Method/u.test(node.type)) return;
  if (node.type === "VariableDeclarator") {
    const id = node.id as Record<string, unknown>;
    if (id?.type === "Identifier" && id.name === "requestId") {
      const init = node.init as Record<string, unknown> | undefined;
      if (init?.type !== "StringLiteral" || typeof init.value !== "string") throw new Error("candidate declaration is not literal");
      declarations.push(init.value);
    } else if (rejectsCandidateWriteTarget(id)) {
      throw new Error("candidate declaration is destructured");
    }
  }
  Object.values(node).forEach((child) => collectScriptScopeDeclarations(child, declarations));
}

// Read source data, never execute the site's scripts. Unknown encodings fail closed.
function readCandidateIds(html: string): string[] {
  if (html.length > 16_000_000) throw new Error("candidate declaration too large");
  const declarations: string[] = [];
  const $ = load(html);
  $("script:not([src])").each((_index, element) => {
    const type = $(element).attr("type");
    if (type && !["text/javascript", "application/javascript", "module"].includes(type)) return;
    const script = $(element).text();
    const program = parse(script, { sourceType: "unambiguous" }).program;
    assertNoCandidateMutation(program);
    const scriptDeclarations: string[] = [];
    collectScriptScopeDeclarations(program, scriptDeclarations);
    const topLevelCount = program.body.reduce((count, statement) => count + (statement.type === "VariableDeclaration"
      ? statement.declarations.filter((declaration) => declaration.id.type === "Identifier" && declaration.id.name === "requestId").length
      : 0), 0);
    if (scriptDeclarations.length !== topLevelCount) throw new Error("candidate declaration is conditional or redeclared in a block");
    declarations.push(...scriptDeclarations);
  });
  if (declarations.length !== 1) throw new Error("candidate declaration is not unique");
  const encoded = declarations[0]!;
  if (encoded === "") return [];
  if (encoded.length < REDSEA_V2_SUFFIX.length || encoded.length > 2_000_000 ||
      encoded.slice(-11) + encoded.slice(2, 5) !== REDSEA_V2_SUFFIX) {
    throw new Error("unsupported candidate encoding");
  }
  const wrapped = encoded.slice(0, 2) + encoded.slice(5) + encoded.slice(2, 5);
  const payload = wrapped.slice(0, -REDSEA_V2_SUFFIX.length);
  const standard = [...payload].map((char) => {
    const index = REDSEA_V2_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid candidate encoding");
    return BASE64_ALPHABET[index]!;
  }).join("");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(standard)) throw new Error("invalid candidate padding");
  const bytes = Buffer.from(standard, "base64");
  if (bytes.toString("base64").replace(/=+$/u, "") !== standard.replace(/=+$/u, "")) {
    throw new Error("noncanonical candidate encoding");
  }
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded).equals(bytes)) throw new Error("invalid candidate text");
  const ids = decoded === "" ? [] : decoded.split(",");
  if (ids.length > MAX_CANDIDATES || ids.some((id) => !safeOfficialJsonId(id)) || new Set(ids).size !== ids.length) {
    throw new Error("invalid or duplicate candidate identity");
  }
  return ids;
}

export function auditRedseaCandidateScope(html: string, rows: readonly unknown[]) {
  let candidateIds: string[] = [];
  let declarationValid = false;
  try { candidateIds = readCandidateIds(html); declarationValid = true; } catch { /* Keep only safe diagnostic codes. */ }
  const returnedIds = rows.map((row) => row !== null && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>).REQUEST_ID : undefined);
  const validReturnedIds = returnedIds.filter((id): id is string => typeof id === "string" && safeOfficialJsonId(id));
  const duplicateReturnedIds = [...new Set(validReturnedIds.filter((id, index) => validReturnedIds.indexOf(id) !== index))];
  const unexpectedReturnedIds = declarationValid ? [...new Set(validReturnedIds.filter((id) => !candidateIds.includes(id)))] : [];
  const unexplainedCandidateIds = candidateIds.filter((id) => !validReturnedIds.includes(id));
  const status = !declarationValid ? "CANDIDATE_DECLARATION_INVALID"
    : validReturnedIds.length !== rows.length ? "RETURNED_CANDIDATE_ID_INVALID"
    : duplicateReturnedIds.length > 0 ? "DUPLICATE_RETURNED_CANDIDATE"
    : unexpectedReturnedIds.length > 0 ? "UNEXPECTED_RETURNED_CANDIDATE"
    : unexplainedCandidateIds.length > 0 ? "CANDIDATE_QUERY_SUBSET"
    : "CANDIDATE_SET_ACCOUNTED";
  return {
    schema: "redsea-candidate-scope-v1" as const,
    status,
    candidateIds,
    returnedIds: validReturnedIds,
    duplicateReturnedIds,
    unexpectedReturnedIds,
    unexplainedCandidateIds,
    unexplainedCandidates: unexplainedCandidateIds.map((officialId) => ({ officialId, code: "NO_OFFICIAL_EXCLUSION_EVIDENCE" as const })),
    // Candidate absence is not a parse discard, a closed-job finding, or an official total.
    officialDeclaredTotal: null,
    // Configured IDs are query inputs, not an official active-vacancy total.
    // Absent candidates stay unknown. Independent rendered traversal must still match every returned ID.
    complete: status === "CANDIDATE_SET_ACCOUNTED" || status === "CANDIDATE_QUERY_SUBSET"
  };
}
