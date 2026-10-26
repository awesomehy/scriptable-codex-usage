$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.runtime'
$serverFile = Join-Path $projectDir 'src\server.mjs'
$pidFile = Join-Path $runtimeDir 'server.pid'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$configFile = Join-Path $projectDir 'config.json'
$port = 58321
if (Test-Path -LiteralPath $configFile) {
    $settings = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if ($null -ne $settings.port) { $port = [int]$settings.port }
}
if ($env:CODEX_USAGE_PORT) { $port = [int]$env:CODEX_USAGE_PORT }
$null = New-Item -ItemType Directory -Path $runtimeDir -Force

# Check the actual listener first. This also finds a manually started service or a stale PID file.
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -and $owner.CommandLine.Contains($serverFile)) {
        Set-Content -LiteralPath $pidFile -Value $owner.ProcessId -Encoding ascii
        Write-Output "Codex Usage API is already running. PID: $($owner.ProcessId), port: $port"
        return
    }
}
if ($listeners.Count -gt 0) {
    throw "Port $port is already in use by another process. Codex Usage API was not started."
}

if (Test-Path -LiteralPath $pidFile) {
    $recordedId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedId" -ErrorAction SilentlyContinue
    if ($existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine -and $existing.CommandLine.Contains($serverFile)) {
        Write-Output "Codex Usage API process is already starting. PID: $recordedId"
        return
    }
}
$child = Start-Process -FilePath $nodeExe -ArgumentList @('"' + $serverFile + '"') -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'stderr.log') -PassThru
Start-Sleep -Milliseconds 800
$child.Refresh()
if ($child.HasExited) {
    Get-Content -LiteralPath (Join-Path $runtimeDir 'stderr.log')
    throw 'Codex Usage API failed to start.'
}
Set-Content -LiteralPath $pidFile -Value $child.Id -Encoding ascii
Write-Output "Codex Usage API started in the background. PID: $($child.Id)"
Get-Content -LiteralPath (Join-Path $runtimeDir 'stdout.log')
