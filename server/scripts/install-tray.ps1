$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.runtime'
$trayScript = Join-Path $PSScriptRoot 'tray-status.ps1'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$startupDir = [Environment]::GetFolderPath('Startup')
$desktopDir = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $trayScript)) { throw 'Tray status script was not found.' }
if (-not (Test-Path -LiteralPath $startupDir)) { throw 'Windows Startup folder was not found.' }
if (-not (Test-Path -LiteralPath $desktopDir)) { throw 'Windows desktop directory was not found.' }

$startupShortcut = Join-Path $startupDir 'Codex Usage API Status.lnk'
$desktopShortcut = Join-Path $desktopDir 'Codex Usage API Monitor.lnk'
$oldDesktopShortcut = Join-Path $desktopDir 'Codex Usage API.lnk'
$arguments = '-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "' + $trayScript + '"'
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($startupShortcut, $desktopShortcut)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $powershellExe
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $projectDir
    $shortcut.Description = 'Monitor Codex Usage API and start it when the monitor opens'
    $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,13"
    $shortcut.Save()
}
if (Test-Path -LiteralPath $oldDesktopShortcut) {
    Remove-Item -LiteralPath $oldDesktopShortcut
}

# Restart only this project's existing tray process so new script changes take effect.
$existing = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($trayScript) })
foreach ($process in $existing) {
    Stop-Process -Id $process.ProcessId -Force
    Wait-Process -Id $process.ProcessId -Timeout 3 -ErrorAction SilentlyContinue
}
$null = New-Item -ItemType Directory -Path $runtimeDir -Force
$child = Start-Process -FilePath $powershellExe -ArgumentList $arguments -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardError (Join-Path $runtimeDir 'tray-stderr.log') -PassThru
Start-Sleep -Milliseconds 700
$child.Refresh()
if ($child.HasExited -and $child.ExitCode -ne 0) {
    throw 'Tray status icon failed to start. Check .runtime/tray-stderr.log.'
}
Write-Output "Codex Usage API monitor started. Desktop shortcut: $desktopShortcut; startup shortcut: $startupShortcut"
