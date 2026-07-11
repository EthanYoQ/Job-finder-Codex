const CREDENTIAL_VALUE_PATTERN = /(?:^|[\s,;{[(])(?:bearer|basic)\s+[a-z0-9._~+\/-]{4,}|(?:authorization|cookie|set-cookie|password|passwd|pwd|client[._-]?secret|api[._-]?key|access[._-]?token|refresh[._-]?token|session(?:id)?|jwt)\s*[:=]\s*\S+|\beyj[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}/iu;

export function boundedCredentialDecode(value: string): string {
  let decoded = value.normalize("NFKC");
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded).normalize("NFKC");
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export function containsCredentialMaterial(value: string): boolean {
  return CREDENTIAL_VALUE_PATTERN.test(boundedCredentialDecode(value));
}
