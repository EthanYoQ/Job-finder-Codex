export function vitestMaxWorkers(
  environment: Readonly<Record<string, string | undefined>>
): number {
  return environment.CI === "true" ? 2 : 4;
}
