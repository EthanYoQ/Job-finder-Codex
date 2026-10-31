export function savePrivateDomFailure(input: {
  observe: () => Promise<unknown>;
  directory: string;
  filePrefix: string;
  context: Record<string, unknown>;
}): Promise<{file: string; sha256: string}>;
