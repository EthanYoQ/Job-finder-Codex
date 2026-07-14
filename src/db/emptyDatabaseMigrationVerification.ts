import { createHash } from "node:crypto";
import { resolve } from "node:path";

const EMPTY_DATABASE_NAME = /^jobfinder_empty_verify_[a-f0-9]{16,64}$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface EmptyDatabaseVerificationConfig {
  databaseName: string;
  expectedSystemIdentifier: string;
  forbiddenSystemIdentifiers: readonly string[];
  host: string;
  username: string;
  password: string;
  sslMode?: string;
}

export interface CommandInvocation {
  stage: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell: false;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface EmptyDatabaseMigrationVerificationDeps {
  projectRoot: string;
  nodeExecutable: string;
  prismaCliPath: string;
  psqlExecutable: string;
  pgDumpExecutable: string;
  expectedMigrationNames: readonly string[];
  expectedAppTableNames: readonly string[];
  expectedUserTypeNames: readonly string[];
  expectedFunctionNames: readonly string[];
  expectedIndexNames: readonly string[];
  expectedIndexDefinitionSha256: string;
  runCommand(invocation: CommandInvocation): Promise<CommandResult>;
}

export interface EmptyDatabaseMigrationVerificationReport {
  databaseName: string;
  serverVersion: string;
  systemIdentifier: string;
  migrationCount: number;
  appTableCount: number;
  allAppTableCountsZero: true;
  normalizedSchemaSha256: string;
  secondDeployNoop: true;
}

interface TargetIdentityAudit {
  currentDatabase: string;
  serverVersion: string;
  systemIdentifier: string;
  isTemplate: boolean;
}

interface EmptyInventoryAudit {
  publicSchemaObjectCount: number;
  migrationTableExists: boolean;
  migrationRowCount: number;
}

interface MigrationAudit {
  migrations: Array<{ migrationName: string; finishedAt: string | null; rolledBackAt: string | null }>;
  appTables: string[];
  tableCounts: Record<string, number>;
  nonTableRelations: string[];
  userTypes: string[];
  functions: string[];
  indexes: string[];
  standaloneBaseTypes: string[];
  indexDefinitions: string[];
}

export function resolveEmptyDatabaseVerificationConfig(
  env: NodeJS.ProcessEnv
): EmptyDatabaseVerificationConfig {
  if (env.EMPTY_DB_VERIFICATION !== "1") fail("explicit verification opt-in is required");
  if (env.EMPTY_DB_NETWORK_INTERNAL !== "1") fail("internal-network proof is required");
  if (env.EMPTY_DB_HOST_PORT_BINDINGS !== "none") fail("host-port isolation proof is required");

  const expectedDatabase = env.EMPTY_DB_EXPECTED_DATABASE?.trim();
  if (!expectedDatabase) fail("the exact expected database name is required");
  if (!EMPTY_DATABASE_NAME.test(expectedDatabase)) fail("the expected database name is not an isolated random name");
  const expectedSystemIdentifier = env.EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER?.trim() ?? "";
  if (!/^[0-9]{10,}$/u.test(expectedSystemIdentifier)) fail("the expected server system identifier is invalid");
  const forbiddenSystemIdentifiers = (env.EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (forbiddenSystemIdentifiers.length === 0 ||
      forbiddenSystemIdentifiers.some((value) => !/^[0-9]{10,}$/u.test(value)) ||
      new Set(forbiddenSystemIdentifiers).size !== forbiddenSystemIdentifiers.length) {
    fail("the forbidden server system identifier set is invalid");
  }
  if (forbiddenSystemIdentifiers.includes(expectedSystemIdentifier)) {
    fail("the expected server identity is a forbidden source identity");
  }

  let parsed: URL;
  try {
    parsed = new URL(env.DATABASE_URL ?? "");
  } catch {
    fail("the database target is invalid");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("the database target protocol is invalid");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || LOOPBACK_HOSTS.has(host)) fail("loopback database targets are forbidden");
  if (parsed.port !== "") fail("explicit database ports are forbidden");

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  } catch {
    fail("the database name is invalid");
  }
  if (databaseName !== expectedDatabase || !EMPTY_DATABASE_NAME.test(databaseName)) {
    fail("the database name does not match the isolated expected target");
  }
  if (!parsed.username || !parsed.password) fail("database credentials are required");

  const sslMode = parsed.searchParams.get("sslmode") ?? undefined;
  return {
    databaseName,
    expectedSystemIdentifier,
    forbiddenSystemIdentifiers,
    host,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ...(sslMode === undefined ? {} : { sslMode })
  };
}

export async function runEmptyDatabaseMigrationVerification(
  config: EmptyDatabaseVerificationConfig,
  deps: EmptyDatabaseMigrationVerificationDeps
): Promise<EmptyDatabaseMigrationVerificationReport> {
  const expectedMigrations = exactUniqueSorted(deps.expectedMigrationNames, 20, "migration allowlist");
  const expectedTables = exactUniqueSorted(deps.expectedAppTableNames, 25, "application-table allowlist");
  const expectedUserTypes = exactUniqueSorted(deps.expectedUserTypeNames, 31, "user-type allowlist");
  const expectedFunctions = exactUniqueSorted(deps.expectedFunctionNames, 18, "function allowlist");
  const expectedIndexes = exactUniqueSorted(deps.expectedIndexNames, 104, "index allowlist");
  if (!/^[a-f0-9]{64}$/u.test(deps.expectedIndexDefinitionSha256)) fail("index definition digest is invalid");

  const psqlVersion = await execute(deps, psqlCommand(config, deps, "psql-version", ["--version"]));
  if (!/^psql \(PostgreSQL\) 16(?:\.|\s|$)/u.test(psqlVersion.stdout.trim())) {
    fail("the psql client is not PostgreSQL 16");
  }

  const identity = parseJson<TargetIdentityAudit>((await execute(
    deps,
    psqlQuery(config, deps, "preflight-identity", TARGET_IDENTITY_SQL)
  )).stdout, "target identity");
  validateTargetIdentity(identity, config);

  const inventory = parseJson<EmptyInventoryAudit>((await execute(
    deps,
    psqlQuery(config, deps, "preflight-empty-inventory", EMPTY_INVENTORY_SQL)
  )).stdout, "empty inventory");
  if (!Number.isSafeInteger(inventory.publicSchemaObjectCount) || inventory.publicSchemaObjectCount !== 0 ||
      inventory.migrationTableExists !== false ||
      !Number.isSafeInteger(inventory.migrationRowCount) || inventory.migrationRowCount !== 0) {
    fail("the target database is not empty");
  }

  await execute(deps, prismaDeployCommand(config, deps, "first-migrate-deploy"));
  const firstAudit = parseJson<MigrationAudit>((await execute(
    deps,
    psqlQuery(config, deps, "first-post-migration-audit", migratedAuditSql(expectedTables))
  )).stdout, "first migration audit");
  validateMigrationAudit(firstAudit, expectedMigrations, expectedTables, expectedUserTypes, expectedFunctions,
    expectedIndexes, deps.expectedIndexDefinitionSha256);
  const firstSchema = normalizedSchemaHash((await execute(
    deps,
    pgDumpSchemaCommand(config, deps, "first-normalized-schema")
  )).stdout);

  const secondDeploy = await execute(deps, prismaDeployCommand(config, deps, "second-migrate-deploy"));
  if (!/No pending migrations to apply\./u.test(secondDeploy.stdout)) {
    fail("the second migration deploy was not a confirmed no-op");
  }
  const secondAudit = parseJson<MigrationAudit>((await execute(
    deps,
    psqlQuery(config, deps, "second-post-migration-audit", migratedAuditSql(expectedTables))
  )).stdout, "second migration audit");
  validateMigrationAudit(secondAudit, expectedMigrations, expectedTables, expectedUserTypes, expectedFunctions,
    expectedIndexes, deps.expectedIndexDefinitionSha256);
  if (canonicalJson(firstAudit) !== canonicalJson(secondAudit)) {
    fail("the second migration deploy changed database state");
  }
  const secondSchema = normalizedSchemaHash((await execute(
    deps,
    pgDumpSchemaCommand(config, deps, "second-normalized-schema")
  )).stdout);
  if (firstSchema !== secondSchema) fail("the normalized schema is not reproducible");

  return {
    databaseName: config.databaseName,
    serverVersion: identity.serverVersion,
    systemIdentifier: identity.systemIdentifier,
    migrationCount: expectedMigrations.length,
    appTableCount: expectedTables.length,
    allAppTableCountsZero: true,
    normalizedSchemaSha256: firstSchema,
    secondDeployNoop: true
  };
}

const TARGET_IDENTITY_SQL = `SELECT json_build_object(
  'currentDatabase', current_database(),
  'serverVersion', current_setting('server_version'),
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'isTemplate', (SELECT datistemplate FROM pg_database WHERE datname = current_database())
)::text;`;

const EMPTY_INVENTORY_SQL = `SELECT json_build_object(
  'publicSchemaObjectCount', (SELECT count(*) FROM (
    SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    UNION ALL SELECT t.oid FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT o.oid FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT oc.oid FROM pg_catalog.pg_opclass oc JOIN pg_catalog.pg_namespace n ON n.oid = oc.opcnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT of.oid FROM pg_catalog.pg_opfamily of JOIN pg_catalog.pg_namespace n ON n.oid = of.opfnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT co.oid FROM pg_catalog.pg_collation co JOIN pg_catalog.pg_namespace n ON n.oid = co.collnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT cv.oid FROM pg_catalog.pg_conversion cv JOIN pg_catalog.pg_namespace n ON n.oid = cv.connamespace WHERE n.nspname = 'public'
    UNION ALL SELECT st.oid FROM pg_catalog.pg_statistic_ext st JOIN pg_catalog.pg_namespace n ON n.oid = st.stxnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT tc.oid FROM pg_catalog.pg_ts_config tc JOIN pg_catalog.pg_namespace n ON n.oid = tc.cfgnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT td.oid FROM pg_catalog.pg_ts_dict td JOIN pg_catalog.pg_namespace n ON n.oid = td.dictnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT tp.oid FROM pg_catalog.pg_ts_parser tp JOIN pg_catalog.pg_namespace n ON n.oid = tp.prsnamespace WHERE n.nspname = 'public'
    UNION ALL SELECT tt.oid FROM pg_catalog.pg_ts_template tt JOIN pg_catalog.pg_namespace n ON n.oid = tt.tmplnamespace WHERE n.nspname = 'public'
  ) public_schema_objects),
  'migrationTableExists', to_regclass('public._prisma_migrations') IS NOT NULL,
  'migrationRowCount', 0
)::text;`;

function migratedAuditSql(tables: readonly string[]): string {
  const counts = tables.map((table) => `${sqlLiteral(table)}, (SELECT count(*) FROM public.${sqlIdentifier(table)})`).join(", ");
  return `SELECT json_build_object(
    'migrations', (SELECT coalesce(json_agg(json_build_object('migrationName', migration_name, 'finishedAt', finished_at, 'rolledBackAt', rolled_back_at) ORDER BY migration_name COLLATE "C"), '[]'::json) FROM public._prisma_migrations),
    'appTables', (SELECT coalesce(json_agg(table_name ORDER BY table_name COLLATE "C"), '[]'::json) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'),
    'tableCounts', json_build_object(${counts}),
    'nonTableRelations', (SELECT coalesce(json_agg(relname ORDER BY relname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm', 'S', 'c', 'f')),
    'userTypes', (SELECT coalesce(json_agg(typname ORDER BY typname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e', 'r', 'm')),
    'functions', (SELECT coalesce(json_agg(proname ORDER BY proname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'),
    'indexes', (SELECT coalesce(json_agg(idx.relname ORDER BY idx.relname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class idx ON idx.oid = ix.indexrelid JOIN pg_catalog.pg_class tbl ON tbl.oid = ix.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace WHERE n.nspname = 'public' AND tbl.relname <> '_prisma_migrations'),
    'indexDefinitions', (SELECT coalesce(json_agg(pg_catalog.pg_get_indexdef(idx.oid) ORDER BY idx.relname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class idx ON idx.oid = ix.indexrelid JOIN pg_catalog.pg_class tbl ON tbl.oid = ix.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace WHERE n.nspname = 'public' AND tbl.relname <> '_prisma_migrations'),
    'standaloneBaseTypes', (SELECT coalesce(json_agg(typname ORDER BY typname COLLATE "C"), '[]'::json) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'b' AND t.typelem = 0)
  )::text;`;
}

function psqlQuery(config: EmptyDatabaseVerificationConfig, deps: EmptyDatabaseMigrationVerificationDeps,
  stage: string, sql: string): CommandInvocation {
  return psqlCommand(config, deps, stage,
    ["--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command", sql]);
}

function psqlCommand(config: EmptyDatabaseVerificationConfig, deps: EmptyDatabaseMigrationVerificationDeps,
  stage: string, args: string[]): CommandInvocation {
  return { stage, executable: deps.psqlExecutable, args, cwd: deps.projectRoot,
    env: postgresEnv(config), shell: false };
}

function pgDumpSchemaCommand(config: EmptyDatabaseVerificationConfig,
  deps: EmptyDatabaseMigrationVerificationDeps, stage: string): CommandInvocation {
  return { stage, executable: deps.pgDumpExecutable,
    args: ["--schema-only", "--schema=public", "--no-owner", "--no-privileges", "--quote-all-identifiers"],
    cwd: deps.projectRoot, env: postgresEnv(config), shell: false };
}

function prismaDeployCommand(config: EmptyDatabaseVerificationConfig,
  deps: EmptyDatabaseMigrationVerificationDeps, stage: string): CommandInvocation {
  return { stage, executable: deps.nodeExecutable,
    args: [deps.prismaCliPath, "migrate", "deploy", `--schema=${resolve(deps.projectRoot, "prisma", "schema.prisma")}`],
    cwd: deps.projectRoot, env: { DATABASE_URL: databaseUrl(config) }, shell: false };
}

function postgresEnv(config: EmptyDatabaseVerificationConfig): Record<string, string> {
  return {
    PGHOST: config.host,
    PGDATABASE: config.databaseName,
    PGUSER: config.username,
    PGPASSWORD: config.password,
    ...(config.sslMode === undefined ? {} : { PGSSLMODE: config.sslMode })
  };
}

function databaseUrl(config: EmptyDatabaseVerificationConfig): string {
  const url = new URL("postgresql://empty.invalid/");
  url.username = config.username;
  url.password = config.password;
  url.hostname = config.host;
  url.pathname = `/${config.databaseName}`;
  url.searchParams.set("schema", "public");
  if (config.sslMode !== undefined) url.searchParams.set("sslmode", config.sslMode);
  return url.toString();
}

async function execute(deps: EmptyDatabaseMigrationVerificationDeps,
  invocation: CommandInvocation): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await deps.runCommand(invocation);
  } catch {
    fail(`command stage ${invocation.stage} failed`);
  }
  if (result.status !== 0 || result.error) fail(`command stage ${invocation.stage} failed`);
  return result;
}

