import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readProductionDeploymentImageReceipt } from "./validate-production-deployment-image";

interface CommandResult { error?: Error; status: number | null }
interface DeploymentCommand {
  command: string;
  args: string[];
  options: { stdio: "inherit"; shell: false; env: NodeJS.ProcessEnv };
}
export interface DeployQualifiedStackDeps {
  readEnvFile(path: string): string;
  run(command: DeploymentCommand): CommandResult;
  hostEnv: NodeJS.ProcessEnv;
}

export async function deployQualifiedStack(
  receiptArgument: string,
  envArgument: string,
  composeArguments: readonly string[],
  deps: DeployQualifiedStackDeps = defaultDeps
): Promise<void> {
  const receiptPath = resolve(receiptArgument), envPath = resolve(envArgument);
  const digest = readUniqueEnvValue(deps.readEnvFile(envPath), "JOB_FINDER_IMAGE_DIGEST");
  const receipt = await readProductionDeploymentImageReceipt(receiptPath, digest);
  const childEnv = { ...deps.hostEnv, JOB_FINDER_IMAGE_DIGEST: digest };
  execute(deps, "docker", ["pull", receipt.image], childEnv);
  const common = ["compose", "--env-file", envPath, "-f", resolve("ops/docker-compose.yml")];
  execute(deps, "docker", [...common, "config", "--quiet"], childEnv);
  execute(deps, "docker", [...common, "up", "-d", ...composeArguments], childEnv);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [receiptArgument, envArgument, ...composeArguments] = process.argv.slice(2);
  if (!receiptArgument || !envArgument) {
    throw new Error("Usage: deploy-qualified-stack <deployment-receipt.json> <production.env> [compose services]");
  }
  await deployQualifiedStack(receiptArgument, envArgument, composeArguments);
}

function readUniqueEnvValue(contents: string, name: string): string {
  const values = contents.split(/\r?\n/u).filter((line) => line.startsWith(`${name}=`)).map((line) => line.slice(name.length + 1));
  if (values.length !== 1 || !/^[0-9a-f]{64}$/u.test(values[0]!)) throw new Error(`${name} must occur exactly once in the env file`);
  return values[0]!;
}
function execute(deps: DeployQualifiedStackDeps, command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = deps.run({ command, args, options: { stdio: "inherit", shell: false, env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${String(result.status)}`);
}
const defaultDeps: DeployQualifiedStackDeps = {
  readEnvFile: (path) => readFileSync(path, "utf8"),
  run: ({ command, args, options }) => spawnSync(command, args, options),
  hostEnv: process.env
};
