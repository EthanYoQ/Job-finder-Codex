$ErrorActionPreference = "Stop"

$backupFile = if ($args.Count -gt 0) { $args[0] } else { $env:BACKUP_FILE }
$targetDatabaseUrl = $env:TARGET_DATABASE_URL

if ([string]::IsNullOrWhiteSpace($backupFile) -or [string]::IsNullOrWhiteSpace($targetDatabaseUrl)) {
  throw "Usage: TARGET_DATABASE_URL=postgres://... .\ops\restore-test.ps1 <backup-file.dump>"
}

$targetUri = [System.Uri]$targetDatabaseUrl
$targetDbName = [System.Uri]::UnescapeDataString($targetUri.AbsolutePath.TrimStart("/"))
if ($targetDbName -notmatch '(?i)(^|[_-])(test|restore)([_-]|$)') {
  throw "Refusing restore into non-test database: $targetDbName"
}

$checksumFile = "$backupFile.sha256"
if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf) -or -not (Test-Path -LiteralPath $checksumFile -PathType Leaf)) {
  throw "Backup and final SHA256 commit marker are required"
}

$checksumLine = [System.IO.File]::ReadAllText($checksumFile)
if ($checksumLine -notmatch '\A([a-f0-9]{64})  ([^\r\n]+)\r?\n\z') {
  throw "Invalid SHA256 commit marker: $checksumFile"
}
$expectedSha256 = $Matches[1].ToLowerInvariant()
$expectedArchiveName = $Matches[2]
if ($expectedArchiveName -ne [System.IO.Path]::GetFileName($backupFile)) {
  throw "SHA256 commit marker does not bind to the requested backup"
}

$actualSha256 = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "Backup SHA256 verification failed"
}

$psqlVersion = (& psql --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "psql --version failed with exit code $LASTEXITCODE"
}
if ($psqlVersion -notmatch '^psql \(PostgreSQL\) 16\.') {
  throw "PostgreSQL 16 psql is required; found: $psqlVersion"
}

$pgRestoreVersion = (& pg_restore --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore --version failed with exit code $LASTEXITCODE"
}
if ($pgRestoreVersion -notmatch '^pg_restore \(PostgreSQL\) 16\.') {
  throw "PostgreSQL 16 pg_restore is required; found: $pgRestoreVersion"
}

$targetTableCount = (& psql "--dbname=$targetDatabaseUrl" --no-psqlrc "--set=ON_ERROR_STOP=1" --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_%';" | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Target emptiness check failed with exit code $LASTEXITCODE"
}
if ($targetTableCount -ne "0") {
  throw "Refusing restore into a target with application tables"
}

$migrationTablePresent = (& psql "--dbname=$targetDatabaseUrl" --no-psqlrc "--set=ON_ERROR_STOP=1" --tuples-only --no-align --command="SELECT CASE WHEN to_regclass('public.\"_prisma_migrations\"') IS NULL THEN 0 ELSE 1 END;" | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Migration table check failed with exit code $LASTEXITCODE"
}
if ($migrationTablePresent -ne "0") {
  throw "Refusing restore into a target containing _prisma_migrations"
}

& pg_restore --list $backupFile | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore --list failed with exit code $LASTEXITCODE"
}

& pg_restore --exit-on-error --single-transaction --no-owner --no-privileges "--dbname=$targetDatabaseUrl" $backupFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE"
}
