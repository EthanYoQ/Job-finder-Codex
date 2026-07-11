# Migration validation

## Existing-clone procedure

Record row counts and checksums before migration, back up the database, then run:

`prisma migrate resolve --applied 20260710000000_baseline`

Apply pending migrations and compare the post-migration row counts and checksums with the recorded baseline.

## Empty-database procedure

Create an empty PostgreSQL database, apply the complete migration chain, run Prisma validation, and record schema checksums.
