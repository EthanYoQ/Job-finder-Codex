import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['-e','const b=Buffer.alloc(8*1024*1024,1);setTimeout(()=>{if(b.length!==8388608)process.exitCode=2},650)'],{stdio:'ignore'});
child.on('exit',()=>process.exit(Number(process.argv[2]??0)));
