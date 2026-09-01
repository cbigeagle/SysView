document.addEventListener('DOMContentLoaded', () => {
    // ── Theme: semantic tokens, persisted, system fallback ──
    const themeSelect = document.getElementById('theme-select');
    const THEME_KEY = 'sysview-theme';
    const THEMES = ['quattro', 'claude', 'apple'];
    function applyTheme(t, persist = true) {
        if (!THEMES.includes(t)) t = 'quattro';
        document.documentElement.setAttribute('data-theme', t);
        // apple auto-dark: when system is dark and user chose apple with no override, add helper class
        if (t === 'apple' && window.matchMedia('(prefers-color-scheme: dark)').matches && !localStorage.getItem(THEME_KEY + '-mode')) {
            document.documentElement.classList.add('apple-auto-dark');
        } else {
            document.documentElement.classList.remove('apple-auto-dark');
        }
        if (themeSelect) themeSelect.value = t;
        if (persist) try { localStorage.setItem(THEME_KEY, t); } catch {}
        try { localStorage.setItem(THEME_KEY + '-applied', t); } catch {}
    }
    (function initTheme() {
        let saved = null;
        try { saved = localStorage.getItem(THEME_KEY); } catch {}
        if (saved && THEMES.includes(saved)) { applyTheme(saved, false); return; }
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'quattro' : 'apple', false);
    })();
    if (themeSelect) themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
    try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch {}
            if (!saved) {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                applyTheme(prefersDark ? 'quattro' : 'apple', false);
            } else if (saved === 'apple') applyTheme('apple', false);
        });
    } catch {}
    // UI Elements
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshIcon = refreshBtn ? refreshBtn.querySelector('.refresh-icon') : null;
    const lastUpdatedSpan = document.getElementById('last-updated');
    const cpuTotalSpan = document.getElementById('cpu-total');
    const ramUsedPctSpan = document.getElementById('ram-used-pct');
    const ramUsedRatioSpan = document.getElementById('ram-used-ratio');
    const wvCountSpan = document.getElementById('wv-count');
    const wvMemTotalSpan = document.getElementById('wv-mem-total');
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
                desc: 'GPU Process: Handles graphics output and 3D compositing for the host application.'
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
                    desc: 'Storage Service: Manages local databases (IndexedDB, cookies, localStorage).'
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

    // Main Fetch Function — handles versioned envelope
    let sysViewToken = window.__SYSVIEW_TOKEN__ || null;
    async function ensureToken() {
        if (sysViewToken) return sysViewToken;
        const meta = document.querySelector('meta[name="sysview-token"]');
        if (meta && meta.content) { sysViewToken = meta.content; return sysViewToken; }
        try {
            const r = await fetch('/api/config');
            if (r.ok) { const j = await r.json(); if (j.token) sysViewToken = j.token; }
        } catch {}
        return sysViewToken;
    }
    async function grabSnapshot() {
        // Show Loading States
        refreshBtn.disabled = true;
        if (refreshIcon) refreshIcon.classList.add('spinning');
        const pulse = document.querySelector('.pulse-indicator');
        if (pulse) pulse.classList.add('loading');
        lastUpdatedSpan.textContent = 'Refreshing system telemetry...';
        
        try {
            const response = await fetch('/api/snapshot');
            if (!response.ok) {
                const txt = await response.text();
                throw new Error(`HTTP ${response.status}: ${txt.slice(0,400)}`);
            }
            
            const envelope = await response.json();
            // Unwrap versioned envelope (snapshot.ps1 v2) or legacy shape
            const data = envelope.data ? envelope.data : envelope;
            const providers = envelope.providers || {};
            const errors = envelope.errors || [];
            data._envelope = { capturedAt: envelope.capturedAt, providers, errors, schemaVersion: envelope.schemaVersion };
            currentData = data;
            
            // Render UI (handles unavailable providers)
            updateUI(data);
            
        } catch (error) {
            console.error('Error fetching snapshot:', error);
            lastUpdatedSpan.textContent = 'Error fetching snapshot';
            
            // Fallback content in case of server loss
            diagnosticInsightsContainer.innerHTML = '';
            const div = document.createElement('div');
            div.className = 'insight-item danger';
            div.innerHTML = `<div class="insight-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div><div class="insight-content"><h4>Failed to communicate with SysView service</h4><p>Verify that <code>SysView.exe</code> is running locally and hasn't been closed.</p><p class="wsl-note">Details: ${String(error.message || error).slice(0,300)}</p></div>`;
            diagnosticInsightsContainer.appendChild(div);
        } finally {
            refreshBtn.disabled = false;
            if (refreshIcon) refreshIcon.classList.remove('spinning');
            const pulse2 = document.querySelector('.pulse-indicator');
            if (pulse2) pulse2.classList.remove('loading');
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

        // 2. RAM calculations — use VisiblePhysicalBytes for OS utilization (installed = visible + hardware reserved)
        const mem = data.Memory;
        const providers = (data._envelope && data._envelope.providers) || {};
        const memUnavailable = providers.memory === 'unavailable' || !mem || (mem.VisiblePhysicalBytes === 0 && mem.TotalPhysicalBytes === 0);
        if (memUnavailable) {
            ramUsedPctSpan.textContent = 'Unavailable';
            ramUsedRatioSpan.textContent = 'Memory provider unavailable';
            sizeInUseSpan.textContent = 'Unavailable';
            sizeStandbySpan.textContent = 'Unavailable';
            sizeNonpagedSpan.textContent = 'Unavailable';
            sizePagedSpan.textContent = 'Unavailable';
            nonpagedPoolSpan.textContent = '—';
            poolStatusSpan.textContent = 'Unknown';
            poolStatusSpan.classList.remove('pool-status--danger','pool-status--warn','pool-status--good');
            memoryBarChart.innerHTML = '<div class="segment-loading">Memory provider unavailable — check errors and retry. Not a healthy zero.</div>';
            memoryLegendList.innerHTML = '';
            // still render other sections with what we have
        } else {
            const visible = mem.VisiblePhysicalBytes || mem.TotalPhysicalBytes;
            const installed = mem.TotalPhysicalBytes;
            const hwReserved = mem.HardwareReservedBytes || 0;
            const available = mem.AvailableBytes;
            const used = mem.InUseBytes != null ? mem.InUseBytes : (visible - available);
            const usedPct = visible > 0 ? Math.round((used / visible) * 100) : 0;
            
            ramUsedPctSpan.textContent = `${usedPct}%`;
            // Show visible denominator; hardware reserved as separate fact in tooltip/title
            ramUsedRatioSpan.textContent = `${(used / (1024*1024*1024)).toFixed(1)} GB / ${(visible / (1024*1024*1024)).toFixed(1)} GB visible`;
            ramUsedRatioSpan.title = `Installed: ${(installed/(1024*1024*1024)).toFixed(1)} GB, Hardware reserved: ${(hwReserved/(1024*1024*1024)).toFixed(2)} GB`;
            
            // Update memory cards sizes
            sizeInUseSpan.textContent = formatGB(mem.InUseBytes);
            sizeStandbySpan.textContent = formatGB(mem.StandbyBytes);
            sizeNonpagedSpan.textContent = mem.NonpagedPoolBytes != null ? formatBytes(mem.NonpagedPoolBytes) : 'Unavailable';
            sizePagedSpan.textContent = mem.PagedPoolBytes != null ? formatBytes(mem.PagedPoolBytes) : 'Unavailable';
            
            // Detail: show pools as part of In-Use, not separate bar; add info to card title via small note
            const poolPctVisible = visible > 0 ? (mem.NonpagedPoolBytes / visible * 100).toFixed(2) : '0';
            // Update Non-paged warning — single sample cannot prove leak; show elevated status with evidence
            const nonPagedPoolMB = mem.NonpagedPoolBytes / (1024 * 1024);
            nonpagedPoolSpan.textContent = `${nonPagedPoolMB.toFixed(0)} MB`;
            
            poolStatusSpan.classList.remove('pool-status--danger', 'pool-status--warn', 'pool-status--good');
            if (nonPagedPoolMB > 1500) {
                poolStatusSpan.textContent = `Elevated non-paged pool (${poolPctVisible}% of visible)`;
                poolStatusSpan.classList.add('pool-status--warn');
                poolWarningIcon.classList.add('warning');
                nonpagedDetailCard.classList.add('warning');
            } else if (nonPagedPoolMB > 800) {
                poolStatusSpan.textContent = `Elevated (${poolPctVisible}% of visible)`;
                poolStatusSpan.classList.add('pool-status--warn');
                poolWarningIcon.classList.add('warning');
                nonpagedDetailCard.classList.add('warning');
            } else {
                poolStatusSpan.textContent = `Within expected range (${poolPctVisible}% of visible)`;
                poolStatusSpan.classList.add('pool-status--good');
                poolWarningIcon.classList.remove('warning');
                nonpagedDetailCard.classList.remove('warning');
            }

            // Render mutually-exclusive bar
            renderMemoryBar(mem);
        }
        
        // Surface provider errors inline if any
        if (data._envelope && data._envelope.errors && data._envelope.errors.length) {
            const errNote = document.createElement('div');
            errNote.className = 'insight-item warning';
            errNote.style.marginTop = '0.5rem';
            const msgs = data._envelope.errors.map(e => `${e.provider}: ${e.message}`).join(' | ').slice(0, 600);
            errNote.innerHTML = `<div class="insight-icon">⚠</div><div class="insight-content"><h4>Provider note</h4><p>${msgs}</p></div>`;
            // prepend to diagnostic container after it renders? store for later
            data._envelope._banner = errNote;
        }
        
        // 5. Group WebView2 Processes
        renderWebViewGroups(data.WebViewProcesses, allProcessesMap);
        
        // 6. Render top memory hogs (labels corrected below)
        renderMemoryHogs(data.AllProcesses);
        
        // 6.5 Render WSL virtualization section
        renderWSLSection(data.WSL, data.AllProcesses);
        
        // 7. Run diagnostics recommendations engine
        runDiagnosticsEngine(mem, data.WebViewProcesses, allProcessesMap);
    }

    function renderMemoryBar(mem) {
        // Mutually exclusive composition based on Visible RAM (installed = visible + hardware reserved)
        const visible = mem.VisiblePhysicalBytes || mem.TotalPhysicalBytes;
        const hwReserved = mem.HardwareReservedBytes || 0;
        // Pools are detail metrics within In-Use, not additional top-level segments
        const segments = [
            { id: 'inuse', name: 'In-Use', bytes: mem.InUseBytes, className: 'seg-inuse', color: '#ec4899' },
            { id: 'standby', name: 'Standby', bytes: mem.StandbyBytes, className: 'seg-standby', color: '#6366f1' },
            { id: 'modified', name: 'Modified', bytes: mem.ModifiedBytes || 0, className: 'seg-modified', color: '#8b5cf6' },
            { id: 'free', name: 'Free/Zeroed', bytes: mem.FreeBytes != null ? mem.FreeBytes : Math.max(0, visible - (mem.InUseBytes||0) - (mem.StandbyBytes||0) - (mem.ModifiedBytes||0)), className: 'seg-free', color: '#e5e7eb' }
        ];
        // Hardware reserved is shown separately as an installed-vs-visible fact, not part of the visible bar
        // Validate invariants lightly and clamp
        segments.forEach(s => { if (s.bytes < 0) s.bytes = 0; });
        const visibleSum = segments.reduce((sum, s) => sum + s.bytes, 0);
        // If sum exceeds visible due to rounding/provider, clamp free
        if (visibleSum > visible && segments.find(s => s.id === 'free')) {
            const freeSeg = segments.find(s => s.id === 'free');
            freeSeg.bytes = Math.max(0, freeSeg.bytes - (visibleSum - visible));
        }
        
        // Calculate percentages against visible; hardware reserved shown separately
        memoryBarChart.innerHTML = '';
        memoryLegendList.innerHTML = '';
        
        segments.forEach(seg => {
            if (!seg.bytes || seg.bytes <= 0) return;
            const pct = (seg.bytes / visible) * 100;
            if (pct <= 0.2) return;
            
            const div = document.createElement('div');
            div.className = `memory-segment ${seg.className}`;
            div.style.width = `${pct}%`;
            div.title = `${seg.name}: ${formatGB(seg.bytes)} (${pct.toFixed(1)}% of visible)`;
            memoryBarChart.appendChild(div);
            
            const legend = document.createElement('div');
            legend.className = 'legend-item';
            const colorSpan = document.createElement('span');
            colorSpan.className = 'legend-color';
            colorSpan.style.backgroundColor = seg.color;
            const textSpan = document.createElement('span');
            // Use textContent for values, allow strong for bytes via separate node
            const strong = document.createElement('strong');
            strong.textContent = formatGB(seg.bytes);
            textSpan.append(`${seg.name}: `);
            textSpan.appendChild(strong);
            textSpan.append(` (${pct.toFixed(0)}%)`);
            legend.appendChild(colorSpan);
            legend.appendChild(textSpan);
            memoryLegendList.appendChild(legend);
        });
        // Hardware reserved footnote
        if (hwReserved > 0) {
            const fr = document.createElement('div');
            fr.className = 'legend-item';
            fr.style.opacity = '0.85';
            const c = document.createElement('span');
            c.className = 'legend-color';
            c.style.backgroundColor = '#64748b';
            const t = document.createElement('span');
            t.textContent = `Hardware reserved: ${formatGB(hwReserved)} (installed ${( (visible+hwReserved)/(1024*1024*1024)).toFixed(1)} GB)`;
            fr.appendChild(c);
            fr.appendChild(t);
            memoryLegendList.appendChild(fr);
        }
        // Pool detail annotation (not in bar) — add to legend as info
        const poolInfo = document.createElement('div');
        poolInfo.className = 'legend-item';
        poolInfo.style.fontSize = '0.78rem';
        const pagedGB = (mem.PagedPoolBytes||0)/(1024*1024*1024);
        const nonpagedGB = (mem.NonpagedPoolBytes||0)/(1024*1024*1024);
        poolInfo.textContent = `Pools (within In-Use): paged ${pagedGB.toFixed(2)} GB, non-paged ${nonpagedGB.toFixed(2)} GB`;
        memoryLegendList.appendChild(poolInfo);
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
            const empty = document.createElement('div');
            empty.className = 'loading-state';
            const p = document.createElement('p');
            p.textContent = 'No host applications match the search query.';
            empty.appendChild(p);
            container.appendChild(empty);
            return;
        }
        
        filtered.forEach((group, index) => {
            const initials = group.name.replace('.exe', '').substring(0, 2).toUpperCase();
            
            const card = document.createElement('div');
            card.className = `wv-group-card ${index === 0 ? 'expanded' : ''}`;
            
            group.processes.sort((a, b) => b.WorkingSet - a.WorkingSet);
            
            // Build header safely
            const header = document.createElement('div');
            header.className = 'wv-group-header';
            header.tabIndex = 0;
            header.setAttribute('role', 'button');
            header.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
            
            const info = document.createElement('div');
            info.className = 'wv-group-info';
            const icon = document.createElement('div');
            icon.className = 'wv-app-icon';
            icon.textContent = initials;
            const details = document.createElement('div');
            details.className = 'wv-app-details';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'wv-app-name';
            nameSpan.textContent = group.name;
            const pathSpan = document.createElement('span');
            pathSpan.className = 'wv-app-path';
            pathSpan.textContent = group.path || 'Process path unavailable';
            details.appendChild(nameSpan);
            details.appendChild(pathSpan);
            info.appendChild(icon);
            info.appendChild(details);
            
            const stats = document.createElement('div');
            stats.className = 'wv-group-stats';
            stats.innerHTML = `
                <div class="wv-stat"><span class="label">Processes</span><span class="value">${group.processes.length}</span></div>
                <div class="wv-stat"><span class="label">Total CPU</span><span class="value cpu">${group.totalCpu > 0 ? group.totalCpu.toFixed(1) + '%' : '0.0%'}</span></div>
                <div class="wv-stat"><span class="label">Total RAM</span><span class="value mem">${(group.totalMem / (1024 * 1024)).toFixed(0)} MB</span></div>
            `;
            const arrow = document.createElement('div');
            arrow.className = 'wv-expand-arrow';
            arrow.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            
            header.appendChild(info);
            header.appendChild(stats);
            header.appendChild(arrow);
            
            const detailsWrap = document.createElement('div');
            detailsWrap.className = 'wv-group-details';
            const list = document.createElement('div');
            list.className = 'wv-process-list';
            group.processes.forEach(proc => {
                const roleInfo = getProcessRole(proc.CommandLine);
                const row = document.createElement('div');
                row.className = 'wv-process-row';
                const identity = document.createElement('div');
                identity.className = 'wv-proc-identity';
                const pidBadge = document.createElement('span');
                pidBadge.className = 'pid-badge';
                pidBadge.textContent = `PID ${proc.PID}`;
                const roleBadge = document.createElement('span');
                roleBadge.className = `role-badge role-${roleInfo.role}`;
                roleBadge.textContent = roleInfo.role;
                identity.appendChild(pidBadge);
                identity.appendChild(roleBadge);
                const desc = document.createElement('div');
                desc.className = 'wv-proc-desc';
                desc.textContent = roleInfo.desc;
                const metrics = document.createElement('div');
                metrics.className = 'wv-proc-metrics';
                const cpuSpan = document.createElement('span');
                cpuSpan.className = 'wv-metric-val cpu';
                cpuSpan.textContent = `${proc.CPU > 0 ? proc.CPU.toFixed(1) + '%' : '0.0%'} CPU`;
                const memSpan = document.createElement('span');
                memSpan.className = 'wv-metric-val mem';
                memSpan.textContent = `${(proc.WorkingSet / (1024 * 1024)).toFixed(0)} MB`;
                metrics.appendChild(cpuSpan);
                metrics.appendChild(memSpan);
                row.appendChild(identity);
                row.appendChild(desc);
                row.appendChild(metrics);
                list.appendChild(row);
            });
            detailsWrap.appendChild(list);
            
            card.appendChild(header);
            card.appendChild(detailsWrap);
            
            const toggle = () => {
                const isExpanded = card.classList.toggle('expanded');
                header.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            };
            header.addEventListener('click', toggle);
            header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
            
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
            safety: 'caution',
            title: 'Google Chrome Browser',
            desc: 'User application. OS remains stable if closed, but unsaved tabs and form data will be lost. Use the browser itself to close it safely.'
        },
        'msedge': {
            safety: 'caution',
            title: 'Microsoft Edge Browser',
            desc: 'User application. OS remains stable if closed, but unsaved tabs will be lost.'
        },
        'discord': {
            safety: 'caution',
            title: 'Discord Desktop client',
            desc: 'User application — OS stability unaffected; closing may interrupt calls or unsaved messages.'
        },
        'teams': {
            safety: 'caution',
            title: 'Microsoft Teams',
            desc: 'User application — OS stability unaffected; closing may drop calls or unsaved chats.'
        },
        'ms-teams': {
            safety: 'caution',
            title: 'Microsoft Teams',
            desc: 'User application — OS stability unaffected; closing may drop calls.'
        },
        'slack': {
            safety: 'caution',
            title: 'Slack Desktop client',
            desc: 'User application — OS stability unaffected; closing may miss messages until reopened.'
        },
        'spotify': {
            safety: 'caution',
            title: 'Spotify music player',
            desc: 'User application — OS stability unaffected; playback will stop.'
        },
        'sysview': {
            safety: 'caution',
            title: 'SysView Diagnostics Server',
            desc: 'This application itself — stopping it closes this dashboard.'
        }
    };

    function evaluateProcessSafety(proc) {
        const name = proc.Name.toLowerCase();
        
        if (processDatabase[name]) {
            return processDatabase[name];
        }
        
        const path = proc.Path ? proc.Path.toLowerCase() : '';
        
        if (path.includes('\\windows\\system32') || 
            name === 'conhost' || 
            name === 'taskhostw' || 
            name === 'lsass' || 
            name === 'wininit' ||
            name === 'services' || 
            name === 'smss') {
            
            const criticalList = ['conhost', 'taskhostw', 'wininit', 'smss', 'lsass', 'services'];
            if (criticalList.includes(name)) {
                return {
                    safety: 'critical',
                    title: `Critical System Process (${proc.Name})`,
                    desc: 'Critical Windows OS process. Terminating may cause system instability or restart — do not terminate from this dashboard.'
                };
            }
            
            return {
                safety: 'caution',
                title: `Windows Background Service (${proc.Name})`,
                desc: 'Windows system component. OS impact if stopped; may temporarily disable functionality until restarted. Guidance only — verify signer and service association.'
            };
        }
        
        const commonApps = ['code', 'steam', 'epicgameslauncher', 'galaxyclient', 'battle.net', 'origin', 'zoom', 'webex', 'outlook', 'excel', 'winword', 'powerpnt', 'notepad', 'cmd', 'powershell', 'taskmgr'];
        if (commonApps.includes(name) || path.includes('\\program files') || path.includes('\\appdata\\local')) {
            return {
                safety: 'caution',
                title: `User Application (${proc.Name})`,
                desc: 'User-installed application. OS remains stable if closed, but unsaved work, sync, or backups may be interrupted. Guidance only — verify before action. This dashboard cannot terminate processes.'
            };
        }
        
        return {
            safety: 'caution',
            title: `Unknown — investigate (${proc.Name})`,
            desc: 'Unknown process — investigate signer, path, and service association before acting. Listed as guidance, not a safety guarantee. This dashboard cannot terminate processes.'
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
            
            const trMain = document.createElement('tr');
            trMain.className = 'hog-row';
            trMain.setAttribute('data-pid', p.PID);
            trMain.tabIndex = 0;
            trMain.setAttribute('role', 'button');
            trMain.setAttribute('aria-expanded', 'false');
            
            let badgeColor = '';
            if (info.safety === 'critical') badgeColor = 'safety-critical';
            else if (info.safety === 'caution') badgeColor = 'safety-caution';
            else badgeColor = 'safety-safe';
            
            let winLabel = '';
            if (info.safety === 'critical') {
                winLabel = '<span class="hog-badge-critical">Critical</span>';
            } else if (info.safety === 'caution') {
                winLabel = '<span class="hog-badge-system">System</span>';
            }
            
            const cpuClass = p.CPU > 0 ? 'hog-cpu--active' : 'hog-cpu--idle';
            trMain.innerHTML = `
                <td>
                    <span class="safety-indicator ${badgeColor}"></span>
                    <span class="hog-name"></span>
                    ${winLabel}
                </td>
                <td class="text-right hog-mono">${p.PID}</td>
                <td class="text-right hog-mem">${(p.PrivateMemory / (1024 * 1024)).toFixed(0)} MB</td>
                <td class="text-right hog-mono">${(p.WorkingSet / (1024 * 1024)).toFixed(0)} MB</td>
                <td class="text-right hog-cpu ${cpuClass}">${p.CPU > 0 ? p.CPU.toFixed(1) + '%' : '0%'}</td>
            `;
            // Assign dynamic name via textContent to avoid HTML injection
            const nameSpan = trMain.querySelector('.hog-name');
            if (nameSpan) nameSpan.textContent = p.Name;
            
            // Build the detail row - use safe text for path
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
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                `;
                statusLabel = 'Unknown — investigate';
            }
            trDetail.innerHTML = `
                <td colspan="5">
                    <div class="hog-detail-content">
                        <div class="hog-card ${info.safety}">
                            <div class="hog-status-header">
                                ${statusIcon}
                                <span class="hog-title"></span>
                            </div>
                            <p class="hog-desc"></p>
                            <p class="hog-path" style="display:${p.Path ? 'block' : 'none'}"></p>
                        </div>
                    </div>
                </td>
            `;
            const titleEl = trDetail.querySelector('.hog-title');
            if (titleEl) titleEl.textContent = `${info.title} \u00b7 ${statusLabel}`;
            const descEl = trDetail.querySelector('.hog-desc');
            if (descEl) descEl.textContent = info.desc;
            const pathEl = trDetail.querySelector('.hog-path');
            if (pathEl && p.Path) pathEl.textContent = `Path: ${p.Path}`;
            // Add click/keyboard listener to toggle expansion — CSS controls height, aria reflects state
            const toggleHog = () => {
                const isExpanded = trMain.classList.contains('expanded');
                const expandedRows = memoryHogsTable.querySelectorAll('.hog-row.expanded');
                expandedRows.forEach(row => { if (row !== trMain) { row.classList.remove('expanded'); row.setAttribute('aria-expanded','false'); } });
                if (isExpanded) { trMain.classList.remove('expanded'); trMain.setAttribute('aria-expanded','false'); }
                else { trMain.classList.add('expanded'); trMain.setAttribute('aria-expanded','true'); }
            };
            trMain.addEventListener('click', toggleHog);
            trMain.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHog(); } });
            memoryHogsTable.appendChild(trMain);
            memoryHogsTable.appendChild(trDetail);
        });
    }

    function runDiagnosticsEngine(mem, wvProcesses, allProcessesMap) {
        diagnosticInsightsContainer.innerHTML = '';
        const insights = [];
        const visible = mem.VisiblePhysicalBytes || mem.TotalPhysicalBytes;
        const elapsed = (mem.CPUSampleSeconds || 0.3);

        // 1. Non-paged pool — one sample cannot establish a leak; show evidence card
        const nonPagedPoolGB = mem.NonpagedPoolBytes / (1024 * 1024 * 1024);
        const poolPct = visible ? (mem.NonpagedPoolBytes / visible * 100).toFixed(2) : '0';
        if (nonPagedPoolGB > 1.2) {
            insights.push({
                type: 'warning',
                title: 'Elevated non-paged pool — investigate, not confirmed leak',
                desc: `Observed: non-paged pool ${nonPagedPoolGB.toFixed(2)} GB (${poolPct}% of visible RAM) at ${new Date().toLocaleTimeString()}. One sample cannot establish a driver leak; pool size varies with RAM, workload, drivers, and uptime.`,
                actions: [
                    'Confidence: Low (single sample). Next safe checks: run RAMMap / PoolMon to identify pool tags, note driver versions, and compare after a clean reboot.',
                    'If growth is sustained over 15–60 min under memory pressure, collect pool-tag evidence and update drivers from the vendor. Do not disable system components without tag evidence.'
                ]
            });
        } else if (nonPagedPoolGB > 0.8) {
            insights.push({
                type: 'info',
                title: 'Non-paged pool within elevated range — monitor trend',
                desc: `Observed: ${ (nonPagedPoolGB*1024).toFixed(0)} MB (${poolPct}% of visible). No leak established from this snapshot; track trend.`,
                actions: ['If you suspect growth, capture samples over time and compare pool tags before changing drivers.']
            });
        }

        // 2. Standby cache — factual
        const standbyGB = mem.StandbyBytes / (1024 * 1024 * 1024);
        if (standbyGB > 8.0) {
            insights.push({
                type: 'info',
                title: 'Large standby cache — expected behavior',
                desc: `Observed: ${standbyGB.toFixed(1)} GB standby (file cache). Windows keeps recently used files in RAM for speed and releases this memory immediately when an app needs it.`,
                actions: [
                    'No action required. If you need to clear for a benchmark, use RAMMap > Empty Standby List.'
                ]
            });
        }

        // 3. WebView2 Heavy Instances — use summed working sets estimate note
        const wvMemMB = wvProcesses.reduce((sum, p) => sum + p.WorkingSet, 0) / (1024 * 1024);
        if (wvMemMB > 3000) {
            const hostMems = {};
            wvProcesses.forEach(p => {
                const host = findHostApp(p, allProcessesMap);
                hostMems[host.name] = (hostMems[host.name] || 0) + p.WorkingSet;
            });
            const topWvHost = Object.entries(hostMems).sort((a,b) => b[1] - a[1])[0];
            
            insights.push({
                type: 'info',
                title: 'High WebView2 summed working sets',
                desc: `Observed: summed working sets ${wvMemMB.toFixed(0)} MB across ${wvProcesses.length} processes (shared pages may double-count). Top host: ${topWvHost[0]} ~${(topWvHost[1] / (1024*1024)).toFixed(0)} MB (estimate).`,
                actions: [
                    `Consider restarting ${topWvHost[0]} to release embedded pages.`,
                    'Check app settings for hardware acceleration or extra tabs.'
                ]
            });
        }

        // 4. WebView2 CPU — disclose sample interval, avoid runaway claim from single sample
        const highCpuWv = wvProcesses.filter(p => p.CPU > 5.0);
        if (highCpuWv.length > 0) {
            const worst = highCpuWv.sort((a,b) => b.CPU - a.CPU)[0];
            const host = findHostApp(worst, allProcessesMap);
            const role = getProcessRole(worst.CommandLine);
            insights.push({
                type: 'warning',
                title: `WebView2 CPU observed at ${worst.CPU.toFixed(1)}% (sample ${elapsed.toFixed(2)}s)`,
                desc: `Observed: PID ${worst.PID} (${role.role}) in ${host.name} at ${worst.CPU.toFixed(1)}% over a ${elapsed.toFixed(2)}s window (noisy; requires consecutive samples for confidence). Low confidence from single sample.`,
                actions: [
                    `If sustained, the page in ${host.name} may be busy. Restart the host and re-sample.`,
                    'For Teams/Outlook, check add-ins or widgets.'
                ]
            });
        }

        // 5. General RAM pressure — based on visible, show evidence
        const usedPct = visible ? ((visible - mem.AvailableBytes) / visible * 100) : 0;
        if (usedPct > 88) {
            const inUseGB = (mem.InUseBytes / (1024*1024*1024)).toFixed(1);
            insights.push({
                type: 'warning',
                title: `Memory pressure elevated — ${usedPct.toFixed(0)}% of visible RAM in use`,
                desc: `Observed: ${inUseGB} GB in use, ${ (mem.AvailableBytes/(1024*1024*1024)).toFixed(1)} GB available (visible ${(visible/(1024*1024*1024)).toFixed(1)} GB). Under pressure Windows may page to disk. Single-sample; confidence medium.`,
                actions: [
                    'Sort the Processes table by Private commit to find top contributors.',
                    'Close or pause heavy workloads; check browser Memory Saver.'
                ]
            });
        }

        // If no anomalies found
        if (insights.length === 0) {
            insights.push({
                type: 'success',
                title: 'No thresholds exceeded in this sample',
                desc: 'Observed sample is within current thresholds. This is a single-point view; sustained conditions require history.',
                actions: []
            });
        }

        // Render to DOM — safe text handling
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
            wslDrilldown.classList.add('hidden');
            return;
        }
        
        wslDrilldown.classList.remove('hidden');
        
        // Check if Docker Desktop is actively locking WSL
        const isDockerRunning = allProcesses.some(p => p.Name.toLowerCase() === 'docker desktop' || p.Name.toLowerCase() === 'com.docker.backend');
        if (isDockerRunning && hasWslProcess) {
            wslDockerWarning.classList.remove('hidden');
        } else {
            wslDockerWarning.classList.add('hidden');
        }
        
        
        // Render distros — use textContent for names/versions/distro strings
        wslDistroList.innerHTML = '';
        if (wslData && wslData.Distros && wslData.Distros.length > 0) {
            wslData.Distros.forEach(distro => {
                const row = document.createElement('div');
                row.className = 'wsl-distro-row';
                
                const isRunning = String(distro.State).toLowerCase() === 'running';
                const stateClass = isRunning ? 'wsl-state-running' : 'wsl-state-stopped';
                
                const left = document.createElement('div');
                left.className = 'wsl-distro-name-container';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'wsl-distro-name';
                nameSpan.textContent = distro.Name;
                left.appendChild(nameSpan);
                if (distro.Default) {
                    const badge = document.createElement('span');
                    badge.className = 'wsl-default-badge';
                    badge.textContent = 'Default';
                    left.appendChild(badge);
                }
                const verSpan = document.createElement('span');
                verSpan.className = 'wsl-distro-version';
                verSpan.textContent = `v${distro.Version}`;
                left.appendChild(verSpan);
                
                const stateBadge = document.createElement('span');
                stateBadge.className = `wsl-state-badge ${stateClass}`;
                stateBadge.textContent = distro.State;
                
                row.appendChild(left);
                row.appendChild(stateBadge);
                wslDistroList.appendChild(row);
            });
        } else {
            const empty = document.createElement('div');
            empty.className = 'wsl-empty';
            empty.textContent = 'No WSL distros registered (but vmmem process is running, likely starting up or shutting down).';
            wslDistroList.appendChild(empty);
        }
        // Render config status — support parsed Config object or legacy ConfigExists
        wslConfigStatus.innerHTML = '';
        const cfg = wslData && (wslData.Config || null);
        if (cfg && cfg.exists) {
            if (cfg.valid === true && cfg.memory) {
                wslConfigStatus.className = 'wsl-config-status exists';
                wslConfigStatus.textContent = `.wslconfig sets memory=${cfg.memory} (${cfg.rawMemory}) at ${cfg.source} — cap is configured.`;
            } else if (cfg.valid === false) {
                wslConfigStatus.className = 'wsl-config-status missing';
                wslConfigStatus.textContent = `.wslconfig found at ${cfg.source} but memory value "${cfg.rawMemory}" is invalid. Will not cap memory.`;
            } else {
                wslConfigStatus.className = 'wsl-config-status exists';
                wslConfigStatus.textContent = `.wslconfig found at ${cfg.source} but no memory= under [wsl2]. Does not cap memory.`;
            }
        } else if (wslData && wslData.ConfigExists) {
            wslConfigStatus.className = 'wsl-config-status exists';
            wslConfigStatus.innerHTML = '<strong>.wslconfig found</strong> in your profile folder. Check that it contains a valid <code>memory=</code> value under <code>[wsl2]</code>; an empty or unrelated file does not cap memory.';
        } else {
            wslConfigStatus.className = 'wsl-config-status missing';
            wslConfigStatus.innerHTML = '<strong>No .wslconfig found</strong> in <code>%UserProfile%\\.wslconfig</code>. WSL2 will size dynamically; see WSL Settings or create the file to set <code>memory=</code> if needed.';
        }
    }

    // Attach listeners
    refreshBtn.addEventListener('click', grabSnapshot);
    
    // WSL Shutdown — capability token, origin-checked, confirmation listing distros
    const wslShutdownBtn = document.getElementById('wsl-shutdown-btn');
    wslShutdownBtn.addEventListener('click', async () => {
        const token = await ensureToken();
        if (!token) { alert('Missing capability token — reload the page.'); return; }
        // Build confirmation listing running distros
        const docs = (currentData && currentData.WSL && currentData.WSL.Distros) ? currentData.WSL.Distros.filter(d => String(d.State).toLowerCase()==='running').map(d=>d.Name).join(', ') : '';
        const distroList = docs || 'no running distros detected (VM may still hold memory)';
        const msg = `Shut down WSL now?\n\nRunning: ${distroList}\n\nThis will immediately stop all WSL distributions, Docker workloads, and any unsaved work inside WSL. Memory will be reclaimed after shutdown.\n\nProceed?`;
        if (!confirm(msg)) return;
        wslShutdownBtn.disabled = true;
        const origText = wslShutdownBtn.querySelector('span').textContent;
        wslShutdownBtn.querySelector('span').textContent = 'Releasing WSL Memory...';
        
        try {
            const res = await fetch('/api/wsl/shutdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-SysView-Token': token },
                body: JSON.stringify({ confirm: true })
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`WSL shutdown failed (${res.status}): ${txt.slice(0,400)}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            
        } catch (err) {
            console.error('Error shutting down WSL:', err);
            alert(`Failed to shutdown WSL: ${err.message}\nTry running "wsl --shutdown" in an elevated PowerShell terminal.`);
        } finally {
            wslShutdownBtn.querySelector('span').textContent = origText;
            wslShutdownBtn.disabled = false;
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
