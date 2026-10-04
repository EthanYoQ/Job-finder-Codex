type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Node { value: Json; literal: string; uses: number; children: Node[]; keys: string[] }
const text = (value: string) => `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
const literal = (value: Json) => `${text(JSON.stringify(value))}::jsonb`;

/** Lossless, local SQL literals for the two large inputs to the existing DO.
 * Only identical serialized subtrees are shared. A shared parent's descendants
 * are counted once, avoiding redundant declarations for its entire subtree.
 * JSON normalization is exactly the JSON.stringify boundary used previously.
 * No database lookup, hash comparison, compression or persistent object is used.
 */
export function compileAtomicJsonDeclarations(sourceResult: unknown, expectedContext: unknown): string {
  const nodes = new Map<string, Node>();
  function collect(value: Json): Node {
    const serialized = JSON.stringify(value), existing = nodes.get(serialized);
    if (existing) { existing.uses++; return existing; }
    const node: Node = { value, literal: literal(value), uses: 1, children: [], keys: [] };
    nodes.set(serialized, node);
    if (value !== null && typeof value === "object") {
      node.keys = Object.keys(value);
      node.children = Object.values(value).map(collect);
    }
    return node;
  }
  const roots = [sourceResult, expectedContext].map(value => collect(JSON.parse(JSON.stringify(value)) as Json));
  const names = new Map<Node, string>(), declarations: string[] = [];
  function render(node: Node): string {
    const existing = names.get(node);
    if (existing) return existing;
    // The declaration and references must cost less than repeated literals.
    if (node.uses > 1 && Buffer.byteLength(node.literal) >= 128) {
      const name = `atomic_json_${names.size}`;
      names.set(node, name);
      const expression = expressionFor(node);
      // Dependencies are rendered first, so every initializer refers only to
      // an already initialized PL/pgSQL variable, including shared parents.
      declarations.push(`${name} jsonb := ${expression};`);
      return name;
    }
    return expressionFor(node);
  }
  function expressionFor(node: Node): string {
    if (!node.children.length) return node.literal;
    const rendered = node.children.map(render);
    if (rendered.every((value, index) => value === node.children[index]!.literal)) return node.literal;
    if (Array.isArray(node.value)) {
      const parts: string[] = [];
      for (let i = 0; i < rendered.length;) {
        const start = i, unchanged = rendered[i] === node.children[i]!.literal;
        while (i < rendered.length && (rendered[i] === node.children[i]!.literal) === unchanged && i - start < 64) i++;
        parts.push(unchanged ? literal(node.value.slice(start, i)) : `jsonb_build_array(${rendered.slice(start, i).join(",")})`);
      }
      return `(${parts.join(" || ")})`;
    }
    const unchanged: { [key: string]: Json } = {}, changed: string[] = [];
    node.children.forEach((child, index) => {
      const key = node.keys[index]!;
      if (rendered[index] === child.literal) Object.defineProperty(unchanged, key, {value: child.value, enumerable: true});
      else changed.push(`${text(key)},${rendered[index]}`);
    });
    const parts = Object.keys(unchanged).length ? [literal(unchanged)] : [];
    // PostgreSQL functions accept at most 100 arguments; each field uses two.
    for (let i = 0; i < changed.length; i += 32) parts.push(`jsonb_build_object(${changed.slice(i, i + 32).join(",")})`);
    return `(${parts.join(" || ")})`;
  }
  const source = render(roots[0]!), context = render(roots[1]!);
  return [...declarations, `source_result_data jsonb := ${source};`, `expected_context_data jsonb := ${context};`].join("\n");
}
