# SysView System Snapshot Collector
# Collects CPU, memory performance counters, and process tables.

$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if (-not $cores) { $cores = 1 }

# 1. Capture first CPU sample for all processes
$p1 = @{}
Get-Process | ForEach-Object {
    if ($_.CPU) { $p1[[string]$_.Id] = $_.CPU }
}
$t1 = [System.Diagnostics.Stopwatch]::StartNew()

# 2. Query System Memory Metrics via WMI (runs in parallel to the sleep interval)
$memPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$osInfo = Get-CimInstance Win32_OperatingSystem

$totalVisibleBytes = $osInfo.TotalVisibleMemorySize * 1024
$availableBytes = $memPerf.AvailableBytes

# Installed RAM modules (physical capacity)
$installedBytes = 0
try {
    $installedBytes = (Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum
} catch {
    $installedBytes = $totalVisibleBytes
}
if (-not $installedBytes) { $installedBytes = $totalVisibleBytes }

# Standby cache calculation (sum of three standby priorities)
$standbyBytes = $memPerf.StandbyCacheCoreBytes + $memPerf.StandbyCacheNormalPriorityBytes + $memPerf.StandbyCacheReserveBytes
if (-not $standbyBytes) { $standbyBytes = 0 }

# Paged & Non-Paged Pools
$nonpagedBytes = $memPerf.PoolNonpagedBytes
$pagedBytes = $memPerf.PoolPagedBytes

# Hardware Reserved is physical RAM invisible to OS (used by BIOS/APU GPU)
$hwReservedBytes = $installedBytes - $totalVisibleBytes
if ($hwReservedBytes -lt 0) { $hwReservedBytes = 0 }

# In-use is RAM allocated and unavailable for cache/free
$inUseBytes = $totalVisibleBytes - $availableBytes
if ($inUseBytes -lt 0) { $inUseBytes = 0 }

$memoryData = @{
    TotalPhysicalBytes = $installedBytes
    VisiblePhysicalBytes = $totalVisibleBytes
    AvailableBytes = $availableBytes
    InUseBytes = $inUseBytes
    StandbyBytes = $standbyBytes
    NonpagedPoolBytes = $nonpagedBytes
    PagedPoolBytes = $pagedBytes
    HardwareReservedBytes = $hwReservedBytes
}

# 3. Wait for sleep interval to sample CPU usage (300ms is standard for delta)
Start-Sleep -Milliseconds 300
$elapsed = $t1.Elapsed.TotalSeconds
$t1.Stop()

# 4. Capture second CPU sample and collect processes
$processes = Get-Process
$allProcesses = @()
$webviewProcesses = @()

# Fetch CIM process table for ParentPID and CommandLine
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
    
    # Active CPU Percent normalized to logical cores
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
        Path = $exePath
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

# 5. Query WSL status and distros if wsl.exe is available
$wslDistros = @()
if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    try {
        $wslOut = wsl.exe -l -v | Out-String
        if ($wslOut -match '\sN\sA\sM\sE') {
            # Handle UTF-16 console wide character encoding spacing
            $bytes = [System.Text.Encoding]::Unicode.GetBytes($wslOut)
            $wslOut = [System.Text.Encoding]::UTF8.GetString($bytes)
        }
        
        $lines = $wslOut -split "`r?`n" | Where-Object { $_.Trim() -ne "" }
        foreach ($line in $lines) {
            $cleaned = $line -replace '\s+', ' ' -replace '\0', ''
            $cleaned = $cleaned.Trim()
            if ($cleaned -match '^\*?\s*([^\s]+)\s+([^\s]+)\s+(\d+)$') {
                $default = $line.Contains('*')
                $name = $Matches[1]
                $state = $Matches[2]
                $version = [int]$Matches[3]
                
                $wslDistros += @{
                    Default = $default
                    Name = $name
                    State = $state
                    Version = $version
                }
            }
        }
    } catch {
        # Gracefully handle any WSL execution blocks
    }
}

$wslConfigExists = Test-Path "$HOME\.wslconfig"

$output = @{
    Cores = $cores
    Memory = $memoryData
    AllProcesses = $allProcesses
    WebViewProcesses = $webviewProcesses
    WSL = @{
        ConfigExists = $wslConfigExists
        Distros = $wslDistros
    }
}

$output | ConvertTo-Json -Depth 5
