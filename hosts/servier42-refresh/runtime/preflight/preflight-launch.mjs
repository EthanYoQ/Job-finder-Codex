import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const here = dirname(fileURLToPath(import.meta.url));
const fail = code => { throw Error(code); };

export async function noLinks(path) {
  const absolute = resolve(path), segments = absolute.slice(parse(absolute).root.length).split('/');
  let cursor = parse(absolute).root;
  for (const part of segments) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) fail('PREFLIGHT_SYMLINK'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  return absolute;
}

export async function writableDirectory(path) {
  const absolute = await noLinks(path);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const stat = await lstat(absolute);
  if (!stat.isDirectory() || !(stat.mode & 0o222) || await realpath(absolute) !== absolute) fail('PREFLIGHT_DIRECTORY_NOT_WRITABLE');
  await access(absolute, constants.R_OK | constants.W_OK | constants.X_OK);
  const probe = join(absolute, `.startup-write-${randomUUID()}`);
  const handle = await open(probe, 'wx', 0o600);
  try { await handle.writeFile('LOCAL_STARTUP_WRITE_CHECK'); await handle.sync(); }
  finally { await handle.close(); await unlink(probe); }
  return absolute;
}

async function regularFile(path) {
  const absolute = await noLinks(path);
  if (!(await lstat(absolute)).isFile()) fail('PREFLIGHT_REGULAR_FILE_REQUIRED');
  await access(absolute, constants.R_OK);
  return { path: absolute, bytes: await readFile(absolute) };
}

export function validateBootstrapShape(bootstrap) {
  const base = ['batchId', 'candidateRows', 'checkedAt', 'schemaVersion'];
  const optional = ['independentValidation', 'currentCapture', 'retainedCapture'];
  if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap) || bootstrap.schemaVersion !== 1 || base.some(key => !(key in bootstrap)) || Object.keys(bootstrap).some(key => !base.includes(key) && !optional.includes(key)) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId) || !Array.isArray(bootstrap.candidateRows) || bootstrap.candidateRows.length !== 1) fail('PREFLIGHT_BOOTSTRAP_SCHEMA');
  if (bootstrap.currentCapture && bootstrap.retainedCapture) fail('PREFLIGHT_MULTIPLE_CAPTURE_INPUTS');
  return optional.filter(key => key in bootstrap).map(key => {
    const value = bootstrap[key];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'path,sha256' || typeof value.path !== 'string' || value.path.length === 0 || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) fail('PREFLIGHT_OPTIONAL_INPUT_SCHEMA:' + key);
    return [key, value];
  });
}

