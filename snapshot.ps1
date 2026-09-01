# SysView System Snapshot Collector — v3
# Returns a versioned envelope with provider status, invariants, and parsed WSL config.
$ErrorActionPreference = 'Stop'
$providers = @{}
$errors = @()

$capturedAt = (Get-Date).ToUniversalTime().ToString("o")
$schemaVersion = 3

# Helpers
function Add-Error($provider, $msg) {
    $script:errors += @{ provider = $provider; message = $msg }
    $script:providers[$provider] = "unavailable"
}
function Set-ProviderOk($provider) {
    if (-not $script:providers.ContainsKey($provider)) { $script:providers[$provider] = "ok" }
}

# --- Cores ---
$cores = 1
try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $cores = $cs.NumberOfLogicalProcessors
    if (-not $cores) { $cores = 1 }
    Set-ProviderOk "cores"
} catch {
    Add-Error "cores" $_.Exception.Message
    $cores = 1
}

# 1. Capture first CPU sample
$p1 = @{}
try {
    Get-Process -ErrorAction Stop | ForEach-Object { if ($_.CPU) { $p1[[string]$_.Id] = $_.CPU } }
    Set-ProviderOk "processes"
} catch {
    Add-Error "processes" $_.Exception.Message
}
$t1 = [System.Diagnostics.Stopwatch]::StartNew()

# 2. Query Memory
$memPerf = $null; $osInfo = $null
$totalVisibleBytes = $null; $availableBytes = $null; $installedBytes = $null
$standbyBytes = 0; $nonpagedBytes = $null; $pagedBytes = $null; $hwReservedBytes = 0; $inUseBytes = $null
$modifiedBytes = 0; $freeBytes = $null

try {
    $memPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction Stop
    $osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $totalVisibleBytes = [int64]($osInfo.TotalVisibleMemorySize * 1024)
    $availableBytes = [int64]$memPerf.AvailableBytes

    try {
        $installedBytes = [int64]((Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop | Measure-Object -Property Capacity -Sum).Sum)
    } catch { $installedBytes = $totalVisibleBytes }
    if (-not $installedBytes) { $installedBytes = $totalVisibleBytes }

    # Standby cache sum
    $standbyBytes = [int64]($memPerf.StandbyCacheCoreBytes + $memPerf.StandbyCacheNormalPriorityBytes + $memPerf.StandbyCacheReserveBytes)
    if (-not $standbyBytes) { $standbyBytes = 0 }

    # FreeAndZero and Modified are mutually exclusive with InUse/Standby
    try {
        $freeBytes = [int64]$memPerf.FreeAndZeroPageListBytes
        if (-not $freeBytes) { $freeBytes = 0 }
    } catch { $freeBytes = 0 }
    try {
        $modifiedBytes = [int64]$memPerf.ModifiedPageListBytes
        if (-not $modifiedBytes) { $modifiedBytes = 0 }
    } catch { $modifiedBytes = 0 }

    $nonpagedBytes = [int64]$memPerf.PoolNonpagedBytes
    $pagedBytes = [int64]$memPerf.PoolPagedBytes

    $hwReservedBytes = $installedBytes - $totalVisibleBytes
    if ($hwReservedBytes -lt 0) { $hwReservedBytes = 0 }

    $inUseBytes = $totalVisibleBytes - $availableBytes - $modifiedBytes
    if ($inUseBytes -lt 0) { $inUseBytes = 0 }

    # Invariants — visible = InUse(exclusive) + Standby + Modified + FreeAndZero
    $visibleSum = $inUseBytes + $standbyBytes + $modifiedBytes + $freeBytes
    $tolerance = [int64](10 * 1024 * 1024) # 10 MB
    if ([Math]::Abs($visibleSum - $totalVisibleBytes) -gt $tolerance) {
        $errors += @{ provider = "memory"; message = "Invariant violation: visible sum $visibleSum != visible $totalVisibleBytes (tolerance $tolerance) standby=$standbyBytes free=$freeBytes modified=$modifiedBytes inUse=$inUseBytes available=$availableBytes" }
    }
    if ([Math]::Abs(($totalVisibleBytes + $hwReservedBytes) - $installedBytes) -gt $tolerance) {
        $errors += @{ provider = "memory"; message = "Invariant violation: visible+reserved != installed" }
    }
    foreach ($v in @($totalVisibleBytes, $availableBytes, $inUseBytes, $standbyBytes, $freeBytes, $hwReservedBytes, $nonpagedBytes, $pagedBytes)) {
        if ($v -lt 0) { $errors += @{ provider = "memory"; message = "Invariant violation: negative memory value $v" } }
    }

    Set-ProviderOk "memory"
} catch {
    Add-Error "memory" $_.Exception.Message
    # Populate zeroes so schema validates but providers flag unavailable
    if ($null -eq $totalVisibleBytes) { $totalVisibleBytes = 0 }
    if ($null -eq $availableBytes) { $availableBytes = 0 }
    if ($null -eq $inUseBytes) { $inUseBytes = 0 }
    if ($null -eq $nonpagedBytes) { $nonpagedBytes = 0 }
    if ($null -eq $pagedBytes) { $pagedBytes = 0 }
    if ($null -eq $freeBytes) { $freeBytes = 0 }
    if (-not $installedBytes) { $installedBytes = $totalVisibleBytes }
}

