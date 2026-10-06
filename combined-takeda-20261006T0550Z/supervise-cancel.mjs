// Review-only, Linux, local-file cancellation. Never imported by the producer/host.
import { spawn } from 'node:child_process';
import { constants as F, closeSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { constants as O } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const R2 = '/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z';
const allowedWrappers = ['producer42', 'hansoh-grace-candidate-20261006T0103Z']
  .map(p => join(R2, p, 'scripts/run-with-http-diagnostics.mjs'));
const wrapperSha256 = 'd8627edbdc118f8d747f77f22459768f76184171e715a8fd29c76a69a3c82930';
const [mode, directory, runId, separator, command, ...argv] = process.argv.slice(2);
if (!['start', 'request'].includes(mode) || !directory || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId ?? ''))
  throw Error('Usage: start <new-control-dir> <run-id> -- <original-node> <original-wrapper> <diagnostics> <timeout> -- <inner-command> [args...] | request <control-dir> <run-id>');
const root = resolve(directory);
if (realpathSync(dirname(root)) !== dirname(root)) throw Error('SYMLINK_PARENT_REFUSED');
if (mode === 'start') mkdirSync(root, { mode: 0o700 }); // Exclusive; never adopt an old run.
const dirFd = openSync(root, F.O_RDONLY | F.O_DIRECTORY | F.O_NOFOLLOW);
const dirStat = fstatSync(dirFd);
if (dirStat.uid !== process.getuid() || (dirStat.mode & 0o777) !== 0o700) throw Error('UNSAFE_CONTROL_DIRECTORY');
// Anchor all file operations to the opened directory, including if its name moves.
const anchored = name => `/proc/self/fd/${dirFd}/${name}`;
const assertRoot = () => {
  const current = lstatSync(root);
  if (!current.isDirectory() || current.dev !== dirStat.dev || current.ino !== dirStat.ino)
    throw Error('CONTROL_DIRECTORY_REPLACED');
};
const readJson = name => {
  assertRoot();
  const fd = openSync(anchored(name), F.O_RDONLY | F.O_NOFOLLOW | F.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.nlink !== 1 || s.size > 2048)
      throw Error('UNSAFE_CONTROL_FILE');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
};
const writeJson = (name, value) => {
  const fd = openSync(anchored(name), F.O_WRONLY | F.O_CREAT | F.O_EXCL | F.O_NOFOLLOW, 0o600);
  try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  fsyncSync(dirFd);
};
const readIdentity = pid => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { ppid: Number(fields[1]), startTicks: fields[19] };
};
if (mode === 'request') {
  if (separator || command || argv.length) throw Error('REQUEST_TAKES_NO_COMMAND_OR_PID');
  const d = readJson('descriptor.json');
  if (d.schemaVersion !== 1 || d.runId !== runId || !/^[a-f0-9]{64}$/.test(d.nonce ?? '') ||
      !Number.isSafeInteger(d.startedAtMs)) throw Error('DESCRIPTOR_MISMATCH');
  // This branch never sends a signal. The live supervisor owns target validation.
  const temp = `request-${randomBytes(12).toString('hex')}.tmp`;
  writeJson(temp, { schemaVersion: 1, runId, nonce: d.nonce, action: 'SIGTERM', requestedAtMs: Date.now() });
  try { assertRoot(); linkSync(anchored(temp), anchored('cancel.json')); }
  finally { unlinkSync(anchored(temp)); fsyncSync(dirFd); }
  console.log('CANCEL_REQUEST_WRITTEN');
  closeSync(dirFd);
} else {
  if (separator !== '--' || !command || realpathSync(command) !== process.execPath ||
      !allowedWrappers.includes(argv[0]) || realpathSync(argv[0]) !== argv[0] ||
      createHash('sha256').update(readFileSync(argv[0])).digest('hex') !== wrapperSha256 ||
      argv[3] !== '--' || !argv[4]) throw Error('ORIGINAL_WRAPPER_COMMAND_REQUIRED');
  const startedAtMs = Date.now(), nonce = randomBytes(32).toString('hex');
  const lifecycle = openSync(anchored('supervisor.jsonl'), F.O_WRONLY | F.O_CREAT | F.O_EXCL, 0o600);
  const mark = (event, extra = {}) => {
    writeSync(lifecycle, JSON.stringify({ event, recordedAt: new Date().toISOString(), runId, ...extra }) + '\n');
    fsyncSync(lifecycle);
  };
  // Pass original argv, environment, cwd and foreground stdio through unchanged.
  const child = spawn(command, argv, { shell: false, stdio: 'inherit', env: process.env, detached: false });
  let identity, poll, closed = false, sent = false, lastRejection;
  child.once('spawn', () => {
    identity = readIdentity(child.pid);
    if (identity.ppid !== process.pid) throw Error('SPAWN_IDENTITY_MISMATCH');
    writeJson('descriptor.json', { schemaVersion: 1, runId, nonce, startedAtMs,
      supervisorPid: process.pid, wrapperPid: child.pid, startTicks: identity.startTicks, wrapperSha256 });
    mark('SUPERVISOR_READY', { wrapperPid: child.pid, startTicks: identity.startTicks });
    poll = setInterval(() => {
      if (closed || sent) return;
      try {
        const r = readJson('cancel.json'), now = Date.now();
        if (Object.keys(r).sort().join(',') !== 'action,nonce,requestedAtMs,runId,schemaVersion' ||
            r.schemaVersion !== 1 || r.action !== 'SIGTERM') throw Error('CANCEL_SCHEMA_MISMATCH');
        if (r.runId !== runId) throw Error('CANCEL_RUN_MISMATCH');
        if (r.nonce !== nonce) throw Error('CANCEL_NONCE_MISMATCH');
        if (!Number.isSafeInteger(r.requestedAtMs) || r.requestedAtMs < startedAtMs ||
            r.requestedAtMs > now || now - r.requestedAtMs > 60_000) throw Error('CANCEL_TIME_MISMATCH');
        // spawn only proves exec succeeded; wait until the unchanged wrapper has
        // installed its handlers and fsynced CHILD_STARTED before sending.
        const wrapperEvents = readFileSync(join(resolve(argv[1]), 'process.jsonl'), 'utf8')
          .trim().split('\n').map(JSON.parse);
        if (!wrapperEvents.some(e => e.event === 'CHILD_STARTED' && e.wrapperPid === child.pid)) return;
        // Never use a PID from disk; signal only this unreaped ChildProcess.
        const current = readIdentity(child.pid);
        if (closed || child.exitCode !== null || child.signalCode !== null ||
            current.ppid !== process.pid || current.startTicks !== identity.startTicks)
          throw Error('WRAPPER_IDENTITY_CHANGED');
        sent = true;
        mark('CANCEL_ACCEPTED', { wrapperPid: child.pid, startTicks: identity.startTicks });
        mark('SIGNAL_SENT', { signal: 'SIGTERM', accepted: child.kill('SIGTERM') });
      } catch (e) {
        if (e.code === 'ENOENT') return;
        const reason = e.code ?? e.message;
        if (reason !== lastRejection) { mark('CANCEL_REJECTED', { reason }); lastRejection = reason; }
      }
    }, 50);
  });
  child.once('error', e => mark('WRAPPER_SPAWN_ERROR', { code: e.code }));
  child.once('close', (code, signal) => {
    closed = true; clearInterval(poll);
    const exitCode = code ?? (signal ? 128 + (O.signals[signal] ?? 1) : 127);
    mark('WRAPPER_EXIT', { wrapperPid: child.pid ?? null, code, signal, supervisorExitCode: exitCode });
    closeSync(lifecycle); closeSync(dirFd); process.exitCode = exitCode;
  });
}
