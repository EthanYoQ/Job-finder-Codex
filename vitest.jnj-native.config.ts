import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
 server: { fs: { allow: [resolve("..")]} },
 test: {environment:"node",maxWorkers:1,include:["tests/crawler/jnjCareersDomEvidence.test.ts","tests/crawler/jnjNativeUrlProfile.test.ts","tests/domain/jnjNativeReaderCompatibility.test.ts","tests/prisma/jnjDomEvidenceMigration.test.ts","tests/prisma/jnjNativeUrlMigration.test.ts","tests/db/jnjDomPreflightExpectation.test.ts"]}
});