$memoryData = @{
    TotalPhysicalBytes = [int64]$installedBytes
    VisiblePhysicalBytes = [int64]$totalVisibleBytes
    AvailableBytes = [int64]$availableBytes
    InUseBytes = [int64]$inUseBytes
    StandbyBytes = [int64]$standbyBytes
    ModifiedBytes = [int64]$modifiedBytes
    FreeBytes = [int64]$freeBytes
    NonpagedPoolBytes = [int64]$nonpagedBytes
    PagedPoolBytes = [int64]$pagedBytes
    HardwareReservedBytes = [int64]$hwReservedBytes
}

# 3. Wait for CPU delta
Start-Sleep -Milliseconds 300
$elapsed = $t1.Elapsed.TotalSeconds
$t1.Stop()
if ($elapsed -le 0) { $elapsed = 0.3 }

# 4. Capture second CPU sample and collect processes
$processes = @()
$allProcesses = @()
$webviewProcesses = @()
$cimProcesses = @{}

try {
    $processes = Get-Process -ErrorAction Stop
} catch {
    Add-Error "processes" $_.Exception.Message
}

try {
    Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $cimProcesses[[string]$_.ProcessId] = $_ }
} catch {
    Add-Error "processes" ("CIM Win32_Process failed: " + $_.Exception.Message)
}

foreach ($p in $processes) {
    $id = $p.Id
    $idStr = [string]$id
    $cpu2 = $p.CPU
    $cpu1 = if ($p1.ContainsKey($idStr)) { $p1[$idStr] } else { 0 }
    $deltaCpu = 0.0
    if ($cpu2 -and $cpu1) { $deltaCpu = $cpu2 - $cpu1 }
    $cpuPercent = ($deltaCpu / $elapsed) * 100.0 / $cores
    if ($cpuPercent -lt 0) { $cpuPercent = 0.0 }
    if ($cpuPercent -gt 100) { $cpuPercent = 100.0 }

    $parentPid = 0; $commandLine = ""; $exePath = ""
    if ($cimProcesses.ContainsKey($idStr)) {
        $cim = $cimProcesses[$idStr]
        $parentPid = $cim.ParentProcessId
        if ($null -ne $cim.CommandLine) { $commandLine = $cim.CommandLine }
        if ($null -ne $cim.ExecutablePath) { $exePath = $cim.ExecutablePath }
    }

    # PrivateMemorySize64 is private commit, WorkingSet64 is resident (may include shared)
    $procData = @{
        PID = [int]$id
        ParentPID = [int]$parentPid
        Name = [string]$p.ProcessName
        WorkingSet = [int64]$p.WorkingSet64
        PrivateMemory = [int64]$p.PrivateMemorySize64
        Path = [string]$exePath
        CPU = [Math]::Round($cpuPercent, 2)
        CPUSampleSeconds = [Math]::Round($elapsed, 3)
        IOReadBytes = [int64]0
        IOWriteBytes = [int64]0
        TcpConnectionCount = [int]0
    }
    $allProcesses += $procData

    if ($p.ProcessName -eq "msedgewebview2") {
        $wvData = @{
            PID = [int]$id
            ParentPID = [int]$parentPid
            CommandLine = [string]$commandLine
            Path = [string]$exePath
            WorkingSet = [int64]$p.WorkingSet64
            CPU = [Math]::Round($cpuPercent, 2)
            CPUSampleSeconds = [Math]::Round($elapsed, 3)
        }
        $webviewProcesses += $wvData
    }
}
if (-not $providers.ContainsKey("processes")) { Set-ProviderOk "processes" }

