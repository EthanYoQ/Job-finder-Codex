// Test-only local child with a fixed natural exit. No network or descendants.
import { writeFileSync } from 'node:fs';
const [ready,duration,exitText,signalMode]=process.argv.slice(2);
if(signalMode==='graceful')process.once('SIGTERM',()=>process.exit(42));
writeFileSync(ready,JSON.stringify({pid:process.pid,wrapperPid:process.ppid,startedAt:Date.now()})+'\n',{flag:'wx',mode:0o600});
setTimeout(()=>process.exit(Number(exitText)),Number(duration));
