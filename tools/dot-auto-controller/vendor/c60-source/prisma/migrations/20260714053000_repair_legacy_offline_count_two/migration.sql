-- Preserve hidden visibility while aligning legacy lifecycle rows with the
-- current rule: the second trusted miss is SUSPECTED_OFFLINE; OFFLINE begins
-- with the third trusted miss. Do not reactivate or delete any job here.
UPDATE "Job"
SET "lifecycleStatus" = 'SUSPECTED_OFFLINE'
WHERE "lifecycleStatus" = 'OFFLINE'
  AND "missingSuccessCount" = 2;
