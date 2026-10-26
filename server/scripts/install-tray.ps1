$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.runtime'
$trayScript = Join-Path $PSScriptRoot 'tray-status.ps1'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$startupDir = [Environment]::GetFolderPath('Startup')
if (-not (Test-Path -LiteralPath $trayScript)) { throw 'Tray status script was not found.' }
if (-not (Test-Path -LiteralPath $startupDir)) { throw 'Windows Startup folder was not found.' }

$shortcutPath = Join-Path $startupDir 'Codex Usage API Status.lnk'
$arguments = '-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "' + $trayScript + '"'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExe
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = 'Show Codex Usage API running status in the Windows notification area'
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,13"
$shortcut.Save()

# The tray script uses a named mutex, so running the installer again cannot create a second icon.
$existing = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($trayScript) }
if ($existing) {
    Write-Output "Codex Usage API status icon is already running. Startup shortcut: $shortcutPath"
    return
}
$null = New-Item -ItemType Directory -Path $runtimeDir -Force
$child = Start-Process -FilePath $powershellExe -ArgumentList $arguments -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardError (Join-Path $runtimeDir 'tray-stderr.log') -PassThru
Start-Sleep -Milliseconds 700
$child.Refresh()
if ($child.HasExited -and $child.ExitCode -ne 0) {
    throw 'Tray status icon failed to start. Check .runtime/tray-stderr.log.'
}
Write-Output "Codex Usage API status icon started. Startup shortcut: $shortcutPath"
