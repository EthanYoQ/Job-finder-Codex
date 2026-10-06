// No network/DB/descendants. Every fixture has its own natural exit bound.
import { writeFileSync } from 'node:fs';
const [mode,readyFile]=process.argv.slice(2);
if(!['normal','graceful','default','replacement','timeout'].includes(mode))throw Error('FIXTURE_MODE');
const memory=Buffer.alloc(8*1024*1024,23);
const duration=mode==='normal'?6300:mode==='replacement'?1700:11000;
setTimeout(()=>{console.log('SYNTHETIC_NATURAL_EXIT',memory[0]);process.exit(mode==='normal'||mode==='replacement'?0:97);},duration);
if(mode==='graceful')process.once('SIGTERM',()=>{console.log('SYNTHETIC_SIGTERM');process.exit(42);});
writeFileSync(readyFile,JSON.stringify({pid:process.pid,mode,argv:process.argv.slice(2),cwd:process.cwd(),syntheticEnv:process.env.SYNTHETIC_PRESERVED_ENV})+'\n',{flag:'wx',mode:0o600});