# 4b. Disk I/O per process (Win32_PerfRawData + fallback to Formatted)
$ioMap = @{}
try {
    $gotIo = $false
    try {
        $perfRaw = Get-CimInstance Win32_PerfRawData_PerfProc_Process -ErrorAction Stop
        foreach ($r in $perfRaw) {
            $pidKey = [string]$r.IDProcess
            if ($pidKey -eq "0" -or $pidKey -eq "_Total") { continue }
            $readBytes = [int64]0
            $writeBytes = [int64]0
            try { $readBytes = [int64]$r.IOReadBytes } catch {}
            try { $writeBytes = [int64]$r.IOWriteBytes } catch {}
            if ($readBytes -lt 0) { $readBytes = 0 }
            if ($writeBytes -lt 0) { $writeBytes = 0 }
            $ioMap[$pidKey] = @{ Read = $readBytes; Write = $writeBytes }
        }
        $gotIo = $true
        Set-ProviderOk "diskio"
    } catch {
        $gotIo = $false
    }
    if (-not $gotIo) {
        $perfFmt = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop
        foreach ($r in $perfFmt) {
            $pidKey = [string]$r.IDProcess
            if ($pidKey -eq "0" -or $pidKey -eq "_Total") { continue }
            $readBytes = [int64]0
            $writeBytes = [int64]0
            try { $readBytes = [int64]$r.IOReadBytesPerSec } catch {}
            try { $writeBytes = [int64]$r.IOWriteBytesPerSec } catch {}
            if ($readBytes -lt 0) { $readBytes = 0 }
            if ($writeBytes -lt 0) { $writeBytes = 0 }
            $ioMap[$pidKey] = @{ Read = $readBytes; Write = $writeBytes }
        }
        Set-ProviderOk "diskio"
    }
} catch {
    Add-Error "diskio" $_.Exception.Message
}
if (-not $providers.ContainsKey("diskio")) {
    Set-ProviderOk "diskio"
}

# 4c. Network — TcpConnections capped 200 + UdpListeners capped 50
$networkData = @{
    TcpConnections = @()
    UdpListeners = @()
}
$tcpCountByPid = @{}
try {
    $conns = @()
    $rawConns = Get-NetTCPConnection -ErrorAction Stop | Select-Object -First 200
    foreach ($c in $rawConns) {
        $entry = @{
            LocalAddress = [string]$c.LocalAddress
            LocalPort = [int]$c.LocalPort
            RemoteAddress = [string]$c.RemoteAddress
            RemotePort = [int]$c.RemotePort
            State = [string]$c.State
            PID = [int]$c.OwningProcess
        }
        $conns += $entry
        $k = [string]$entry.PID
        if ($tcpCountByPid.ContainsKey($k)) { $tcpCountByPid[$k] = $tcpCountByPid[$k] + 1 } else { $tcpCountByPid[$k] = 1 }
    }
    $networkData.TcpConnections = $conns
    # UdpListeners best-effort
    try {
        $udpRaw = Get-NetUDPEndpoint -ErrorAction Stop | Select-Object -First 50
        $udpList = @()
        foreach ($u in $udpRaw) {
            $pidVal = 0
            try { if ($null -ne $u.OwningProcess) { $pidVal = [int]$u.OwningProcess } } catch {}
            $udpList += @{
                LocalAddress = [string]$u.LocalAddress
                LocalPort = [int]$u.LocalPort
                PID = [int]$pidVal
            }
        }
        $networkData.UdpListeners = $udpList
    } catch {
        $networkData.UdpListeners = @()
    }
    Set-ProviderOk "network"
} catch {
    Add-Error "network" $_.Exception.Message
    $networkData.TcpConnections = @()
    $networkData.UdpListeners = @()
}

