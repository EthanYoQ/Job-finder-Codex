import { parseExpression } from "@babel/parser";

export function hasUniqueJsonObjectKeys(json: string): boolean {
  let expression: unknown;
  try {
    expression = parseExpression(json, {
      sourceType: "script",
      errorRecovery: false
    });
  } catch {
    return false;
  }
  return uniqueJsonObjectKeysInExpression(expression);
}

function uniqueJsonObjectKeysInExpression(node: unknown): boolean {
  if (!isRecord(node) || typeof node.type !== "string") return false;
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(node.type)) {
    return true;
  }
  if (node.type === "UnaryExpression") {
    return node.operator === "-" && uniqueJsonObjectKeysInExpression(node.argument);
  }
  if (node.type === "ArrayExpression") {
    return Array.isArray(node.elements) && node.elements.every((element) =>
      element !== null && uniqueJsonObjectKeysInExpression(element));
  }
  if (node.type !== "ObjectExpression" || !Array.isArray(node.properties)) return false;
  const keys = new Set<string>();
  for (const property of node.properties) {
    if (!isRecord(property) || property.type !== "ObjectProperty" ||
      property.computed !== false || property.method === true || property.shorthand === true ||
      !isRecord(property.key) || property.key.type !== "StringLiteral" ||
      typeof property.key.value !== "string") return false;
    const key = property.key.value;
    if (keys.has(key)) return false;
    keys.add(key);
    if (!uniqueJsonObjectKeysInExpression(property.value)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
