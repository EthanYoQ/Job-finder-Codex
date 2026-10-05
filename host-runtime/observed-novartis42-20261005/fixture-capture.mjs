import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const exitCode = Number(process.argv[2]);
const marker = process.argv[3];
const child = spawn(process.execPath, ['-e', 'const b=Buffer.alloc(8*1024*1024,1);setTimeout(()=>{if(b.length!==8388608)process.exitCode=2},1100)'], { stdio: 'ignore' });
child.on('exit', code => {
  writeFileSync(marker, JSON.stringify({ childExit: code, targetExit: exitCode, completed: true }) + '\n');
  process.exit(code === 0 ? exitCode : 99);
});
