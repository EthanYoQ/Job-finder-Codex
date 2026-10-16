import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';import {join} from 'node:path';
export default defineConfig({test:{environment:'node',include:['connector-gate/viatris*.test.ts','test/viatris*.test.ts'],fileParallelism:false,testTimeout:90000,hookTimeout:90000,pool:'forks',poolOptions:{forks:{execArgv:['--require',fileURLToPath(new URL('../test/no-network.cjs',import.meta.url))]}},maxWorkers:1,minWorkers:1},cacheDir:join(tmpdir(),'jobfinder-viatris-connector-cache-'+process.pid)});
