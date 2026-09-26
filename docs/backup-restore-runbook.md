# Backup and restore runbook

The production Compose stack runs `ops/backup.sh` daily, retains 7–14 days, and publishes three files per backup: the custom PostgreSQL archive, metadata JSON, and the `.sha256` commit marker written last. The metadata records the source PostgreSQL server version and tool versions; no database URL or credential is written.

## Verify a backup

Run the qualification command from the same locked production image. Use an admin URL that connects to the same PostgreSQL 16 server's `postgres` database and has `CREATE DATABASE`/`DROP DATABASE` for temporary names only.

```sh
BACKUP_FILE=/backups/jobfinder-YYYYMMDDTHHMMSSZ.dump \
RESTORE_ADMIN_DATABASE_URL='postgresql://...@postgres:5432/postgres' \
RESTORE_RECEIPT_PATH=/restore-state/restore-receipt.json \
npm run ops:qualify-restore -- "$BACKUP_FILE"
```

The command verifies the checksum and metadata, creates a random `jobfinder_restore_*` database, restores the archive transactionally, checks migrations plus formal-batch/certificate/trusted-visible-job relationships, atomically writes a content-hashed Restore Receipt, and drops the temporary database in `finally`.

## Failure handling

- Any nonzero exit means the backup is not qualified; do not use it for launch or disaster recovery.
- Preserve the archive, metadata, checksum and command error; do not print or copy the database URL.
- Correct storage corruption, PostgreSQL major-version mismatch, permissions, or relationship failures, create a new backup, then rerun qualification.
- The monitor treats a missing, invalid, failed, or older-than-eight-days Restore Receipt as critical. Do not hand-edit a receipt.

The stack does not provide off-site or cross-region disaster recovery. Copying qualified artifacts off-site is an operator decision outside this release scope.
