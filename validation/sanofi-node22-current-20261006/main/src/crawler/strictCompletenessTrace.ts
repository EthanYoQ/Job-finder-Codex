export type StrictCompletenessTraceScope = "STRICT_COMPLETENESS_GATE" | "STRICT_HTML_PROOF";

export function strictCompletenessTrace(
  scope: StrictCompletenessTraceScope,
  sourceId: string,
  reason: string
): false {
  if (process.env.STRICT_COMPLETENESS_GATE_TRACE === "1") {
    process.stderr.write(`${scope} ${safeTraceToken(sourceId)} ${safeTraceToken(reason)}\n`);
  }
  return false;
}

function safeTraceToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 160);
}
