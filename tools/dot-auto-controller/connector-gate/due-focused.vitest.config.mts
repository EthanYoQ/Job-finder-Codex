import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['connector-gate/takeda-due-policy.focused.test.ts'],fileParallelism:false,testTimeout:10000,hookTimeout:10000,pool:'forks',maxWorkers:1,minWorkers:1},cacheDir:'.due-test-cache'});
