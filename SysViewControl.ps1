Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Config File handling
$configFile = Join-Path $PSScriptRoot "config.json"
$pidFile = Join-Path $PSScriptRoot "SysView.pid"
$defaultPort = 22880

function Test-ValidPort($p) {
    if ($p -notmatch '^\d+$') { return $false }
    $n = [int]$p
    return $n -ge 1 -and $n -le 65535
}

if (Test-Path $configFile) {
    try {
        $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
        if (Test-ValidPort $cfg.Port) { $defaultPort = [int]$cfg.Port }
    } catch {}
} else {
    @{ Port = $defaultPort } | ConvertTo-Json | Out-File $configFile -Encoding utf8
}

# Create Main Form
$form = New-Object Windows.Forms.Form
$form.Text = "SysView Diagnostics Controller"
$form.Size = New-Object Drawing.Size(440, 290)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(15, 23, 42)
$form.ForeColor = [Drawing.Color]::FromArgb(248, 250, 252)

$titleFont = New-Object Drawing.Font("Segoe UI", 12, [Drawing.FontStyle]::Bold)
$normalFont = New-Object Drawing.Font("Segoe UI", 9.5)
$monoFont = New-Object Drawing.Font("Consolas", 10)

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.Location = New-Object Drawing.Point(20, 15)
$titleLabel.Size = New-Object Drawing.Size(380, 25)
$titleLabel.Font = $titleFont
$titleLabel.Text = "SysView Service Manager"
$form.Controls.Add($titleLabel)

$card = New-Object Windows.Forms.Panel
$card.Location = New-Object Drawing.Point(20, 50)
$card.Size = New-Object Drawing.Size(380, 105)
$card.BackColor = [Drawing.Color]::FromArgb(30, 41, 59)
$form.Controls.Add($card)

$statusLabel = New-Object Windows.Forms.Label
$statusLabel.Location = New-Object Drawing.Point(15, 15)
$statusLabel.Size = New-Object Drawing.Size(350, 20)
$statusLabel.Font = New-Object Drawing.Font("Segoe UI", 10.5, [Drawing.FontStyle]::Bold)
$statusLabel.Text = "Service Status: Checking..."
$card.Controls.Add($statusLabel)

$portLabel = New-Object Windows.Forms.Label
$portLabel.Location = New-Object Drawing.Point(15, 55)
$portLabel.Size = New-Object Drawing.Size(100, 20)
$portLabel.Font = $normalFont
$portLabel.ForeColor = [Drawing.Color]::FromArgb(148, 163, 184)
$portLabel.Text = "Configure Port:"
$card.Controls.Add($portLabel)

$portInput = New-Object Windows.Forms.TextBox
$portInput.Location = New-Object Drawing.Point(115, 52)
$portInput.Size = New-Object Drawing.Size(80, 20)
$portInput.Font = $monoFont
$portInput.Text = $defaultPort.ToString()
$portInput.BackColor = [Drawing.Color]::FromArgb(15, 23, 42)
$portInput.ForeColor = [Drawing.Color]::FromArgb(248, 250, 252)
$portInput.BorderStyle = "FixedSingle"
$card.Controls.Add($portInput)

function Get-StoredPidInfo {
    if (-not (Test-Path $pidFile)) { return $null }
    try {
        $info = Get-Content $pidFile -Raw | ConvertFrom-Json
        if (-not $info.PID -or -not $info.Path) { return $null }
        $proc = Get-Process -Id $info.PID -ErrorAction SilentlyContinue
        if (-not $proc) { return $null }
        # Verify executable path matches (reject stale PID reuse)
        try {
            $actualPath = $proc.Path
            if ($actualPath -and $info.Path -and $actualPath -ne $info.Path) { return $null }
            # Verify start time if available
            if ($info.StartTime) {
                $stored = [DateTime]$info.StartTime
                if ($proc.StartTime -and [Math]::Abs(($proc.StartTime - $stored).TotalSeconds) -gt 2) { return $null }
            }
        } catch {}
        return $info
    } catch { return $null }
}

function Get-ServerState {
    # Prefer PID file identity
    $stored = Get-StoredPidInfo
    if ($stored) {
        $proc = Get-Process -Id $stored.PID -ErrorAction SilentlyContinue
        if ($proc) {
            $port = $stored.Port
            # Verify listening socket belongs to this PID if port known
            if ($port) {
                $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $proc.Id }
                if ($conn) { return @{ Running = $true; Port = $port; PID = $proc.Id; Source = "pidfile" } }
                # If no conn yet, still report running but binding
                return @{ Running = $true; Port = $null; PID = $proc.Id; Source = "pidfile" }
            }
            return @{ Running = $true; Port = $null; PID = $proc.Id; Source = "pidfile" }
        }
    }
    # Fallback: search by name but verify path is SysView
    $candidates = Get-Process -Name SysView -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -like "*SysView.exe" } catch { $true }
    }
    if ($candidates) {
        $proc = $candidates | Select-Object -First 1
        $conn = Get-NetTCPConnection -OwningProcess $proc.Id -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            return @{ Running = $true; Port = $conn.LocalPort; PID = $proc.Id; Source = "scan" }
        }
        return @{ Running = $true; Port = $null; PID = $proc.Id; Source = "scan" }
    }
    return @{ Running = $false; Port = $null; PID = $null; Source = "none" }
}

