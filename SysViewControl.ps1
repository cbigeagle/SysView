Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Config File handling
$configFile = Join-Path $PSScriptRoot "config.json"
$defaultPort = 22880

if (Test-Path $configFile) {
    try {
        $config = Get-Content $configFile | ConvertFrom-Json
        if ($config.Port) { $defaultPort = [int]$config.Port }
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
$form.BackColor = [Drawing.Color]::FromArgb(15, 23, 42) # Slate 900
$form.ForeColor = [Drawing.Color]::FromArgb(248, 250, 252) # Slate 50

# App Font
$titleFont = New-Object Drawing.Font("Segoe UI", 12, [Drawing.FontStyle]::Bold)
$normalFont = New-Object Drawing.Font("Segoe UI", 9.5)
$monoFont = New-Object Drawing.Font("Consolas", 10)

# Title Label
$titleLabel = New-Object Windows.Forms.Label
$titleLabel.Location = New-Object Drawing.Point(20, 15)
$titleLabel.Size = New-Object Drawing.Size(380, 25)
$titleLabel.Font = $titleFont
$titleLabel.Text = "SysView Service Manager"
$form.Controls.Add($titleLabel)

# Group Box Card for settings
$card = New-Object Windows.Forms.Panel
$card.Location = New-Object Drawing.Point(20, 50)
$card.Size = New-Object Drawing.Size(380, 105)
$card.BackColor = [Drawing.Color]::FromArgb(30, 41, 59) # Slate 800
$form.Controls.Add($card)

# Status Label inside Card
$statusLabel = New-Object Windows.Forms.Label
$statusLabel.Location = New-Object Drawing.Point(15, 15)
$statusLabel.Size = New-Object Drawing.Size(350, 20)
$statusLabel.Font = New-Object Drawing.Font("Segoe UI", 10.5, [Drawing.FontStyle]::Bold)
$statusLabel.Text = "Service Status: Checking..."
$card.Controls.Add($statusLabel)

# Port Label inside Card
$portLabel = New-Object Windows.Forms.Label
$portLabel.Location = New-Object Drawing.Point(15, 55)
$portLabel.Size = New-Object Drawing.Size(100, 20)
$portLabel.Font = $normalFont
$portLabel.ForeColor = [Drawing.Color]::FromArgb(148, 163, 184) # Slate 400
$portLabel.Text = "Configure Port:"
$card.Controls.Add($portLabel)

# Port Input TextBox inside Card
$portInput = New-Object Windows.Forms.TextBox
$portInput.Location = New-Object Drawing.Point(115, 52)
$portInput.Size = New-Object Drawing.Size(80, 20)
$portInput.Font = $monoFont
$portInput.Text = $defaultPort.ToString()
$portInput.BackColor = [Drawing.Color]::FromArgb(15, 23, 42)
$portInput.ForeColor = [Drawing.Color]::FromArgb(248, 250, 252)
$portInput.BorderStyle = "FixedSingle"
$card.Controls.Add($portInput)

# Helper function to check server state
function Get-ServerState {
    $proc = Get-Process -Name SysView -ErrorAction SilentlyContinue
    if ($proc) {
        # Find which port it is listening on
        $conn = Get-NetTCPConnection -OwningProcess $proc.Id -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            return @{ Running = $true; Port = $conn.LocalPort; PID = $proc.Id }
        }
        return @{ Running = $true; Port = $null; PID = $proc.Id }
    }
    return @{ Running = $false; Port = $null; PID = $null }
}

# Update UI elements based on state
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
        $statusLabel.ForeColor = [Drawing.Color]::FromArgb(16, 185, 129) # Emerald 500
        
        $btnStart.Enabled = $false
        $btnStop.Enabled = $true
        $btnOpen.Enabled = $true
        $portInput.Enabled = $false
    } else {
        $statusLabel.Text = "Service Status: STOPPED"
        $statusLabel.ForeColor = [Drawing.Color]::FromArgb(239, 68, 68) # Red 500
        
        $btnStart.Enabled = $true
        $btnStop.Enabled = $false
        $btnOpen.Enabled = $false
        $portInput.Enabled = $true
    }
}

# Setup Timer to poll status every second
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({ Update-UIState })
$timer.Start()

# Design Custom Buttons helper
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

# Start Button
$btnStart = Create-Button "Start Server" 20 170 115 35 ([Drawing.Color]::FromArgb(99, 102, 241)) # Indigo 500
$btnStart.Add_Click({
    $port = $portInput.Text.Trim()
    if ($port -match '^\d+$') {
        # Save to config.json
        @{ Port = [int]$port } | ConvertTo-Json | Out-File $configFile -Encoding utf8
        
        # Launch SysView.exe in background hidden
        $binary = Join-Path $PSScriptRoot "SysView.exe"
        if (Test-Path $binary) {
            Start-Process -FilePath $binary -ArgumentList "-port $port" -WindowStyle Hidden
            Start-Sleep -Milliseconds 500
            Update-UIState
        } else {
            [Windows.Forms.MessageBox]::Show("Error: SysView.exe was not found in the current directory. Please compile it first.", "Error", [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error)
        }
    } else {
        [Windows.Forms.MessageBox]::Show("Please enter a valid numeric port.", "Warning", [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Warning)
    }
})
$form.Controls.Add($btnStart)

# Stop Button
$btnStop = Create-Button "Stop Server" 150 170 115 35 ([Drawing.Color]::FromArgb(239, 68, 68)) # Red 500
$btnStop.Add_Click({
    $state = Get-ServerState
    if ($state.Running) {
        Stop-Process -Id $state.PID -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
        Update-UIState
    }
})
$form.Controls.Add($btnStop)

# Open Dashboard Button
$btnOpen = Create-Button "Open Web UI" 285 170 115 35 ([Drawing.Color]::FromArgb(16, 185, 129)) # Emerald 500
$btnOpen.Add_Click({
    $port = if ($global:activePort) { $global:activePort } else { $portInput.Text }
    Start-Process "http://localhost:$port"
})
$form.Controls.Add($btnOpen)

# Footer label
$footer = New-Object Windows.Forms.Label
$footer.Location = New-Object Drawing.Point(20, 220)
$footer.Size = New-Object Drawing.Size(380, 20)
$footer.Font = New-Object Drawing.Font("Segoe UI", 7.5, [Drawing.FontStyle]::Italic)
$footer.ForeColor = [Drawing.Color]::FromArgb(100, 116, 139) # Slate 500
$footer.TextAlign = "MiddleCenter"
$footer.Text = "SysView Diagnostics Manager &bull; Port Auto-Binds if Conflicts Occur"
$form.Controls.Add($footer)

# Trigger initial UI render
Update-UIState

# Run the Form
$form.Add_FormClosed({
    $timer.Stop()
})
$form.ShowDialog() | Out-Null
