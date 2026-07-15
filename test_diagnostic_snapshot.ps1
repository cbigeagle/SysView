# Get CPU cores count
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if (-not $cores) { $cores = 1 }

# Take first sample
$p1 = @{}
Get-Process | ForEach-Object {
    if ($_.CPU) { $p1[[string]$_.Id] = $_.CPU }
}
$t1 = [System.Diagnostics.Stopwatch]::StartNew()

# Wait short duration
Start-Sleep -Milliseconds 300
$elapsed = $t1.Elapsed.TotalSeconds
$t1.Stop()

# Take second sample
$processes = Get-Process
$allProcesses = @()
$webviewProcesses = @()

# We query CIM processes for ParentProcessId and CommandLine
$cimProcesses = @{}
Get-CimInstance Win32_Process | ForEach-Object {
    $cimProcesses[[string]$_.ProcessId] = $_
}

foreach ($p in $processes) {
    $id = $p.Id
    $idStr = [string]$id
    $cpu2 = $p.CPU
    $cpu1 = if ($p1.ContainsKey($idStr)) { $p1[$idStr] } else { 0 }
    
    $deltaCpu = 0.0
    if ($cpu2 -and $cpu1) {
        $deltaCpu = $cpu2 - $cpu1
    }
    
    # CPU Percent normalized to machine cores
    $cpuPercent = ($deltaCpu / $elapsed) * 100.0 / $cores
    if ($cpuPercent -lt 0) { $cpuPercent = 0.0 }
    if ($cpuPercent -gt 100) { $cpuPercent = 100.0 }
    
    $parentPid = 0
    $commandLine = ""
    $exePath = ""
    
    if ($cimProcesses.ContainsKey($idStr)) {
        $cim = $cimProcesses[$idStr]
        $parentPid = $cim.ParentProcessId
        $commandLine = $cim.CommandLine
        $exePath = $cim.ExecutablePath
    }
    
    $procData = @{
        PID = $id
        ParentPID = $parentPid
        Name = $p.ProcessName
        WorkingSet = $p.WorkingSet64
        PrivateMemory = $p.PrivateMemorySize64
        CPU = [Math]::Round($cpuPercent, 2)
    }
    
    $allProcesses += $procData
    
    if ($p.ProcessName -eq "msedgewebview2") {
        $wvData = @{
            PID = $id
            ParentPID = $parentPid
            CommandLine = $commandLine
            Path = $exePath
            WorkingSet = $p.WorkingSet64
            CPU = [Math]::Round($cpuPercent, 2)
        }
        $webviewProcesses += $wvData
    }
}

$output = @{
    Cores = $cores
    AllProcesses = $allProcesses
    WebViewProcesses = $webviewProcesses
}

$output | ConvertTo-Json -Depth 5