# 4d. Volumes — Win32_LogicalDisk + Win32_Volume + SMART
$volumesData = @()
try {
    $smartMap = @{}
    $anyPredictFail = $false
    try {
        $smartInstances = Get-CimInstance -Namespace root/wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop
        foreach ($s in $smartInstances) {
            $pred = $false
            try { $pred = [bool]$s.PredictFailure } catch {}
            if ($pred) { $anyPredictFail = $true }
            $key = ""
            try { $key = [string]$s.InstanceName } catch {}
            if ($key) { $smartMap[$key] = $pred }
        }
    } catch {
        # SMART optional
    }

    $logicalDisks = Get-CimInstance Win32_LogicalDisk -ErrorAction Stop
    foreach ($d in $logicalDisks) {
        $deviceId = ""
        try { $deviceId = [string]$d.DeviceID } catch {}
        if (-not $deviceId) { continue }
        $size = [int64]0
        $free = [int64]0
        try { if ($null -ne $d.Size) { $size = [int64]$d.Size } } catch {}
        try { if ($null -ne $d.FreeSpace) { $free = [int64]$d.FreeSpace } } catch {}
        if ($size -lt 0) { $size = 0 }
        if ($free -lt 0) { $free = 0 }
        if ($free -gt $size -and $size -gt 0) { $free = $size }
        $label = ""
        try { if ($null -ne $d.VolumeName) { $label = [string]$d.VolumeName } } catch {}
        $fs = ""
        try { if ($null -ne $d.FileSystem) { $fs = [string]$d.FileSystem } } catch {}
        $driveType = 0
        try { $driveType = [int]$d.DriveType } catch {}
        $health = "OK"
        if ($anyPredictFail) { $health = "PredFail" }
        $volumesData += @{
            DeviceID = $deviceId
            Label = $label
            FileSystem = $fs
            SizeBytes = $size
            FreeBytes = $free
            HealthStatus = $health
            DriveType = $driveType
        }
    }
    # Supplement with Win32_Volume for volumes not already covered
    try {
        $existingIds = @()
        foreach ($v in $volumesData) { $existingIds += $v.DeviceID }
        $extraVols = Get-CimInstance Win32_Volume -ErrorAction Stop | Where-Object { $_.DriveLetter -and $existingIds -notcontains $_.DriveLetter }
        foreach ($v in $extraVols) {
            $size = [int64]0
            $free = [int64]0
            try { if ($null -ne $v.Capacity) { $size = [int64]$v.Capacity } } catch {}
            try { if ($null -ne $v.FreeSpace) { $free = [int64]$v.FreeSpace } } catch {}
            if ($size -lt 0) { $size = 0 }
            if ($free -lt 0) { $free = 0 }
            if ($free -gt $size -and $size -gt 0) { $free = $size }
            $did = ""
            try { $did = if ($v.DriveLetter) { [string]$v.DriveLetter } else { [string]$v.DeviceID } } catch {}
            $label2 = ""
            try { if ($null -ne $v.Label) { $label2 = [string]$v.Label } } catch {}
            $fs2 = ""
            try { if ($null -ne $v.FileSystem) { $fs2 = [string]$v.FileSystem } } catch {}
            $volumesData += @{
                DeviceID = $did
                Label = $label2
                FileSystem = $fs2
                SizeBytes = $size
                FreeBytes = $free
                HealthStatus = "OK"
                DriveType = 3
            }
        }
    } catch {
        # supplemental optional
    }
    Set-ProviderOk "volumes"
} catch {
    Add-Error "volumes" $_.Exception.Message
    $volumesData = @()
}

# 4e. Startup — Win32_StartupCommand capped 100
$startupData = @()
try {
    $rawStartup = Get-CimInstance Win32_StartupCommand -ErrorAction Stop | Select-Object -First 100
    foreach ($s in $rawStartup) {
        $nameVal = ""
        $cmdVal = ""
        $locVal = ""
        $userVal = ""
        try { if ($null -ne $s.Name) { $nameVal = [string]$s.Name } } catch {}
        try { if ($null -ne $s.Command) { $cmdVal = [string]$s.Command } } catch {}
        try { if ($null -ne $s.Location) { $locVal = [string]$s.Location } } catch {}
        try { if ($null -ne $s.User) { $userVal = [string]$s.User } } catch {}
        $startupData += @{
            Name = $nameVal
            Command = $cmdVal
            Location = $locVal
            User = $userVal
        }
    }
    Set-ProviderOk "startup"
} catch {
    Add-Error "startup" $_.Exception.Message
    $startupData = @()
}