export async function preflight(args) {
  const [mode, configPath, controlPath, bootstrapPath, reviewedSha256, outputPath, ...extra] = args;
  if (!['check', 'launch'].includes(mode) || !outputPath || extra.length || !/^[a-f0-9]{64}$/.test(reviewedSha256 ?? '')) fail('Usage: preflight-launch.mjs <check|launch> <host-config.json> <control-base.json> <bootstrap.json> <reviewed-bootstrap-sha256> <new-run-root>');
  const files = await Promise.all([configPath, controlPath, bootstrapPath].map(regularFile));
  const [configFile, controlFile, bootstrapFile] = files;
  if (sha(bootstrapFile.bytes) !== reviewedSha256) fail('PREFLIGHT_BOOTSTRAP_HASH');
  const cfg = JSON.parse(configFile.bytes), control = JSON.parse(controlFile.bytes), bootstrap = JSON.parse(bootstrapFile.bytes);
  if (!cfg.repo || !cfg.root || !cfg.sourceId || !/^[a-f0-9]{64}$/.test(cfg.sourceConfigSha256) || cfg.project !== control.projectId) fail('PREFLIGHT_HOST_CONFIG');
  const repo = await noLinks(cfg.repo), host = await noLinks(cfg.root), root = await noLinks(outputPath);
  if (await realpath(repo) !== repo || await realpath(host) !== host || dirname(configFile.path) !== host) fail('PREFLIGHT_HOST_PATH_BINDING');
  if (root === repo || root.startsWith(repo + '/') || root === host) fail('PREFLIGHT_OUTPUT_INSIDE_FROZEN_REPOSITORY');
  const optionalInputs = validateBootstrapShape(bootstrap);
  if (mode !== 'check' && optionalInputs.length) fail('PREFLIGHT_OPTIONAL_INPUT_REQUIRES_REVIEWED_SOURCE_LAUNCH');
  for (const [name, descriptor] of optionalInputs) {
    const input = await regularFile(descriptor.path);
    if (sha(input.bytes) !== descriptor.sha256) fail('PREFLIGHT_OPTIONAL_INPUT_HASH:' + name);
    files.push(input);
  }
  const row = bootstrap.candidateRows[0];
  if (row.id !== control.candidate?.id || row.version !== control.candidate?.version || row.goalId !== control.candidate?.goalId || row.commitSha !== control.build?.commitSha) fail('PREFLIGHT_CANDIDATE_BINDING');
  if (!/^[a-f0-9]{40}$/.test(control.build?.commitSha ?? '')) fail('PREFLIGHT_COMMIT');
  const gitOptions = { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 15000 };
  if ((await execute('git', ['rev-parse', 'HEAD'], gitOptions)).stdout.trim() !== control.build.commitSha) fail('PREFLIGHT_FROZEN_COMMIT');
  if ((await execute('git', ['status', '--porcelain'], gitOptions)).stdout.trim()) fail('PREFLIGHT_DIRTY_PRODUCER');
  for (const name of ['node_modules/tsx/dist/loader.mjs', 'node_modules/zod/package.json', 'node_modules/cheerio/package.json', 'scripts/run-with-http-diagnostics.mjs', 'scripts/p0-cloud-portable-source-pilot.ts', 'scripts/p0-cloud-source-pilot.ts', 'scripts/capture-servier-b-source.ts']) await regularFile(join(repo, name));
  const diagnostics = join(root, 'diagnostics');
  try { await lstat(diagnostics); fail('PREFLIGHT_DIAGNOSTICS_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writableDirectory(root);
  const artifacts = await writableDirectory(join(root, 'artifacts'));
  const relay = await writableDirectory(join(root, 'relay'));
  if ((await readdir(artifacts)).length || (await readdir(relay)).length) fail('PREFLIGHT_OUTPUT_NOT_EMPTY');
  const checks = await writableDirectory(join(root, 'preflight'));
  const smokeRoot = await mkdtemp(join(artifacts, '.startup-archive-check-'));
  await writableDirectory(smokeRoot);
  const helper = await execute(process.execPath, ['--max-old-space-size=256', '--import', join(repo, 'node_modules/tsx/dist/loader.mjs'), join(here, 'runtime-check.mjs'), configFile.path, controlFile.path, bootstrapFile.path, smokeRoot], {
    cwd: repo, env: { ...process.env, TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', JOBFINDER_CLOUD_SOURCE_ID: cfg.sourceId }, timeout: 45000, maxBuffer: 100000
  });
  const runtime = JSON.parse(helper.stdout);
  const storage=await statfs(artifacts);runtime.archiveTarget={path:artifacts,availableBytes:Number(storage.bavail)*Number(storage.bsize),sampleRemovedAfterVerified:true};
  await rm(smokeRoot,{recursive:true});
  for (const file of files) if (sha(await readFile(file.path)) !== sha(file.bytes)) fail('PREFLIGHT_INPUT_CHANGED');
  const ageMs = Date.now() - Date.parse(bootstrap.checkedAt), bootstrapFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 60000;
  const command = [process.execPath, 'scripts/run-with-http-diagnostics.mjs', diagnostics, '1800000', '--', process.execPath, '--max-old-space-size=256', '--import', './node_modules/tsx/dist/loader.mjs', 'scripts/p0-cloud-portable-source-pilot.ts', bootstrapFile.path, reviewedSha256, artifacts, relay];
  const report = { schemaVersion: 1, purpose: 'NON_QUALIFYING_LOCAL_STARTUP_DIAGNOSTIC', checkedAt: new Date().toISOString(), mode, localChecksPassed: true, bootstrapFresh, bootstrapAgeMs: ageMs, launchPermitted: bootstrapFresh, sourceId: cfg.sourceId, sourceConfigSha256: cfg.sourceConfigSha256, candidateId: row.id, cwd: repo, outputRoot: root, diagnosticsMustBeCreatedByOriginalWrapper: diagnostics, inputs: files.map(file => ({ path: file.path, sha256: sha(file.bytes) })), runtime, command, noNetworkDuringPreflight: true, noDatabaseDuringPreflight: true };
  const reportPath = join(checks, `preflight-${randomUUID()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (mode === 'launch' && !bootstrapFresh) fail(`PREFLIGHT_BOOTSTRAP_STALE:${reportPath}`);
  return { report, reportPath, config: cfg };
}

async function main() {
  const { report, reportPath, config } = await preflight(process.argv.slice(2));
  console.log(JSON.stringify({ reportPath, localChecksPassed: true, launchPermitted: report.launchPermitted, mode: report.mode, archiveSmoke: report.runtime.archiveSmoke }));
  if (report.mode === 'check') return;
  // Recheck immutable input hashes and the real DB-read timestamp immediately before spawn.
  for (const file of report.inputs) if (sha(await readFile(file.path)) !== file.sha256) fail('PREFLIGHT_INPUT_CHANGED');
  const bootstrap = JSON.parse(await readFile(report.inputs[2].path));
  if (Date.now() - Date.parse(bootstrap.checkedAt) > 60000 || Date.now() < Date.parse(bootstrap.checkedAt)) fail('PREFLIGHT_BOOTSTRAP_STALE');
  await writeFile(join(report.outputRoot, 'launch-intent.json'), JSON.stringify({ reportPath, startedAt: new Date().toISOString(), command: report.command }), { flag: 'wx', mode: 0o600 });
  const [command, ...args] = report.command;
  const child = spawn(command, args, { cwd: report.cwd, stdio: 'inherit', detached: false, env: { ...process.env, TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', JOBFINDER_CLOUD_SOURCE_ID: config.sourceId, P0_SOURCE_HTTP_TIMEOUT_MS: '45000' } });
  const signal = name => { if (child.pid) child.kill(name); };
  process.on('SIGTERM', () => signal('SIGTERM')); process.on('SIGINT', () => signal('SIGINT'));
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, killed) => { process.exitCode = code ?? (killed ? 1 : 0); resolve(); }); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ preflightFailed: true, code: error.message })); process.exitCode = 1; });
