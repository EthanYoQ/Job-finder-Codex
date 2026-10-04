export const PRODUCTION_TSX_LOADER_PATH = "./node_modules/tsx/dist/loader.mjs";

export function productionTsxProcessArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return ["--import", PRODUCTION_TSX_LOADER_PATH, scriptPath, ...args];
}
