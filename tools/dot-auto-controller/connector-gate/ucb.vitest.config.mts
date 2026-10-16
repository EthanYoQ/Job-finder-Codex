import {defineConfig} from 'vitest/config';
import {tmpdir} from 'node:os';import {join} from 'node:path';
export default defineConfig({test:{environment:'node',include:['connector-gate/ucb*.test.ts'],fileParallelism:false,testTimeout:90000,hookTimeout:90000,pool:'forks',maxWorkers:1,minWorkers:1},cacheDir:join(tmpdir(),'jobfinder-ucb-connector-cache-'+process.pid)});