function validateTargetIdentity(identity: TargetIdentityAudit, config: EmptyDatabaseVerificationConfig): void {
  if (identity.currentDatabase !== config.databaseName) fail("the server selected a different database");
  if (!/^16(?:\.|$)/u.test(identity.serverVersion)) fail("the target server is not PostgreSQL 16");
  if (!/^[0-9]{10,}$/u.test(identity.systemIdentifier)) fail("the server system identifier is invalid");
  if (identity.systemIdentifier !== config.expectedSystemIdentifier ||
      config.forbiddenSystemIdentifiers.includes(identity.systemIdentifier)) {
    fail("the server identity does not match the externally provisioned isolated target");
  }
  if (identity.isTemplate !== false) fail("template databases are forbidden");
}

function validateMigrationAudit(audit: MigrationAudit, expectedMigrations: readonly string[],
  expectedTables: readonly string[], expectedUserTypes: readonly string[], expectedFunctions: readonly string[],
  expectedIndexes: readonly string[], expectedIndexDefinitionSha256: string): void {
  if (!Array.isArray(audit.migrations) || !Array.isArray(audit.appTables) ||
      !audit.tableCounts || typeof audit.tableCounts !== "object" ||
      !Array.isArray(audit.nonTableRelations) || !Array.isArray(audit.userTypes) ||
      !Array.isArray(audit.functions) || !Array.isArray(audit.indexes) ||
      !Array.isArray(audit.standaloneBaseTypes) || !Array.isArray(audit.indexDefinitions)) {
    fail("the migration audit is invalid");
  }
  const migrations = audit.migrations.map((row) => row.migrationName).sort(compareUtf8);
  if (canonicalJson(migrations) !== canonicalJson(expectedMigrations) ||
      audit.migrations.some((row) => !row.finishedAt || row.rolledBackAt !== null)) {
    fail("the applied migration set is incomplete or rolled back");
  }
  const tables = [...audit.appTables].sort(compareUtf8);
  if (canonicalJson(tables) !== canonicalJson(expectedTables) ||
      canonicalJson(Object.keys(audit.tableCounts).sort(compareUtf8)) !== canonicalJson(expectedTables) ||
      expectedTables.some((table) => audit.tableCounts[table] !== 0)) {
    fail("the application table contract or zero-row invariant failed");
  }
  if (audit.nonTableRelations.length !== 0 ||
      canonicalJson([...audit.userTypes].sort(compareUtf8)) !== canonicalJson(expectedUserTypes) ||
      canonicalJson([...audit.functions].sort(compareUtf8)) !== canonicalJson(expectedFunctions) ||
      canonicalJson([...audit.indexes].sort(compareUtf8)) !== canonicalJson(expectedIndexes) ||
      audit.standaloneBaseTypes.length !== 0 ||
      sha256Lines(audit.indexDefinitions) !== expectedIndexDefinitionSha256) {
    fail("the non-table public schema object contract failed");
  }
}

function sha256Lines(values: readonly string[]): string {
  return createHash("sha256").update(values.join("\n"), "utf8").digest("hex");
}

function exactUniqueSorted(values: readonly string[], count: number, label: string): string[] {
  const sorted = [...values].sort(compareUtf8);
  if (sorted.length !== count || new Set(sorted).size !== count || sorted.some((value) => !value.trim())) {
    fail(`${label} is invalid`);
  }
  return sorted;
}

function normalizedSchemaHash(value: string): string {
  const normalized = value.split(/\r?\n/u)
    .filter((line) => !/^\\(?:un)?restrict\s/u.test(line) && !/^-- Dumped (?:from|by) /u.test(line))
    .map((line) => line.trimEnd()).join("\n").trim() + "\n";
  if (normalized === "\n") fail("the normalized schema is empty");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value.trim()) as T; } catch { fail(`${label} output is invalid`); }
}

function sqlIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function sqlLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function canonicalJson(value: unknown): string { return JSON.stringify(value); }
function compareUtf8(left: string, right: string): number { return Buffer.from(left).compare(Buffer.from(right)); }

function fail(message: string): never {
  throw new Error(`Empty database migration verification refused: ${message}`);
}
