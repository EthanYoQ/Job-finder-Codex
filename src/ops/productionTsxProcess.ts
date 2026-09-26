export const PRODUCTION_TSX_CLI_PATH = "node_modules/tsx/dist/cli.mjs";

export function productionTsxProcessArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [PRODUCTION_TSX_CLI_PATH, scriptPath, ...args];
}
