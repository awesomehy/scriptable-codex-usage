$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.runtime'
$trayScript = Join-Path $PSScriptRoot 'tray-status.ps1'
$launcherScript = Join-Path $PSScriptRoot 'launch-tray.ps1'
$taskName = 'Codex Usage API Monitor'
$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$startupDir = [Environment]::GetFolderPath('Startup')
$desktopDir = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $trayScript)) { throw 'Tray status script was not found.' }
if (-not (Test-Path -LiteralPath $launcherScript)) { throw 'Tray launcher script was not found.' }
if (-not (Test-Path -LiteralPath $startupDir)) { throw 'Windows Startup folder was not found.' }
if (-not (Test-Path -LiteralPath $desktopDir)) { throw 'Windows desktop directory was not found.' }

$startupShortcut = Join-Path $startupDir 'Codex Usage API Status.lnk'
$desktopShortcut = Join-Path $desktopDir 'Codex Usage API Monitor.lnk'
$oldDesktopShortcut = Join-Path $desktopDir 'Codex Usage API.lnk'
$arguments = '-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "' + $launcherScript + '"'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($desktopShortcut)
$shortcut.TargetPath = $powershellExe
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $projectDir
$shortcut.Description = 'Launch the independent Codex Usage API monitor'
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,13"
$shortcut.Save()

$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskArguments = '-NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "' + $trayScript + '"'
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $taskArguments -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances Parallel -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$null = Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keep the Codex Usage API monitor independent of ChatGPT and Codex' -Force

if (Test-Path -LiteralPath $startupShortcut) {
    Remove-Item -LiteralPath $startupShortcut
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
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$running = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($trayScript) })
if ($running.Count -ne 1) {
    throw 'Tray status icon failed to stay running. Check .runtime/tray-stderr.log and Task Scheduler history.'
}
Write-Output "Codex Usage API monitor started by Task Scheduler. Desktop shortcut: $desktopShortcut; logon task: $taskName"
