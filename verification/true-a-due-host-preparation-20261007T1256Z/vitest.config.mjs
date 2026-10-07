import {fileURLToPath} from 'node:url';
export default {
 root: fileURLToPath(new URL('../../producer',import.meta.url)),
 cacheDir: '../verification/true-a-due-host-preparation-20261007T1256Z/vitest-cache',
 test: {environment:'node', include:['tests/crawler/workdaySourceFetch.test.ts','tests/crawler/hotjobLegacySourceFetch.test.ts','tests/crawler/completenessCertificate.test.ts','tests/crawler/sourcePlan.test.ts','tests/crawler/humanVerifiedScopeProfiles.test.ts'], maxWorkers:1, fileParallelism:false, testTimeout:30000, hookTimeout:30000, cache:false}
};
