$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.runtime'
$serverFile = Join-Path $projectDir 'src\server.mjs'
$pidFile = Join-Path $runtimeDir 'server.pid'
$nodeExe = (Get-Command node -ErrorAction Stop).Source
if (Test-Path -LiteralPath $pidFile) {
    $recordedId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedId" -ErrorAction SilentlyContinue
    if ($existing -and $existing.Name -eq 'node.exe' -and $existing.CommandLine.Contains($serverFile)) {
        Write-Output "Codex Usage API is already running. PID: $recordedId"
        exit 0
    }
}
$null = New-Item -ItemType Directory -Path $runtimeDir -Force
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
