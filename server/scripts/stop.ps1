$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectDir '.runtime\server.pid'
$serverFile = Join-Path $projectDir 'src\server.mjs'
if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Output 'No background server PID file found.'
    return
}
$recordedId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
$running = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedId" -ErrorAction SilentlyContinue
if ($running) {
    if ($running.Name -ne 'node.exe' -or -not $running.CommandLine.Contains($serverFile)) {
        throw 'PID belongs to another process. Refusing to stop it.'
    }
    # Stop only this adapter's active app-server child, never the desktop app.
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $recordedId" |
        Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'app-server' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $recordedId -Force -ErrorAction SilentlyContinue
    Write-Output "Codex Usage API stopped. PID: $recordedId"
} else {
    Write-Output 'Codex Usage API was already stopped.'
}
Remove-Item -LiteralPath $pidFile