function Update-UIState {
    $state = Get-ServerState
    if ($state.Running) {
        $statusText = "Service Status: RUNNING"
        if ($state.Port) {
            $statusText += " (Port: $($state.Port))"
            $global:activePort = $state.Port
        } else {
            $statusText += " (Binding...)"
        }
        $statusLabel.Text = $statusText
        $statusLabel.ForeColor = [Drawing.Color]::FromArgb(16, 185, 129)
        $btnStart.Enabled = $false
        $btnStop.Enabled = $true
        $btnOpen.Enabled = $true
        $portInput.Enabled = $false
    } else {
        $statusLabel.Text = "Service Status: STOPPED"
        $statusLabel.ForeColor = [Drawing.Color]::FromArgb(239, 68, 68)
        $btnStart.Enabled = $true
        $btnStop.Enabled = $false
        $btnOpen.Enabled = $false
        $portInput.Enabled = $true
    }
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({ Update-UIState })
$timer.Start()

function Create-Button($text, $x, $y, $w, $h, $bgColor) {
    $btn = New-Object Windows.Forms.Button
    $btn.Text = $text
    $btn.Location = New-Object Drawing.Point($x, $y)
    $btn.Size = New-Object Drawing.Size($w, $h)
    $btn.Font = New-Object Drawing.Font("Segoe UI", 9, [Drawing.FontStyle]::Bold)
    $btn.BackColor = $bgColor
    $btn.ForeColor = [Drawing.Color]::White
    $btn.FlatStyle = "Flat"
    $btn.FlatAppearance.BorderSize = 0
    return $btn
}

$btnStart = Create-Button "Start Server" 20 170 115 35 ([Drawing.Color]::FromArgb(99, 102, 241))
$btnStart.Add_Click({
    $port = $portInput.Text.Trim()
    if (-not (Test-ValidPort $port)) {
        [Windows.Forms.MessageBox]::Show("Please enter a valid port (1-65535).", "Warning", [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Warning)
        return
    }
    @{ Port = [int]$port } | ConvertTo-Json | Out-File $configFile -Encoding utf8
    $binary = Join-Path $PSScriptRoot "SysView.exe"
    if (Test-Path $binary) {
        try {
            $proc = Start-Process -FilePath $binary -ArgumentList "-port $port" -WindowStyle Hidden -PassThru
            # Persist PID file with start time and path for stale-check
            $info = @{
                PID = $proc.Id
                Port = [int]$port
                Path = $proc.Path
                StartTime = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue).StartTime.ToString("o")
            }
            $info | ConvertTo-Json | Out-File $pidFile -Encoding utf8
        } catch {
            [Windows.Forms.MessageBox]::Show("Failed to start SysView: $_", "Error", [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
            return
        }
        # Async readiness check via timer, not blocking sleep
        $global:startAttempts = 0
        $readiness = New-Object Windows.Forms.Timer
        $readiness.Interval = 400
        $readiness.Add_Tick({
            param($sender, $e)
            $global:startAttempts++
            Update-UIState
            $s = Get-ServerState
            if ($s.Running -and $s.Port) { $sender.Stop(); $sender.Dispose() }
            elseif ($global:startAttempts -gt 15) { $sender.Stop(); $sender.Dispose() }
        })
        $readiness.Start()
    } else {
        [Windows.Forms.MessageBox]::Show("Error: SysView.exe was not found in the current directory. Please compile it first.", "Error", [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
    }
})
$form.Controls.Add($btnStart)

$btnStop = Create-Button "Stop Server" 150 170 115 35 ([Drawing.Color]::FromArgb(239, 68, 68))
$btnStop.Add_Click({
    $state = Get-ServerState
    if ($state.Running -and $state.PID) {
        $proc = Get-Process -Id $state.PID -ErrorAction SilentlyContinue
        if ($proc) {
            # Attempt graceful close first
            try { $proc.CloseMainWindow() | Out-Null } catch {}
            $exited = $false
            for ($i=0; $i -lt 8; $i++) {
                Start-Sleep -Milliseconds 150
                if ($proc.HasExited) { $exited = $true; break }
                $proc.Refresh()
            }
            if (-not $exited) {
                try { Stop-Process -Id $state.PID -Force -ErrorAction SilentlyContinue } catch {}
            }
        }
        if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
        # Let timer reflect new state
        Start-Sleep -Milliseconds 200
        Update-UIState
    }
})
$form.Controls.Add($btnStop)

$btnOpen = Create-Button "Open Web UI" 285 170 115 35 ([Drawing.Color]::FromArgb(16, 185, 129))
$btnOpen.Add_Click({
    $port = if ($global:activePort) { $global:activePort } else { $portInput.Text }
    if (-not (Test-ValidPort $port)) { $port = $defaultPort }
    Start-Process "http://localhost:$port"
})
$form.Controls.Add($btnOpen)

$footer = New-Object Windows.Forms.Label
$footer.Location = New-Object Drawing.Point(20, 220)
$footer.Size = New-Object Drawing.Size(380, 20)
$footer.Font = New-Object Drawing.Font("Segoe UI", 7.5, [Drawing.FontStyle]::Italic)
$footer.ForeColor = [Drawing.Color]::FromArgb(100, 116, 139)
$footer.TextAlign = "MiddleCenter"
$footer.Text = "SysView Diagnostics Manager " + [char]0x2022 + " Port Auto-Binds if Conflicts Occur"
$form.Controls.Add($footer)

Update-UIState
$form.Add_FormClosed({ $timer.Stop() })
$form.ShowDialog() | Out-Null
