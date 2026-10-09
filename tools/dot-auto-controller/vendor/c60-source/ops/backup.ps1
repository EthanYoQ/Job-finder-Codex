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
$metadataPath = $null
$partialMetadataPath = $null
$ownsPartialMetadata = $false
$ownsMetadata = $false

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
  $serverVersionNum = (& psql "--dbname=$databaseUrl" --no-psqlrc "--set=ON_ERROR_STOP=1" --tuples-only --no-align --command="SHOW server_version_num;" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $serverVersionNum -notmatch '^16[0-9]{4}$') { throw "PostgreSQL 16 server is required" }

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $archivePath = Join-Path $backupDir "jobfinder-$timestamp.dump"
  $checksumPath = "$archivePath.sha256"
  $partialArchivePath = "$archivePath.partial"
  $partialChecksumPath = "$checksumPath.partial"
  $metadataPath = "$archivePath.metadata.json"
  $partialMetadataPath = "$metadataPath.partial"

  foreach ($candidate in @($archivePath, $checksumPath, $metadataPath, $partialArchivePath, $partialChecksumPath, $partialMetadataPath)) {
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
  $ownsPartialMetadata = $true
  $metadata = [ordered]@{ schemaVersion = 1; createdAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); archiveName = [System.IO.Path]::GetFileName($archivePath); archiveSha256 = $archiveSha256; database = @{ serverVersionNum = $serverVersionNum }; tools = @{ pgDump = $pgDumpVersion; pgRestore = $pgRestoreVersion } }
  [System.IO.File]::WriteAllText($partialMetadataPath, (($metadata | ConvertTo-Json -Depth 4) + "`n"), $utf8WithoutBom)

  Move-Item -LiteralPath $partialArchivePath -Destination $archivePath
  $ownsPartialArchive = $false
  $ownsArchive = $true
  Move-Item -LiteralPath $partialMetadataPath -Destination $metadataPath
  $ownsPartialMetadata = $false
  $ownsMetadata = $true
  Move-Item -LiteralPath $partialChecksumPath -Destination $checksumPath
  $ownsPartialChecksum = $false
  $ownsChecksum = $true

  # The checksum is the final commit marker. Published files are now retained.
  $ownsArchive = $false
  $ownsChecksum = $false
  $ownsMetadata = $false

  $cutoff = (Get-Date).AddDays(-$retentionDays)
  Get-ChildItem -Path $backupDir -File | Where-Object {
    ($_.Name -like "*.dump" -or $_.Name -like "*.dump.sha256" -or $_.Name -like "*.dump.metadata.json") -and $_.LastWriteTime -lt $cutoff
  } | Remove-Item -Force

  Write-Host "Backup written to $archivePath"
  Write-Host "Checksum written to $checksumPath"
  Write-Host "Metadata written to $metadataPath"
} finally {
  if ($ownsPartialArchive) { Remove-Item -LiteralPath $partialArchivePath -Force -ErrorAction SilentlyContinue }
  if ($ownsPartialChecksum) { Remove-Item -LiteralPath $partialChecksumPath -Force -ErrorAction SilentlyContinue }
  if ($ownsArchive) { Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue }
  if ($ownsChecksum) { Remove-Item -LiteralPath $checksumPath -Force -ErrorAction SilentlyContinue }
  if ($ownsPartialMetadata) { Remove-Item -LiteralPath $partialMetadataPath -Force -ErrorAction SilentlyContinue }
  if ($ownsMetadata) { Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue }
  $lockStream.Dispose()
}