# Enrich AllProcesses with IO and TcpConnectionCount
for ($i = 0; $i -lt $allProcesses.Count; $i++) {
    $pidKey = [string]$allProcesses[$i].PID
    if ($ioMap.ContainsKey($pidKey)) {
        $allProcesses[$i].IOReadBytes = [int64]$ioMap[$pidKey].Read
        $allProcesses[$i].IOWriteBytes = [int64]$ioMap[$pidKey].Write
    } else {
        $allProcesses[$i].IOReadBytes = [int64]0
        $allProcesses[$i].IOWriteBytes = [int64]0
    }
    if ($tcpCountByPid.ContainsKey($pidKey)) {
        $allProcesses[$i].TcpConnectionCount = [int]$tcpCountByPid[$pidKey]
    } else {
        $allProcesses[$i].TcpConnectionCount = [int]0
    }
    if ($allProcesses[$i].IOReadBytes -lt 0) { $allProcesses[$i].IOReadBytes = 0 }
    if ($allProcesses[$i].IOWriteBytes -lt 0) { $allProcesses[$i].IOWriteBytes = 0 }
    if ($allProcesses[$i].TcpConnectionCount -lt 0) { $allProcesses[$i].TcpConnectionCount = 0 }
}

# 4f. RuntimeGroups — generalize WebView2 logic to electron/node/python/webview2
$runtimeGroups = @()
try {
    $runtimeNames = @('msedgewebview2','electron','Code','node','python','pythonw')
    $runtimeNameLower = $runtimeNames | ForEach-Object { $_.ToLower() }
    # Build PID map for host resolution
    $pidMap = @{}
    foreach ($proc in $allProcesses) { $pidMap[[string]$proc.PID] = $proc }
    # Helper: determine runtime string for a process, or $null if not runtime
    function Get-RuntimeKind($proc) {
        $n = ($proc.Name).ToLower()
        $p = if ($proc.Path) { ($proc.Path).ToLower() } else { "" }
        if ($n -eq 'msedgewebview2') { return 'webview2' }
        if ($n -eq 'electron' -or $n -eq 'code' -or $p.Contains('electron')) { return 'electron' }
        if ($n -eq 'node' -or $p.Contains('node')) { return 'node' }
        if ($n -eq 'python' -or $n -eq 'pythonw' -or $p.Contains('python')) { return 'python' }
        return $null
    }
    function Find-HostName($proc) {
        $seen = @{}
        $cur = $proc
        for ($depth = 0; $depth -lt 12; $depth++) {
            $ppid = [string]$cur.ParentPID
            if (-not $ppid -or $ppid -eq "0" -or $seen.ContainsKey($ppid)) { break }
            $seen[$ppid] = $true
            if (-not $pidMap.ContainsKey($ppid)) {
                # fallback: try CommandLine exe name from CIM
                if ($cimProcesses.ContainsKey($ppid) -and $cimProcesses[$ppid].CommandLine) {
                    $cl = [string]$cimProcesses[$ppid].CommandLine
                    if ($cl -match '^\s*"?([^"]+)"?') { return [System.IO.Path]::GetFileNameWithoutExtension($Matches[1]) }
                }
                break
            }
            $parent = $pidMap[$ppid]
            $pr = Get-RuntimeKind $parent
            if (-not $pr) {
                $h = $parent.Name
                if (-not $h -and $cimProcesses.ContainsKey($ppid) -and $cimProcesses[$ppid].CommandLine) {
                    $cl = [string]$cimProcesses[$ppid].CommandLine
                    if ($cl -match '^\s*"?([^"]+)"?') { $h = [System.IO.Path]::GetFileNameWithoutExtension($Matches[1]) }
                }
                if ($h) { return $h }
                return "unknown"
            }
            $cur = $parent
        }
        # fallback: direct parent name or exe from CommandLine
        $origParent = [string]$proc.ParentPID
        if ($pidMap.ContainsKey($origParent)) { return $pidMap[$origParent].Name }
        if ($cimProcesses.ContainsKey([string]$proc.PID) -and $cimProcesses[[string]$proc.PID].CommandLine) {
            $cl = [string]$cimProcesses[[string]$proc.PID].CommandLine
            if ($cl -match '^\s*"?([^"]+)"?') { return [System.IO.Path]::GetFileNameWithoutExtension($Matches[1]) }
        }
        return "unknown"
    }
    $groupMap = @{}
    foreach ($proc in $allProcesses) {
        $isRuntime = $false
        $lname = ($proc.Name).ToLower()
        if ($runtimeNameLower -contains $lname) { $isRuntime = $true }
        elseif ($proc.Path -and ($proc.Path.ToLower().Contains('electron') -or $proc.Path.ToLower().Contains('node') -or $proc.Path.ToLower().Contains('python'))) { $isRuntime = $true }
        if (-not $isRuntime) { continue }
        $rt = Get-RuntimeKind $proc
        if (-not $rt) { continue }
        $hostName = Find-HostName $proc
        $key = "$rt|$hostName"
        if (-not $groupMap.ContainsKey($key)) {
            $groupMap[$key] = @{ Runtime = $rt; Host = $hostName; Count = 0; TotalWorkingSet = [int64]0; TotalCpu = 0.0; Pids = @() }
        }
        $g = $groupMap[$key]
        $g.Count += 1
        $g.TotalWorkingSet = [int64]($g.TotalWorkingSet + [int64]$proc.WorkingSet)
        $g.TotalCpu = [Math]::Round($g.TotalCpu + [double]$proc.CPU, 2)
        $g.Pids += [int]$proc.PID
    }
    foreach ($k in $groupMap.Keys) { $runtimeGroups += $groupMap[$k] }
    Set-ProviderOk "runtimegroups"
} catch {
    Add-Error "runtimegroups" $_.Exception.Message
    $runtimeGroups = @()
}

