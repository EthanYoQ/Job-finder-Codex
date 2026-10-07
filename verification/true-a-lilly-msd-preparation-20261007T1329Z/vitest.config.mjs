import {fileURLToPath} from 'node:url';
export default {root:fileURLToPath(new URL('../../producer',import.meta.url)),cacheDir:'../verification/true-a-lilly-msd-preparation-20261007T1329Z/vitest-cache',test:{environment:'node',include:['tests/crawler/lillyChinaQuality.test.ts','tests/crawler/msdAjingaSourceFetch.test.ts'],maxWorkers:1,fileParallelism:false,testTimeout:30000,cache:false}};
