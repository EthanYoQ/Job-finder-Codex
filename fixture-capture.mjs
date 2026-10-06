// Synthetic only: no network, database, producer imports, or persistent state.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const duration = Number(process.env.SYNTHETIC_DURATION_MS || 6300);
const exitCode = Number(process.env.SYNTHETIC_EXIT_CODE || 0);
const memory = Buffer.alloc(16 * 1024 * 1024, 41);
const child = spawn(process.execPath, ['-e', 'const b=Buffer.alloc(24*1024*1024,17);setTimeout(()=>{console.log("SYNTHETIC_CHILD_EXIT",b[0])},'+duration+');'], {stdio:['ignore','pipe','pipe']});
if (process.env.SYNTHETIC_RECEIPT) writeFileSync(process.env.SYNTHETIC_RECEIPT, JSON.stringify({argv:process.argv.slice(2),sourceId:process.env.JOBFINDER_CLOUD_SOURCE_ID,rootPid:process.pid,childPid:child.pid}));
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('exit', () => { console.log('SYNTHETIC_CAPTURE_EXIT', exitCode, memory[0]); process.exitCode = exitCode; });