# 4g. Sensors — best-effort WMI thermal
$sensors = @{ CpuTempC = $null }
try {
    $foundSensor = $false
    try {
        $tz = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
        foreach ($t in $tz) {
            if ($null -ne $t.CurrentTemperature) {
                $kelvin10 = [double]$t.CurrentTemperature
                $celsius = ($kelvin10 / 10.0) - 273.15
                if ($celsius -gt -55 -and $celsius -lt 200) {
                    $sensors.CpuTempC = [Math]::Round($celsius, 1)
                    $foundSensor = $true
                    break
                }
            }
        }
    } catch {}
    if (-not $foundSensor) {
        try {
            $perfTz = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop
            foreach ($pt in $perfTz) {
                $tempVal = $null
                try { $tempVal = $pt.Temperature } catch {}
                if ($null -ne $tempVal) {
                    $c = [double]$tempVal
                    if ($c -gt -55 -and $c -lt 200) {
                        $sensors.CpuTempC = [Math]::Round($c, 1)
                        $foundSensor = $true
                        break
                    }
                }
            }
        } catch {}
    }
    if ($foundSensor) { Set-ProviderOk "sensors" } else { $providers["sensors"] = "unavailable" }
} catch {
    Add-Error "sensors" $_.Exception.Message
    $sensors = @{ CpuTempC = $null }
}

# 4h. Docker — docker ps try/catch capped 20
$dockerData = @{ Containers = @() }
try {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            $rawLines = & docker ps --format "{{json .}}" 2>&1 | Where-Object { $_.Trim() -ne "" } | Select-Object -First 20
            $containers = @()
            foreach ($line in $rawLines) {
                try {
                    $obj = $line | ConvertFrom-Json -ErrorAction Stop
                    $cid = ""; $cimg = ""; $cstate = ""; $cnames = ""
                    try { $cid = [string]($obj.ID); if (-not $cid) { $cid = [string]($obj.Id) } } catch {}
                    try { $cimg = [string]$obj.Image } catch {}
                    try { $cstate = [string]$obj.State; if (-not $cstate) { $cstate = [string]$obj.Status } } catch {}
                    try { $cnames = [string]$obj.Names; if (-not $cnames) { $cnames = [string]$obj.Name } } catch {}
                    $containers += @{ Id = $cid; Image = $cimg; State = $cstate; Names = $cnames }
                } catch {}
            }
            $dockerData.Containers = $containers
            Set-ProviderOk "docker"
        } catch {
            Add-Error "docker" $_.Exception.Message
            $dockerData.Containers = @()
        }
    } else {
        $providers["docker"] = "absent"
        $dockerData.Containers = @()
    }
} catch {
    Add-Error "docker" $_.Exception.Message
    $dockerData.Containers = @()
}

$wslDistros = @()
$wslVersion = $null
$wslConfigParsed = @{ exists = $false; memory = $null; rawMemory = $null; valid = $null; source = $null; errors = @() }
$wslProvidersNote = ""

