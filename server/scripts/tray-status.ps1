$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexUsageTrayNative {
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\CodexUsageApiTray', [ref]$createdNew)
if (-not $createdNew) { $mutex.Dispose(); return }

$projectDir = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $projectDir 'config.json'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop.ps1'

function New-StatusIcon([System.Drawing.Color]$fill) {
    $bitmap = [System.Drawing.Bitmap]::new(32, 32)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $brush = [System.Drawing.SolidBrush]::new($fill)
    $outline = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 2)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.FillEllipse($brush, 3, 3, 26, 26)
        $graphics.DrawEllipse($outline, 3, 3, 26, 26)
        $handle = $bitmap.GetHicon()
        try { return [System.Drawing.Icon]([System.Drawing.Icon]::FromHandle($handle).Clone()) }
        finally { [void][CodexUsageTrayNative]::DestroyIcon($handle) }
    } finally {
        $outline.Dispose()
        $brush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Get-ApiPort {
    $port = 58321
    if (Test-Path -LiteralPath $configFile) {
        $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        if ($null -ne $config.port) { $port = [int]$config.port }
    }
    if ($env:CODEX_USAGE_PORT) { $port = [int]$env:CODEX_USAGE_PORT }
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid API port.' }
    return $port
}

function Test-ApiHealth([int]$port) {
    $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create("http://127.0.0.1:$port/health")
    $request.Method = 'GET'
    $request.Proxy = $null
    $request.Timeout = 1500
    $request.ReadWriteTimeout = 1500
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { return $false }
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        $body = $reader.ReadToEnd() | ConvertFrom-Json
        return ($body.ok -eq $true -and $body.service -eq 'codex-usage-api')
    } catch { return $false }
    finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

$runningIcon = New-StatusIcon ([System.Drawing.Color]::FromArgb(36, 172, 91))
$stoppedIcon = New-StatusIcon ([System.Drawing.Color]::FromArgb(210, 64, 64))
$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$statusItem = [System.Windows.Forms.ToolStripMenuItem]::new('状态：检查中')
$statusItem.Enabled = $false
$startItem = [System.Windows.Forms.ToolStripMenuItem]::new('启动 API')
$stopItem = [System.Windows.Forms.ToolStripMenuItem]::new('停止 API')
$refreshItem = [System.Windows.Forms.ToolStripMenuItem]::new('刷新状态')
$exitItem = [System.Windows.Forms.ToolStripMenuItem]::new('退出状态图标')
[void]$menu.Items.Add($statusItem)
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
[void]$menu.Items.Add($startItem)
[void]$menu.Items.Add($stopItem)
[void]$menu.Items.Add($refreshItem)
[void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
[void]$menu.Items.Add($exitItem)
$notify = [System.Windows.Forms.NotifyIcon]::new()
$notify.Icon = $stoppedIcon
$notify.Text = 'Codex Usage API：检查中'
$notify.ContextMenuStrip = $menu
$notify.Visible = $true
$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 10000

function Update-Status {
    $port = 58321
    $online = $false
    try {
        $port = Get-ApiPort
        $online = Test-ApiHealth $port
    } catch { $online = $false }
    $statusItem.Text = if ($online) { "状态：运行中（端口 $port）" } else { "状态：未运行或无响应（端口 $port）" }
    $notify.Text = if ($online) { 'Codex Usage API：运行中' } else { 'Codex Usage API：未运行' }
    $notify.Icon = if ($online) { $runningIcon } else { $stoppedIcon }
    $startItem.Enabled = -not $online
    $stopItem.Enabled = $online
}

$timer.Add_Tick({ Update-Status })
$refreshItem.Add_Click({ Update-Status })
$startItem.Add_Click({
    try {
        $null = & $startScript 2>&1 | Out-String
        Update-Status
    } catch {
        $notify.ShowBalloonTip(4000, 'Codex Usage API', $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Error)
    }
})
$stopItem.Add_Click({
    try {
        $null = & $stopScript 2>&1 | Out-String
        Update-Status
    } catch {
        $notify.ShowBalloonTip(4000, 'Codex Usage API', $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Error)
    }
})
$exitItem.Add_Click({
    $timer.Stop()
    $notify.Visible = $false
    [System.Windows.Forms.Application]::ExitThread()
})

try {
    Update-Status
    $timer.Start()
    [System.Windows.Forms.Application]::Run()
} finally {
    $timer.Dispose()
    $notify.Visible = $false
    $notify.Dispose()
    $menu.Dispose()
    $runningIcon.Dispose()
    $stoppedIcon.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
