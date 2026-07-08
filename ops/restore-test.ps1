$ErrorActionPreference = "Stop"

$backupFile = if ($args.Count -gt 0) { $args[0] } else { $env:BACKUP_FILE }
$targetDatabaseUrl = if ($env:TARGET_DATABASE_URL) { $env:TARGET_DATABASE_URL } else { $env:DATABASE_URL }

if ([string]::IsNullOrWhiteSpace($backupFile) -or [string]::IsNullOrWhiteSpace($targetDatabaseUrl)) {
  throw "Usage: TARGET_DATABASE_URL=postgres://... .\ops\restore-test.ps1 <backup-file.sql.gz>"
}

$targetDbName = [System.Uri]$targetDatabaseUrl
$targetDbName = $targetDbName.AbsolutePath.TrimStart("/")

if ($targetDbName -notmatch "test|restore") {
  throw "Refusing restore into non-test database: $targetDbName"
}

$gzipStream = New-Object System.IO.Compression.GZipStream(
  [System.IO.File]::OpenRead($backupFile),
  [System.IO.Compression.CompressionMode]::Decompress
)
$reader = New-Object System.IO.StreamReader($gzipStream)
$sql = $reader.ReadToEnd()
$reader.Dispose()
$gzipStream.Dispose()

$sql | & psql $targetDatabaseUrl