if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    try {
        # Try wsl --version
        $verOut = & wsl.exe --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $verOut) { $wslVersion = $verOut.Trim().Substring(0, [Math]::Min(800, $verOut.Trim().Length)) }
    } catch {}
    try {
        $wslOut = & wsl.exe -l -v 2>&1 | Out-String
        if ($wslOut -match '\sN\sA\sM\sE') {
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
                $wslDistros += @{ Default = $default; Name = $name; State = $state; Version = $version }
            }
        }
        Set-ProviderOk "wsl"
    } catch {
        Add-Error "wsl" $_.Exception.Message
    }
} else {
    $providers["wsl"] = "absent"
}

# 5b. Parse .wslconfig for [wsl2] memory=
$wslConfigPath = Join-Path $HOME ".wslconfig"
if (Test-Path $wslConfigPath) {
    $wslConfigParsed.exists = $true
    $wslConfigParsed.source = $wslConfigPath
    try {
        $content = Get-Content $wslConfigPath -Raw -ErrorAction Stop
        $inWsl2 = $false
        $found = $false
        foreach ($rawLine in ($content -split "`r?`n")) {
            $line = $rawLine.Trim()
            if ($line -match '^\s*[#;]') { continue }
            if ($line -match '^\s*\[(.+)\]\s*$') {
                $inWsl2 = ($Matches[1].Trim().ToLower() -eq 'wsl2')
                continue
            }
            if ($inWsl2 -and $line -match '^\s*memory\s*=\s*(.+?)\s*$') {
                $found = $true
                $rawVal = $Matches[1].Trim().Trim('"').Trim("'")
                $wslConfigParsed.rawMemory = $rawVal
                # Validate: e.g. 4GB, 4096MB, 4G
                if ($rawVal -match '^\s*(\d+(?:\.\d+)?)\s*(GB|MB|G|M)?\s*$') {
                    $num = [double]$Matches[1]
                    $unit = if ($Matches[2]) { $Matches[2].ToUpper() } else { "GB" }
                    if ($unit -eq "G") { $unit = "GB" }
                    if ($unit -eq "M") { $unit = "MB" }
                    $wslConfigParsed.memory = "$num$unit"
                    $wslConfigParsed.valid = $true
                    # normalize to bytes for display
                    $bytes = if ($unit -eq "GB") { [int64]($num * 1024 * 1024 * 1024) } else { [int64]($num * 1024 * 1024) }
                    $wslConfigParsed.memoryBytes = $bytes
                } else {
                    $wslConfigParsed.memory = $null
                    $wslConfigParsed.valid = $false
                    $wslConfigParsed.errors += "Invalid memory value '$rawVal'"
                }
            }
        }
        if (-not $found) {
            $wslConfigParsed.valid = $null
        }
        Set-ProviderOk "wslconfig"
    } catch {
        Add-Error "wslconfig" $_.Exception.Message
        $wslConfigParsed.errors += $_.Exception.Message
    }
} else {
    $providers["wslconfig"] = "absent"
}

$data = @{
    Cores = [int]$cores
    Memory = $memoryData
    AllProcesses = $allProcesses
    WebViewProcesses = $webviewProcesses
    RuntimeGroups = $runtimeGroups
    Sensors = $sensors
    Docker = $dockerData
    WSL = @{
        Distros = $wslDistros
        Version = $wslVersion
        ConfigExists = $wslConfigParsed.exists
        Config = $wslConfigParsed
    }
    SampleMeta = @{
        elapsedSeconds = [Math]::Round($elapsed, 3)
        processCount = $allProcesses.Count
    }
    Network = $networkData
    Volumes = $volumesData
    Startup = $startupData
}

$envelope = @{
    capturedAt = $capturedAt
    schemaVersion = $schemaVersion
    providers = $providers
    errors = $errors
    data = $data
}

# Also emit legacy top-level for backward compat (without duplicating envelope keys)
$legacy = @{
    Cores = $data.Cores
    Memory = $data.Memory
    AllProcesses = $data.AllProcesses
    WebViewProcesses = $data.WebViewProcesses
    RuntimeGroups = $data.RuntimeGroups
    Sensors = $data.Sensors
    Docker = $data.Docker
    WSL = $data.WSL
    Network = $data.Network
    Volumes = $data.Volumes
    Startup = $data.Startup
}
$out = $envelope.Clone()
foreach ($k in $legacy.Keys) { $out[$k] = $legacy[$k] }
$out | ConvertTo-Json -Depth 6 -Compress
