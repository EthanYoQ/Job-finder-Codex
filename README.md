# Collector source fix

Four unchanged source, patch, and synthetic-test files, 10,330 bytes. Source inventory SHA-256: `b2626ff0c9791d2748f5234f62c2dbbd99ec22d689ea9d8a3e845e652ae235a7`. SOURCE_BACKUP.json lists this branch's files; verify SHA256SUMS before restoration.

Keep collector-before.js, collector-fixed.js, and test-collector.cjs in the same directory. The synthetic test source uses Node.js built-in modules. The collector itself needs a separately supplied browser execution context, which is not included here.

Captured pages, browser/session state, configuration, credentials, actual results, and operational reports are excluded. This source backup does not claim test execution or browser validation.
