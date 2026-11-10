# WCL SQLite ledger diagnostics for existing WSL2 Ubuntu host.
# This wrapper never creates a DB, Secrets, WCL client or live collection.
# Backup is the only command that writes anything (new isolated backup dir).
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Candidate','Status','Backup','VerifyBackup')]
  [string]$Mode,

  [Parameter(Mandatory=$true)]
  [string]$RepoLinuxPath,

  [Parameter(Mandatory=$true)]
  [string]$DbLinuxPath,

  [string]$AnchorLinuxPath,
  [string]$BackupRootLinuxPath,
  [string]$Sha256,

  [string]$Distro = 'Ubuntu'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!$RepoLinuxPath.StartsWith('/') -or !$DbLinuxPath.StartsWith('/')) {
  throw 'Linux repo and DB paths must be absolute.'
}
if ($Mode -ne 'Candidate' -and [string]::IsNullOrWhiteSpace($AnchorLinuxPath)) {
  throw 'AnchorLinuxPath from independent trusted storage is required.'
}
if ($Mode -eq 'Backup' -and [string]::IsNullOrWhiteSpace($BackupRootLinuxPath)) {
  throw 'BackupRootLinuxPath is required for explicit backup.'
}
if ($Mode -eq 'VerifyBackup' -and $Sha256 -notmatch '^[0-9a-f]{64}$') {
  throw 'Sha256 must be the independently preserved 64-character lowercase backup digest.'
}
$command = switch ($Mode) {
  'Candidate'    {'candidate'}
  'Status'       {'status'}
  'Backup'       {'backup'}
  'VerifyBackup' {'verify-backup'}
}
$script = $RepoLinuxPath.TrimEnd('/') + '/tools/wcl-platform-ledger-host.mjs'
$arguments = @($script, $command, '--db', $DbLinuxPath)
if ($Mode -ne 'Candidate') {
  $arguments += @('--anchor-file', $AnchorLinuxPath)
}
if ($Mode -eq 'Backup') {
  $arguments += @('--backup-root', $BackupRootLinuxPath)
}
if ($Mode -eq 'VerifyBackup') {
  $arguments += @('--sha256', $Sha256)
}
& wsl.exe -d $Distro -- node @arguments
if ($LASTEXITCODE -ne 0) {
  throw ('WSL ledger host returned code ' + $LASTEXITCODE)
}
