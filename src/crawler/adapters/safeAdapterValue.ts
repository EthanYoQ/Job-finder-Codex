const ASSIGNMENT = /(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|jwt|bearer|basic)\s*[:=]\s*\S+/iu;

export function containsSensitiveAdapterValue(value: string): boolean {
  let normalized = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    try { const decoded = decodeURIComponent(normalized).normalize("NFKC"); if (decoded === normalized) break; normalized = decoded; }
    catch { break; }
  }
  return ASSIGNMENT.test(normalized);
}

export function isSafeAdapterUrl(value: string, baseUrl: string): boolean {
  try {
    const url = new URL(value, baseUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password &&
      !containsSensitiveAdapterValue(url.href);
  } catch { return false; }
}

export function isSensitiveAdapterUrl(value: string, baseUrl: string): boolean {
  try { const url = new URL(value, baseUrl); return Boolean(url.username || url.password) || containsSensitiveAdapterValue(url.href); }
  catch { return containsSensitiveAdapterValue(value); }
}
