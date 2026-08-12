$ErrorActionPreference = "Stop"

$databaseUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { $env:BACKUP_DATABASE_URL }
$backupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { ".\backups" }
$retentionDaysRaw = if ($env:BACKUP_RETENTION_DAYS) { $env:BACKUP_RETENTION_DAYS } else { "14" }

if ($retentionDaysRaw -notmatch '^[0-9]+$') {
  throw "BACKUP_RETENTION_DAYS must be an integer from 7 through 14"
}
$retentionDays = [int]$retentionDaysRaw
if ($retentionDays -lt 7 -or $retentionDays -gt 14) {
  throw "BACKUP_RETENTION_DAYS must be an integer from 7 through 14"
}
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL or BACKUP_DATABASE_URL is required"
}

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$lockPath = Join-Path $backupDir ".jobfinder-backup.lock"
$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
} catch {
  throw "Another backup process holds the backup lock"
}

$archivePath = $null
$checksumPath = $null
$partialArchivePath = $null
$partialChecksumPath = $null
$ownsPartialArchive = $false
$ownsPartialChecksum = $false
$ownsArchive = $false
$ownsChecksum = $false

try {
  $pgDumpVersion = (& pg_dump --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump --version failed with exit code $LASTEXITCODE"
  }
  if ($pgDumpVersion -notmatch '^pg_dump \(PostgreSQL\) 16\.') {
    throw "PostgreSQL 16 pg_dump is required; found: $pgDumpVersion"
  }

  $pgRestoreVersion = (& pg_restore --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "pg_restore --version failed with exit code $LASTEXITCODE"
  }
  if ($pgRestoreVersion -notmatch '^pg_restore \(PostgreSQL\) 16\.') {
    throw "PostgreSQL 16 pg_restore is required; found: $pgRestoreVersion"
  }

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $archivePath = Join-Path $backupDir "jobfinder-$timestamp.dump"
  $checksumPath = "$archivePath.sha256"
  $partialArchivePath = "$archivePath.partial"
  $partialChecksumPath = "$checksumPath.partial"

  foreach ($candidate in @($archivePath, $checksumPath, $partialArchivePath, $partialChecksumPath)) {
    if (Test-Path -LiteralPath $candidate) {
      throw "Refusing to overwrite existing backup artifact: $candidate"
    }
  }

  $ownsPartialArchive = $true
  & pg_dump "--dbname=$databaseUrl" "--format=custom" "--no-owner" "--no-privileges" "--file=$partialArchivePath"
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE"
  }

  & pg_restore --list $partialArchivePath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "pg_restore --list failed with exit code $LASTEXITCODE"
  }

  $archiveSha256 = (Get-FileHash -LiteralPath $partialArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumLine = "$archiveSha256  $([System.IO.Path]::GetFileName($archivePath))`n"
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  $ownsPartialChecksum = $true
  [System.IO.File]::WriteAllText($partialChecksumPath, $checksumLine, $utf8WithoutBom)

  Move-Item -LiteralPath $partialArchivePath -Destination $archivePath
  $ownsPartialArchive = $false
  $ownsArchive = $true
  Move-Item -LiteralPath $partialChecksumPath -Destination $checksumPath
  $ownsPartialChecksum = $false
  $ownsChecksum = $true

  # The checksum is the final commit marker. Published files are now retained.
  $ownsArchive = $false
  $ownsChecksum = $false

  $cutoff = (Get-Date).AddDays(-$retentionDays)
  Get-ChildItem -Path $backupDir -File | Where-Object {
    ($_.Name -like "*.dump" -or $_.Name -like "*.dump.sha256") -and $_.LastWriteTime -lt $cutoff
  } | Remove-Item -Force

  Write-Host "Backup written to $archivePath"
  Write-Host "Checksum written to $checksumPath"
} finally {
  if ($ownsPartialArchive) { Remove-Item -LiteralPath $partialArchivePath -Force -ErrorAction SilentlyContinue }
  if ($ownsPartialChecksum) { Remove-Item -LiteralPath $partialChecksumPath -Force -ErrorAction SilentlyContinue }
  if ($ownsArchive) { Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue }
  if ($ownsChecksum) { Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue }
  $lockStream.Dispose()
}
