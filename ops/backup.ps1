$ErrorActionPreference = "Stop"

$databaseUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { $env:BACKUP_DATABASE_URL }
$backupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { ".\backups" }
$retentionDays = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 14 }

if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL or BACKUP_DATABASE_URL is required"
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$archivePath = Join-Path $backupDir "jobfinder-$timestamp.sql.gz"
$plainDumpPath = Join-Path $backupDir "jobfinder-$timestamp.sql"

& pg_dump "--dbname=$databaseUrl" "--no-owner" "--no-privileges" "--file=$plainDumpPath"

if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

try {
  $fileStream = [System.IO.File]::Create($archivePath)
  $gzipStream = New-Object System.IO.Compression.GZipStream($fileStream, [System.IO.Compression.CompressionLevel]::Optimal)
  $inputStream = [System.IO.File]::OpenRead($plainDumpPath)
  $inputStream.CopyTo($gzipStream)
  $inputStream.Dispose()
  $gzipStream.Dispose()
  $fileStream.Dispose()
} finally {
  if (Test-Path $plainDumpPath) {
    Remove-Item -Path $plainDumpPath -Force
  }
}

$cutoff = (Get-Date).AddDays(-$retentionDays)
Get-ChildItem -Path $backupDir -Filter "*.sql.gz" -File | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force

Write-Host "Backup written to $archivePath"
