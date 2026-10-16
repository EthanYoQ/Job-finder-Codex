import {hengruiTestCacheDir} from '../test/hengrui-test-cache.mjs';
import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['connector-gate/hengrui*.test.ts'],fileParallelism:false,testTimeout:60000,hookTimeout:60000,pool:'forks',maxWorkers:1,minWorkers:1},cacheDir:hengruiTestCacheDir('connector')});
