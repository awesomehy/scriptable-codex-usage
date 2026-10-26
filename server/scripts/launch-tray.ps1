$ErrorActionPreference = 'Stop'

try {
    Start-ScheduledTask -TaskName 'Codex Usage API Monitor'
} catch {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show(
        "无法启动 Codex Usage API Monitor：$($_.Exception.Message)`n请先运行 scripts/install-tray.ps1。",
        'Codex Usage API Monitor', 'OK', 'Error')
    exit 1
}
