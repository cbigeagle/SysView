document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshIcon = refreshBtn.querySelector('.refresh-icon');
    const lastUpdatedSpan = document.getElementById('last-updated');
    const cpuTotalSpan = document.getElementById('cpu-total');
    const ramUsedPctSpan = document.getElementById('ram-used-pct');
    const ramUsedRatioSpan = document.getElementById('ram-used-ratio');
    const wvCountSpan = document.getElementById('wv-count');
    const wvMemTotalSpan = document.getElementById('wv-mem-total');
    const nonpagedPoolSpan = document.getElementById('nonpaged-pool');
    const poolStatusSpan = document.getElementById('pool-status');
    const poolWarningIcon = document.getElementById('pool-warning-icon');
    
    const sizeInUseSpan = document.getElementById('size-inuse');
    const sizeStandbySpan = document.getElementById('size-standby');
    const sizeNonpagedSpan = document.getElementById('size-nonpaged');
    const sizePagedSpan = document.getElementById('size-paged');
    const nonpagedDetailCard = document.getElementById('nonpaged-detail-card');
    
    const memoryBarChart = document.getElementById('memory-bar-chart');
    const memoryLegendList = document.getElementById('memory-legend-list');
    
    const webviewGroupsContainer = document.getElementById('webview-groups');
    const wvSearchInput = document.getElementById('wv-search');
    const memoryHogsTable = document.getElementById('memory-hogs-table');
    const diagnosticInsightsContainer = document.getElementById('diagnostic-insights');
    
    let currentData = null;

    // Helper functions
    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatGB(bytes) {
        if (!bytes) return '0.00 GB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function getWebViewExeName(commandLine) {
        if (!commandLine) return null;
        // Parse exe name from --webview-exe-name parameter
        const match = commandLine.match(/--webview-exe-name=([^\s"'\\]+)/);
        if (match) return match[1];
        
        // Parse from user data dir path as a hint
        const userMatch = commandLine.match(/--user-data-dir="?.*\\Microsoft\\(Olk|Teams|OneDrive)"?/i);
        if (userMatch) {
            if (userMatch[1].toLowerCase() === 'olk') return 'Outlook (olk)';
            if (userMatch[1].toLowerCase() === 'teams') return 'Teams';
            if (userMatch[1].toLowerCase() === 'onedrive') return 'OneDrive';
        }
        return null;
    }

    // Classifies the WebView2 process role based on command line arguments
    function getProcessRole(commandLine) {
        if (!commandLine) return { role: 'other', desc: 'Utility Helper Process' };
        
        const cl = commandLine.toLowerCase();
        
        if (cl.includes('--type=renderer')) {
            return {
                role: 'renderer',
                desc: 'Renderer Process: Displays web layout, compiles CSS styles, and runs application JavaScript inside a secure sandboxed container.'
            };
        }
        if (cl.includes('--type=gpu-process')) {
            return {
                role: 'gpu',
                desc: 'GPU Process: Interacts with the graphics card to handle 3D composting, hardware-accelerated drawing, and smooth interface transitions.'
            };
        }
        if (cl.includes('--type=crashpad-handler')) {
            return {
                role: 'crashpad',
                desc: 'Crashpad Handler: Background monitor that intercepts critical process failures and writes crash logs to your storage.'
            };
        }
        if (cl.includes('--type=utility')) {
            if (cl.includes('network.mojom.networkservice')) {
                return {
                    role: 'network',
                    desc: 'Network Service: Manages HTTP queries, socket connections, network security (SSL/TLS), and asset caching.'
                };
            }
            if (cl.includes('storage.mojom.storageservice')) {
                return {
                    role: 'storage',
                    desc: 'Storage Service: Manages localized application databases (IndexedDB, cookies, cookies, localStorage).'
                };
            }
            if (cl.includes('audio.mojom.audioservice')) {
                return {
                    role: 'other',
                    desc: 'Audio Service: Handles sound synthesis, inputs (microphones), and outputs (speakers).'
                };
            }
            if (cl.includes('video_capture.mojom.videocaptureservice')) {
                return {
                    role: 'other',
                    desc: 'Video Capture: Manages webcam feeds and hardware video inputs.'
                };
            }
            return {
                role: 'other',
                desc: 'Utility Process: Performs small, isolated background service tasks requested by the browser process.'
            };
        }
        
        // No --type means it's the main browser process coordinating everything
        if (cl.includes('msedgewebview2.exe')) {
            return {
                role: 'browser',
                desc: 'Browser/Host Process: The primary WebView2 manager. Coordinates window sizing, input events, IPC, and manages the lifecycle of all other child processes.'
            };
        }
        
        return {
            role: 'other',
            desc: 'Host application or background helper process.'
        };
    }

    // Resolves true non-webview host application by going up parent process tree
    function findHostApp(proc, allProcessesMap) {
        let current = proc;
        const maxDepth = 10;
        let depth = 0;
        
        while (current && current.ParentPID && current.ParentPID !== 0 && depth < maxDepth) {
            depth++;
            const parentId = current.ParentPID.toString();
            const parent = allProcessesMap[parentId];
            
            if (parent) {
                if (parent.Name.toLowerCase() !== 'msedgewebview2') {
                    return {
                        name: parent.Name,
                        pid: parent.PID,
                        path: parent.Path || ''
                    };
                }
                current = parent;
            } else {
                break;
            }
        }
        
        // If parent process is gone or unresolvable, try to parse command line flags
        const parsedName = getWebViewExeName(proc.CommandLine);
        if (parsedName) {
            return {
                name: parsedName,
                pid: proc.ParentPID || 0,
                path: ''
            };
        }
        
        return {
            name: 'Unknown Host Application',
            pid: proc.ParentPID || 0,
            path: ''
        };
    }

    // Main Fetch Function
    async function grabSnapshot() {
        // Show Loading States
        refreshBtn.disabled = true;
        refreshIcon.classList.add('spinning');
        document.querySelector('.pulse-indicator').classList.add('loading');
        lastUpdatedSpan.textContent = 'Refreshing system telemetry...';
        
        try {
            const response = await fetch('/api/snapshot');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            currentData = data;
            
            // Render UI
            updateUI(data);
            
        } catch (error) {
            console.error('Error fetching snapshot:', error);
            lastUpdatedSpan.textContent = 'Error fetching snapshot';
            
            // Fallback content in case of server loss
            diagnosticInsightsContainer.innerHTML = `
                <div class="insight-item danger">
                    <div class="insight-icon">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    </div>
                    <div class="insight-content">
                        <h4>Failed to communicate with SysView service</h4>
                        <p>Verify that <code>SysView.exe</code> is running locally on your computer and hasn't been closed.</p>
                    </div>
                </div>
            `;
        } finally {
            refreshBtn.disabled = false;
            refreshIcon.classList.remove('spinning');
            document.querySelector('.pulse-indicator').classList.remove('loading');
        }
    }

    function updateUI(data) {
        // Update Timestamp
        const now = new Date();
        lastUpdatedSpan.textContent = `Last update: ${now.toLocaleTimeString()}`;
        
        // 1. Get process maps
        const allProcessesMap = {};
        let totalCpuUsed = 0.0;
        
        data.AllProcesses.forEach(p => {
            allProcessesMap[p.PID.toString()] = p;
            totalCpuUsed += p.CPU;
        });
        
        // Update CPU indicator
        cpuTotalSpan.textContent = `${totalCpuUsed.toFixed(1)}%`;

        // 2. RAM calculations
        const mem = data.Memory;
        const totalRAM = mem.TotalPhysicalBytes;
        const availRAM = mem.AvailableBytes;
        const usedRAM = totalRAM - availRAM;
        const usedRAMPct = Math.round((usedRAM / totalRAM) * 100);
        
        ramUsedPctSpan.textContent = `${usedRAMPct}%`;
        ramUsedRatioSpan.textContent = `${(usedRAM / (1024*1024*1024)).toFixed(1)} GB / ${(totalRAM / (1024*1024*1024)).toFixed(0)} GB`;
        
        // 3. Update memory cards sizes
        sizeInUseSpan.textContent = formatGB(mem.InUseBytes);
        sizeStandbySpan.textContent = formatGB(mem.StandbyBytes);
        sizeNonpagedSpan.textContent = formatBytes(mem.NonpagedPoolBytes);
        sizePagedSpan.textContent = formatBytes(mem.PagedPoolBytes);
        
        // Update Non-paged warning thresholds
        const nonPagedPoolMB = mem.NonpagedPoolBytes / (1024 * 1024);
        nonpagedPoolSpan.textContent = `${nonPagedPoolMB.toFixed(0)} MB`;
        
        if (nonPagedPoolMB > 1500) {
            poolStatusSpan.textContent = 'Leak Alert';
            poolStatusSpan.style.color = 'var(--accent-danger)';
            poolWarningIcon.classList.add('warning');
            nonpagedDetailCard.classList.add('warning');
        } else if (nonPagedPoolMB > 1000) {
            poolStatusSpan.textContent = 'High Usage';
            poolStatusSpan.style.color = 'var(--accent-pool)';
            poolWarningIcon.classList.add('warning');
            nonpagedDetailCard.classList.add('warning');
        } else {
            poolStatusSpan.textContent = 'Healthy';
            poolStatusSpan.style.color = 'var(--accent-success)';
            poolWarningIcon.classList.remove('warning');
            nonpagedDetailCard.classList.remove('warning');
        }

        // 4. Render Stack Bar Chart
        renderMemoryBar(mem);
        
        // 5. Group WebView2 Processes
        renderWebViewGroups(data.WebViewProcesses, allProcessesMap);
        
        // 6. Render top memory hogs
        renderMemoryHogs(data.AllProcesses);
        
        // 6.5 Render WSL virtualization section
        renderWSLSection(data.WSL, data.AllProcesses);
        
        // 7. Run diagnostics recommendations engine
        runDiagnosticsEngine(mem, data.WebViewProcesses, allProcessesMap);
    }

    function renderMemoryBar(mem) {
        const total = mem.TotalPhysicalBytes;
        
        // Segments byte counts
        const segments = [
            { id: 'inuse', name: 'In-Use', bytes: mem.InUseBytes, className: 'seg-inuse', color: '#ec4899' },
            { id: 'standby', name: 'Standby Cache', bytes: mem.StandbyBytes, className: 'seg-standby', color: '#6366f1' },
            { id: 'nonpaged', name: 'Non-Paged Pool', bytes: mem.NonpagedPoolBytes, className: 'seg-nonpaged', color: '#f59e0b' },
            { id: 'paged', name: 'Paged Pool', bytes: mem.PagedPoolBytes, className: 'seg-paged', color: '#10b981' },
            { id: 'reserved', name: 'Hardware Reserved', bytes: mem.HardwareReservedBytes, className: 'seg-reserved', color: '#64748b' }
        ];
        
        // Calculate remaining free RAM
        const accountedBytes = segments.reduce((sum, s) => sum + s.bytes, 0);
        const freeBytes = Math.max(0, total - accountedBytes);
        segments.push({ id: 'free', name: 'Free (Zeroed)', bytes: freeBytes, className: 'seg-free', color: '#1e293b' });
        
        // Calculate percentages
        memoryBarChart.innerHTML = '';
        memoryLegendList.innerHTML = '';
        
        segments.forEach(seg => {
            const pct = (seg.bytes / total) * 100;
            if (pct <= 0.1) return; // skip tiny entries
            
            // Insert segment bar
            const div = document.createElement('div');
            div.className = `memory-segment ${seg.className}`;
            div.style.width = `${pct}%`;
            div.title = `${seg.name}: ${formatGB(seg.bytes)} (${pct.toFixed(1)}%)`;
            memoryBarChart.appendChild(div);
            
            // Insert legend item
            const legend = document.createElement('div');
            legend.className = 'legend-item';
            legend.innerHTML = `
                <span class="legend-color" style="background-color: ${seg.color}"></span>
                <span>${seg.name}: <strong>${formatGB(seg.bytes)}</strong> (${pct.toFixed(0)}%)</span>
            `;
            memoryLegendList.appendChild(legend);
        });
    }

    function renderWebViewGroups(wvProcesses, allProcessesMap) {
        wvCountSpan.textContent = wvProcesses.length;
        
        if (wvProcesses.length === 0) {
            webviewGroupsContainer.innerHTML = `
                <div class="loading-state">
                    <p>No active MS Edge WebView2 processes found.</p>
                </div>
            `;
            wvMemTotalSpan.textContent = 'Total: 0 MB';
            return;
        }

        // Group WebView2 processes by true host app
        const groups = {};
        let grandTotalMem = 0;
        
        wvProcesses.forEach(proc => {
            const host = findHostApp(proc, allProcessesMap);
            const hostKey = host.name.toLowerCase();
            
            if (!groups[hostKey]) {
                groups[hostKey] = {
                    name: host.name,
                    pid: host.pid,
                    path: host.path,
                    processes: [],
                    totalMem: 0,
                    totalCpu: 0
                };
            }
            
            groups[hostKey].processes.push(proc);
            groups[hostKey].totalMem += proc.WorkingSet;
            groups[hostKey].totalCpu += proc.CPU;
            grandTotalMem += proc.WorkingSet;
        });
        
        wvMemTotalSpan.textContent = `Total: ${(grandTotalMem / (1024 * 1024)).toFixed(0)} MB`;
        
        // Save grouped array for searching
        window.webviewGroupsData = Object.values(groups).sort((a, b) => b.totalMem - a.totalMem);
        
        // Render groups
        displayFilteredWebViewGroups();
    }

    function displayFilteredWebViewGroups() {
        const query = wvSearchInput.value.toLowerCase().trim();
        const container = webviewGroupsContainer;
        container.innerHTML = '';
        
        const filtered = (window.webviewGroupsData || []).filter(g => 
            g.name.toLowerCase().includes(query) || 
            g.processes.some(p => p.PID.toString().includes(query))
        );
        
        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="loading-state">
                    <p>No host applications match the search query.</p>
                </div>
            `;
            return;
        }
        
        filtered.forEach((group, index) => {
            const initials = group.name.replace('.exe', '').substring(0, 2).toUpperCase();
            
            const card = document.createElement('div');
            card.className = `wv-group-card ${index === 0 ? 'expanded' : ''}`; // Expand first by default
            
            // Sort children processes by memory
            group.processes.sort((a, b) => b.WorkingSet - a.WorkingSet);
            
            let childRowsHTML = '';
            group.processes.forEach(proc => {
                const roleInfo = getProcessRole(proc.CommandLine);
                
                childRowsHTML += `
                    <div class="wv-process-row">
                        <div class="wv-proc-identity">
                            <span class="pid-badge">PID ${proc.PID}</span>
                            <span class="role-badge role-${roleInfo.role}">${roleInfo.role}</span>
                        </div>
                        <div class="wv-proc-desc">
                            ${roleInfo.desc}
                        </div>
                        <div class="wv-proc-metrics">
                            <span class="wv-metric-val cpu">${proc.CPU > 0 ? proc.CPU.toFixed(1) + '%' : '0.0%'} CPU</span>
                            <span class="wv-metric-val mem">${(proc.WorkingSet / (1024 * 1024)).toFixed(0)} MB</span>
                        </div>
                    </div>
                `;
            });
            
            card.innerHTML = `
                <div class="wv-group-header">
                    <div class="wv-group-info">
                        <div class="wv-app-icon">${initials}</div>
                        <div class="wv-app-details">
                            <span class="wv-app-name">${group.name}</span>
                            <span class="wv-app-path">${group.path || 'Process path unavailable'}</span>
                        </div>
                    </div>
                    <div class="wv-group-stats">
                        <div class="wv-stat">
                            <span class="label">Processes</span>
                            <span class="value">${group.processes.length}</span>
                        </div>
                        <div class="wv-stat">
                            <span class="label">Total CPU</span>
                            <span class="value cpu">${group.totalCpu > 0 ? group.totalCpu.toFixed(1) + '%' : '0.0%'}</span>
                        </div>
                        <div class="wv-stat">
                            <span class="label">Total RAM</span>
                            <span class="value mem">${(group.totalMem / (1024 * 1024)).toFixed(0)} MB</span>
                        </div>
                    </div>
                    <div class="wv-expand-arrow">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                </div>
                <div class="wv-group-details" style="${index === 0 ? 'max-height: 1200px' : ''}">
                    <div class="wv-process-list">
                        ${childRowsHTML}
                    </div>
                </div>
            `;
            
            // Add click listener to toggle expand
            const header = card.querySelector('.wv-group-header');
            const details = card.querySelector('.wv-group-details');
            
            header.addEventListener('click', () => {
                const isExpanded = card.classList.toggle('expanded');
                if (isExpanded) {
                    details.style.maxHeight = '1200px';
                } else {
                    details.style.maxHeight = '0px';
                }
            });
            
            container.appendChild(card);
        });
    }

    const processDatabase = {
        'system': {
            safety: 'critical',
            title: 'Critical Windows OS Kernel',
            desc: 'The Windows Operating System Kernel (ntoskrnl.exe). It coordinates thread scheduling, memory management, file systems, and hardware drivers. Terminating this process will crash Windows instantly and trigger a Blue Screen of Death (BSOD).'
        },
        'registry': {
            safety: 'critical',
            title: 'Windows Registry Service',
            desc: 'Handles registry database access for all system and application configurations. Terminating this will crash core system components and trigger an immediate reboot.'
        },
        'dwm': {
            safety: 'critical',
            title: 'Desktop Window Manager',
            desc: 'Responsible for compositing 3D graphics, window frames, transparency, and display animations. Stopping it will cause your screen to turn black and force you to re-log in.'
        },
        'explorer': {
            safety: 'caution',
            title: 'Windows Shell Explorer',
            desc: 'Runs the taskbar, Start Menu, system tray, desktop background, and file manager. While closing it will not crash Windows permanently, your desktop interface will disappear. (It can be safely restarted from Task Manager via File > Run new task: explorer.exe).'
        },
        'msmpeng': {
            safety: 'critical',
            title: 'Windows Defender Antivirus',
            desc: 'The core security process of Windows Defender. It scans files, monitors activity, and blocks malware. Windows explicitly blocks standard users from terminating this process to prevent security circumvention.'
        },
        'svchost': {
            safety: 'critical',
            title: 'Windows Service Host',
            desc: 'A generic host wrapper that runs DLL-based system services (like network management, audio, windows update, firewall). Terminating critical svchost processes will cause network disconnects, loss of sound, or force-reboots.'
        },
        'lsass': {
            safety: 'critical',
            title: 'Local Security Authority Subsystem',
            desc: 'Manages user credential verification, logins, security policies, and password changes. Terminating this process will prompt a Windows warning stating that a critical system process has failed and force a system restart in 60 seconds.'
        },
        'services': {
            safety: 'critical',
            title: 'Services Control Manager',
            desc: 'Starts, stops, and coordinates all Windows services in the background. Core system process; do not terminate.'
        },
        'csrss': {
            safety: 'critical',
            title: 'Client Server Runtime Process',
            desc: 'Manages console windows, thread creation, and shutdowns. Do not terminate.'
        },
        'smss': {
            safety: 'critical',
            title: 'Session Manager Subsystem',
            desc: 'The first user-mode process started by the kernel, responsible for creating user sessions. Critical system component.'
        },
        'winlogon': {
            safety: 'critical',
            title: 'Windows Logon Application',
            desc: 'Handles logging users in and out, locking the computer (Win+L), and the Ctrl+Alt+Del secure screen. Critical system component.'
        },
        'spoolsv': {
            safety: 'caution',
            title: 'Print Spooler Service',
            desc: 'Manages print queues and printer communication. It is safe to stop if you are not planning to print anything.'
        },
        'searchhost': {
            safety: 'caution',
            title: 'Windows Search UI Host',
            desc: 'Manages the visual search window when clicking the search icon on the taskbar. It is safe to close. If closed, Windows will automatically launch a fresh instance next time you search.'
        },
        'searchindexer': {
            safety: 'caution',
            title: 'Windows Search Indexer',
            desc: 'Indexes your files, emails, and apps in the background for fast search queries. Safe to close, but search queries will become slower and file indexing will pause.'
        },
        'onedrive': {
            safety: 'caution',
            title: 'Microsoft OneDrive Sync Client',
            desc: 'Synchronizes your files to the Microsoft OneDrive cloud. It is safe to close, but background syncing of your documents and desktop files will pause until launched again.'
        },
        'googledrivefs': {
            safety: 'caution',
            title: 'Google Drive Desktop',
            desc: 'Mounts your Google Drive folder as a local drive and syncs files. Safe to close, but syncing and access to virtual cloud-only files will pause.'
        },
        'vmmem': {
            safety: 'caution',
            title: 'Hyper-V Virtual Machine Process',
            desc: 'Represents the active RAM and CPU allocated to Hyper-V VMs or Sandbox instances. To stop it, shut down the running VM first.'
        },
        'vmmemwsl': {
            safety: 'caution',
            title: 'WSL2 Virtual Machine Engine',
            desc: 'Represents the active memory consumed by Windows Subsystem for Linux (WSL2). It is safe to stop via the "Release WSL Memory" button in this app.'
        },
        'widgets': {
            safety: 'caution',
            title: 'Windows Widgets Shell',
            desc: 'Runs the taskbar widgets panel (news, weather, stock feeds). Safe to terminate to reclaim memory.'
        },
        'shellexperiencehost': {
            safety: 'caution',
            title: 'Windows Shell Experience Host',
            desc: 'Handles visual tray flyouts (calendar, notifications, volume). Safe to close, Windows will restart it as needed.'
        },
        'chrome': {
            safety: 'safe',
            title: 'Google Chrome Browser',
            desc: 'A user application. Completely safe to close. Closing it will terminate your active web tabs and release significant memory.'
        },
        'msedge': {
            safety: 'safe',
            title: 'Microsoft Edge Browser',
            desc: 'A user application. Completely safe to close. Reclaims memory immediately.'
        },
        'discord': {
            safety: 'safe',
            title: 'Discord Desktop client',
            desc: 'User chat application. Completely safe to close.'
        },
        'teams': {
            safety: 'safe',
            title: 'Microsoft Teams',
            desc: 'Collaboration application. Completely safe to close.'
        },
        'ms-teams': {
            safety: 'safe',
            title: 'Microsoft Teams',
            desc: 'Collaboration application. Completely safe to close.'
        },
        'slack': {
            safety: 'safe',
            title: 'Slack Desktop client',
            desc: 'User chat application. Completely safe to close.'
        },
        'spotify': {
            safety: 'safe',
            title: 'Spotify music player',
            desc: 'Music streaming application. Completely safe to close.'
        },
        'sysview': {
            safety: 'caution',
            title: 'SysView Diagnostics Server',
            desc: 'This application itself! Closing it will stop the diagnostic server and close this dashboard.'
        }
    };

    function evaluateProcessSafety(proc) {
        const name = proc.Name.toLowerCase();
        
        // 1. Check database
        if (processDatabase[name]) {
            return processDatabase[name];
        }
        
        // 2. Classify by path/system characteristics
        const path = proc.Path ? proc.Path.toLowerCase() : '';
        
        if (path.includes('\\windows\\system32') || 
            name === 'conhost' || 
            name === 'taskhostw' || 
            name === 'lsass' || 
            name === 'wininit' ||
            name === 'services' || 
            name === 'smss') {
            
            // System component
            const criticalList = ['conhost', 'taskhostw', 'wininit', 'smss', 'lsass', 'services'];
            if (criticalList.includes(name)) {
                return {
                    safety: 'critical',
                    title: `Critical System Process (${proc.Name})`,
                    desc: 'A critical Windows operating system process. Terminating this will cause system instability, user logouts, or force an immediate system restart.'
                };
            }
            
            return {
                safety: 'caution',
                title: `Windows Background Service (${proc.Name})`,
                desc: 'An auxiliary Windows system component or service. Generally safe to stop, but may temporarily disable core functionalities (printing, updates, settings sync) until restarted.'
            };
        }
        
        // 3. User application defaults
        const commonApps = ['code', 'steam', 'epicgameslauncher', 'galaxyclient', 'battle.net', 'origin', 'zoom', 'webex', 'outlook', 'excel', 'winword', 'powerpnt', 'notepad', 'cmd', 'powershell', 'taskmgr'];
        if (commonApps.includes(name) || path.includes('\\program files') || path.includes('\\appdata\\local')) {
            return {
                safety: 'safe',
                title: `User Application (${proc.Name})`,
                desc: 'A user-installed program, game launcher, or browser helper running in your user account. It is completely safe to close this application to release memory.'
            };
        }
        
        // Generic Fallback
        return {
            safety: 'safe',
            title: `Application / Background Helper (${proc.Name})`,
            desc: 'A background helper or user application. Generally completely safe to close if you are not currently actively using it.'
        };
    }

    function renderMemoryHogs(allProcesses) {
        // Exclude WebView2 processes and sort by Private memory usage
        const nonWv = allProcesses.filter(p => p.Name.toLowerCase() !== 'msedgewebview2');
        nonWv.sort((a, b) => b.PrivateMemory - a.PrivateMemory);
        
        const topHogs = nonWv.slice(0, 15);
        memoryHogsTable.innerHTML = '';
        
        topHogs.forEach(p => {
            const info = evaluateProcessSafety(p);
            
            // Build the main row
            const trMain = document.createElement('tr');
            trMain.className = 'hog-row';
            trMain.setAttribute('data-pid', p.PID);
            
            let badgeColor = '';
            if (info.safety === 'critical') badgeColor = 'safety-critical';
            else if (info.safety === 'caution') badgeColor = 'safety-caution';
            else badgeColor = 'safety-safe';
            
            let winLabel = '';
            if (info.safety === 'critical') {
                winLabel = '<span style="font-size:0.7rem; color:var(--accent-danger); background:rgba(239,68,68,0.06); padding: 0.1rem 0.35rem; border-radius:3px; border:1px solid rgba(239,68,68,0.15); margin-left:0.5rem">Critical</span>';
            } else if (info.safety === 'caution') {
                winLabel = '<span style="font-size:0.7rem; color:var(--accent-pool); background:rgba(245,158,11,0.06); padding: 0.1rem 0.35rem; border-radius:3px; border:1px solid rgba(245,158,11,0.15); margin-left:0.5rem">System</span>';
            }
            
            trMain.innerHTML = `
                <td>
                    <span class="safety-indicator ${badgeColor}"></span>
                    <span style="font-weight: 500">${p.Name}</span>
                    ${winLabel}
                </td>
                <td class="text-right" style="font-family: monospace; color: var(--text-muted)">${p.PID}</td>
                <td class="text-right" style="font-weight: 600; color: #ec4899">${(p.PrivateMemory / (1024 * 1024)).toFixed(0)} MB</td>
                <td class="text-right" style="color: var(--text-secondary)">${(p.WorkingSet / (1024 * 1024)).toFixed(0)} MB</td>
                <td class="text-right" style="color: ${p.CPU > 0 ? 'var(--accent-cpu)' : 'var(--text-muted)'}">${p.CPU > 0 ? p.CPU.toFixed(1) + '%' : '0%'}</td>
            `;
            
            // Build the detail row
            const trDetail = document.createElement('tr');
            trDetail.className = 'hog-detail-row';
            
            let statusIcon = '';
            let statusLabel = '';
            if (info.safety === 'critical') {
                statusIcon = `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                `;
                statusLabel = 'Critical System Component — Do Not Terminate';
            } else if (info.safety === 'caution') {
                statusIcon = `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                `;
                statusLabel = 'System Utility / Background Service — Stop with Caution';
            } else {
                statusIcon = `
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                `;
                statusLabel = 'User Process — Safe to Terminate';
            }
            
            trDetail.innerHTML = `
                <td colspan="5">
                    <div class="hog-detail-content">
                        <div class="hog-card ${info.safety}">
                            <div class="hog-status-header">
                                ${statusIcon}
                                <span>${info.title} &bull; ${statusLabel}</span>
                            </div>
                            <p>${info.desc}</p>
                            ${p.Path ? `<p style="font-family:monospace; font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem">Path: ${p.Path}</p>` : ''}
                        </div>
                    </div>
                </td>
            `;
            
            // Add click listener to toggle expansion
            trMain.addEventListener('click', () => {
                const isExpanded = trMain.classList.contains('expanded');
                
                // Collapse all other hog rows
                const expandedRows = memoryHogsTable.querySelectorAll('.hog-row.expanded');
                expandedRows.forEach(row => {
                    if (row !== trMain) {
                        row.classList.remove('expanded');
                        const detailRow = row.nextElementSibling;
                        if (detailRow && detailRow.classList.contains('hog-detail-row')) {
                            detailRow.querySelector('.hog-detail-content').style.maxHeight = '0px';
                        }
                    }
                });
                
                // Toggle clicked row
                const detailContent = trDetail.querySelector('.hog-detail-content');
                if (isExpanded) {
                    trMain.classList.remove('expanded');
                    detailContent.style.maxHeight = '0px';
                } else {
                    trMain.classList.add('expanded');
                    detailContent.style.maxHeight = '180px';
                }
            });
            
            memoryHogsTable.appendChild(trMain);
            memoryHogsTable.appendChild(trDetail);
        });
    }

    function runDiagnosticsEngine(mem, wvProcesses, allProcessesMap) {
        diagnosticInsightsContainer.innerHTML = '';
        const insights = [];

        // 1. Check Non-Paged Pool (Driver Leaks)
        const nonPagedPoolGB = mem.NonpagedPoolBytes / (1024 * 1024 * 1024);
        if (nonPagedPoolGB > 1.5) {
            insights.push({
                type: 'danger',
                title: 'Kernel Non-Paged Pool Leak Detected!',
                desc: `Your Non-Paged Pool is taking up **${nonPagedPoolGB.toFixed(2)} GB** of RAM. Drivers allocate memory here, and it cannot be paged to disk. Since this exceeds the standard limit of 1GB, it indicates a **driver memory leak**.`,
                actions: [
                    'Update Network (Wi-Fi/Ethernet) and GPU drivers directly from the chip manufacturer (Realtek, Intel, NVIDIA). Do not rely on Windows Update.',
                    'Check for the Network Data Usage (NDU) leak. You can disable the NDU service in Registry: change <code>HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Ndu\\Start</code> value to <code>4</code> and restart.'
                ]
            });
        } else if (nonPagedPoolGB > 0.8) {
            insights.push({
                type: 'warning',
                title: 'Elevated Non-Paged Pool RAM',
                desc: `Non-Paged Pool is currently at **${(nonPagedPoolGB * 1024).toFixed(0)} MB**. Keep an eye on this value. If it continues to grow after long uptime, a driver update is recommended.`,
                actions: []
            });
        }

        // 2. Explain Standby Cache (Reassurance)
        const standbyGB = mem.StandbyBytes / (1024 * 1024 * 1024);
        const totalGB = mem.TotalPhysicalBytes / (1024 * 1024 * 1024);
        const inUseGB = mem.InUseBytes / (1024 * 1024 * 1024);
        
        if (standbyGB > 8.0) {
            insights.push({
                type: 'info',
                title: 'Large Standby Cache (Normal Behavior)',
                desc: `Windows is utilizing **${standbyGB.toFixed(1)} GB** of RAM for caching disk files (Standby list). **This is safe and expected**. It speeds up your computer. Task manager sometimes flags this incorrectly as 'used' memory, but Windows will free this instantly if your applications demand it.`,
                actions: [
                    'If you feel it slows down games, you can use Microsoft Sysinternals **RAMMap** > Empty > Empty Standby List to clear it manually.',
                    'Intelligent Standby List Cleaner (ISLC) is a reliable third-party utility that automates this clearance.'
                ]
            });
        }

        // 3. WebView2 Heavy Instances
        const wvMemMB = wvProcesses.reduce((sum, p) => sum + p.WorkingSet, 0) / (1024 * 1024);
        if (wvMemMB > 3000) {
            // Find host with highest memory
            const hostMems = {};
            wvProcesses.forEach(p => {
                const host = findHostApp(p, allProcessesMap);
                hostMems[host.name] = (hostMems[host.name] || 0) + p.WorkingSet;
            });
            const topWvHost = Object.entries(hostMems).sort((a,b) => b[1] - a[1])[0];
            
            insights.push({
                type: 'warning',
                title: 'High WebView2 Memory Footprint',
                desc: `WebView2 processes are consuming a total of **${wvMemMB.toFixed(0)} MB** of RAM. The biggest contributor is **${topWvHost[0]}** using **${(topWvHost[1] / (1024*1024)).toFixed(0)} MB**.`,
                actions: [
                    `Consider restarting <strong>${topWvHost[0]}</strong> to flush its embedded web pages and release memory.`,
                    'Disable unused tabs, graphics acceleration, or hardware options inside the app settings (e.g. Teams, Discord) to lower WebView allocations.'
                ]
            });
        }

        // 4. WebView2 High CPU load
        const highCpuWv = wvProcesses.filter(p => p.CPU > 5.0);
        if (highCpuWv.length > 0) {
            const worst = highCpuWv.sort((a,b) => b.CPU - a.CPU)[0];
            const host = findHostApp(worst, allProcessesMap);
            const role = getProcessRole(worst.CommandLine);
            insights.push({
                type: 'danger',
                title: `WebView2 Runaway CPU Detected!`,
                desc: `WebView2 Process **PID ${worst.PID}** is consuming **${worst.CPU.toFixed(1)}% CPU**. This is a **${role.role}** process hosted by **${host.name}**. This explains the persistent CPU drain.`,
                actions: [
                    `The web page hosted inside <strong>${host.name}</strong> is executing a heavy script loop or graphics rendering. Restarting this application is recommended.`,
                    `If it's Outlook or Teams, check if a specific add-in, website, or shared widget is running.`
                ]
            });
        }

        // 5. General RAM limit warnings
        const usedPct = ((totalGB - (mem.AvailableBytes / (1024*1024*1024))) / totalGB) * 100;
        if (usedPct > 88) {
            insights.push({
                type: 'warning',
                title: 'Physical RAM is Almost Saturated',
                desc: `Your overall memory usage is at **${usedPct.toFixed(0)}%** (${(inUseGB).toFixed(1)} GB actively in use). If you experience stuttering, Windows is swapping memory pages to the disk pagefile.`,
                actions: [
                    'Look at the Top Non-WebView Hogs list to find background tools (like Docker, databases, or game launchers) that can be closed.',
                    'Check if your browser has many open tabs and enable Memory Saver mode in Chrome/Edge.'
                ]
            });
        }

        // If no anomalies found, show success
        if (insights.length === 0) {
            insights.push({
                type: 'success',
                title: 'All Memory Systems Healthy!',
                desc: 'Your kernel pools, standby cache, and WebView2 instances are operating within normal thresholds. RAM is being efficiently shared, and no driver leaks or runaway CPU processes are detected.',
                actions: []
            });
        }

        // Render to DOM
        insights.forEach(ins => {
            const div = document.createElement('div');
            div.className = `insight-item ${ins.type}`;
            
            let iconSvg = '';
            if (ins.type === 'danger' || ins.type === 'warning') {
                iconSvg = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                `;
            } else if (ins.type === 'success') {
                iconSvg = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                `;
            } else {
                iconSvg = `
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                `;
            }

            let actionsHtml = '';
            if (ins.actions.length > 0) {
                actionsHtml = `
                    <ul>
                        ${ins.actions.map(act => `<li>${act}</li>`).join('')}
                    </ul>
                `;
            }

            div.innerHTML = `
                <div class="insight-icon">${iconSvg}</div>
                <div class="insight-content">
                    <h4>${ins.title}</h4>
                    <p>${ins.desc}</p>
                    ${actionsHtml}
                </div>
            `;
            diagnosticInsightsContainer.appendChild(div);
        });
    }

    // Render WSL Virtualization Section
    function renderWSLSection(wslData, allProcesses) {
        const wslDrilldown = document.getElementById('wsl-drilldown');
        const wslDistroList = document.getElementById('wsl-distro-list');
        const wslConfigStatus = document.getElementById('wsl-config-status');
        const wslDockerWarning = document.getElementById('wsl-docker-warning');
        
        // Check if WSL process is active
        const hasWslProcess = allProcesses.some(p => p.Name.toLowerCase() === 'vmmemwsl');
        const hasRunningDistros = wslData && wslData.Distros && wslData.Distros.some(d => d.State.toLowerCase() === 'running');
        
        // If not running and no distros, hide the section
        if (!hasWslProcess && !hasRunningDistros) {
            wslDrilldown.style.display = 'none';
            return;
        }
        
        wslDrilldown.style.display = 'block';
        
        // Check if Docker Desktop is actively locking WSL
        const isDockerRunning = allProcesses.some(p => p.Name.toLowerCase() === 'docker desktop' || p.Name.toLowerCase() === 'com.docker.backend');
        if (isDockerRunning && hasWslProcess) {
            wslDockerWarning.style.display = 'flex';
        } else {
            wslDockerWarning.style.display = 'none';
        }
        
        
        // Render distros
        wslDistroList.innerHTML = '';
        if (wslData && wslData.Distros && wslData.Distros.length > 0) {
            wslData.Distros.forEach(distro => {
                const row = document.createElement('div');
                row.className = 'wsl-distro-row';
                
                const isRunning = distro.State.toLowerCase() === 'running';
                const stateClass = isRunning ? 'wsl-state-running' : 'wsl-state-stopped';
                
                row.innerHTML = `
                    <div class="wsl-distro-name-container">
                        <span style="font-weight: 600; font-size: 0.95rem;">${distro.Name}</span>
                        ${distro.Default ? '<span class="wsl-default-badge">Default</span>' : ''}
                        <span style="font-size: 0.75rem; color: var(--text-muted)">v${distro.Version}</span>
                    </div>
                    <span class="wsl-state-badge ${stateClass}">${distro.State}</span>
                `;
                wslDistroList.appendChild(row);
            });
        } else {
            wslDistroList.innerHTML = `
                <div style="color: var(--text-muted); font-size: 0.9rem; padding: 0.5rem 0;">
                    No WSL distros registered (but vmmem process is running, likely starting up or shutting down).
                </div>
            `;
        }
        
        // Render config status
        wslConfigStatus.innerHTML = '';
        if (wslData && wslData.ConfigExists) {
            wslConfigStatus.className = 'wsl-config-status exists';
            wslConfigStatus.innerHTML = '<strong>✅ Memory Capping Configured:</strong> A custom <code>.wslconfig</code> file was detected. Your WSL virtual machine memory limit is capped to prevent Windows RAM starvation.';
        } else {
            wslConfigStatus.className = 'wsl-config-status missing';
            wslConfigStatus.innerHTML = '<strong>⚠️ Memory Cap Missing:</strong> No <code>.wslconfig</code> cap was detected in your home folder. WSL2 will dynamically allocate up to <strong>50% (or more) of your RAM (16GB+)</strong> and will not release it until WSL is shut down.';
        }
    }

    // Attach listeners
    refreshBtn.addEventListener('click', grabSnapshot);
    
    // WSL Shutdown Click Listener
    const wslShutdownBtn = document.getElementById('wsl-shutdown-btn');
    wslShutdownBtn.addEventListener('click', async () => {
        wslShutdownBtn.disabled = true;
        const origText = wslShutdownBtn.querySelector('span').textContent;
        wslShutdownBtn.querySelector('span').textContent = 'Releasing WSL Memory...';
        
        try {
            const res = await fetch('/api/wsl/shutdown', { method: 'POST' });
            if (!res.ok) throw new Error('WSL shutdown API failed');
            
            // Wait 1.5 seconds for WSL to complete teardown
            await new Promise(resolve => setTimeout(resolve, 1500));
            
        } catch (err) {
            console.error('Error shutting down WSL:', err);
            alert('Failed to shutdown WSL. Try running "wsl --shutdown" in an elevated PowerShell terminal.');
        } finally {
            wslShutdownBtn.querySelector('span').textContent = origText;
            wslShutdownBtn.disabled = false;
            // Grab a fresh snapshot to update the memory bar
            grabSnapshot();
        }
    });
    
    // Simple filter debounce
    let searchTimeout = null;
    wvSearchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            displayFilteredWebViewGroups();
        }, 150);
    });

    // Initial load
    grabSnapshot();
});
