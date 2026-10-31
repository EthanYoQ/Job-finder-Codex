import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, symlink, writeFile, rm} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile), source = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('static reviewer patch relocates the actual original gates without changing the old tree', async () => {
  const patch = fileURLToPath(new URL('./reviewer-paths.patch', import.meta.url));
  const files = [...(await readFile(patch, 'utf8')).matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]);
  const root = await mkdtemp(join(tmpdir(), 'instabox-reviewer-'));
  try {
    for (const file of files) {
      await mkdir(dirname(join(root, file)), {recursive: true});
      await copyFile(join(source, file), join(root, file));
    }
    const vendor = 'five-source-sequence-source-candidate-20261016T1235Z';
    await symlink(join(source, vendor), join(root, vendor), 'dir');
    await exec('git', ['apply', patch], {cwd: root});
    for (const file of files) assert(!(await readFile(join(root, file), 'utf8')).includes('/workspace/scratch/5e9614251709'));
    const gates = 'takeda-original-recovery-20261017T0417Z/offline-checkers';
    const code = `
      import assert from 'node:assert/strict';
      import {readOriginalWrapperDeadline} from './${gates}/original-wrapper-deadline.mjs';
      for (const [file, name] of [
        ['original-portable-sql-review.mts','reviewOriginalPortableSql'],
        ['biogen-packet-gate.mts','reviewBiogenPacket'],
        ['hengrui-packet-gate.mts','reviewHengruiPacket'],
        ['original-portable-reader-replay.mts','replayOriginalPortableReaders'],
        ['moka-archive-request.mts','assertMokaArchivedRequest']
      ]) assert.equal(typeof (await import('./${gates}/'+file))[name], 'function');
      assert.equal(readOriginalWrapperDeadline(${JSON.stringify(join(root, 'takeda-original-recovery-20261017T0417Z/biogen/new-test-run'))}, 'biogen'), 1800000);
    `;
    const run = join(root, 'takeda-original-recovery-20261017T0417Z/biogen/new-test-run/diagnostics');
    await mkdir(run, {recursive: true});
    await writeFile(join(run, 'process.jsonl'), [
      {event:'WRAPPER_START',timeoutMs:1800000,wrapperPid:100,outerDeadline:1800000,recordedAt:'1970-01-01T00:00:00.000Z'},
      {event:'CHILD_STARTED',wrapperPid:100,childPid:101}
    ].map(JSON.stringify).join('\n'));
    await writeFile(join(root, 'check.mjs'), code);
    await exec(process.execPath, ['--import', join(source, vendor, 'tools/dot-auto-controller/vendor/c60-source/node_modules/tsx/dist/loader.mjs'), join(root, 'check.mjs')], {cwd: root});
  } finally { await rm(root, {recursive: true, force: true}); }
});
