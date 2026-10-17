import {defineConfig} from 'vitest/config';
import {tmpdir} from 'node:os';import {join} from 'node:path';
export default defineConfig({test:{environment:'node',include:['test/ucb-phenom.test.ts','connector-gate/ucb-due-policy.test.ts','connector-gate/ucb-pipe-protocol.test.ts','test/ucb-selection.test.ts'],fileParallelism:false,testTimeout:60000,pool:'forks',maxWorkers:1,minWorkers:1},cacheDir:join(tmpdir(),'jobfinder-ucb-native-cache-'+process.pid)});
