// H1T3: HistoryStore — bounded ring buffer (cap 450 = 15min @ 2s) + AutoRefresh harness
class HistoryStore {
  constructor(cap = 450) { this.cap = cap; this.items = []; }
  push(envelope) { this.items.push({ at: Date.now(), envelope }); if (this.items.length > this.cap) this.items.shift(); }
  get length() { return this.items.length; }
  latest() { return this.items.length ? this.items[this.items.length - 1].envelope : null; }
  at(i) { return this.items[i] ? this.items[i].envelope : null; }
  toJSON() { return this.items.map(x => x.envelope); }
  deltas() {
    if (this.items.length < 2) return null;
    const a = this.items[this.items.length - 2].envelope.data || this.items[this.items.length - 2].envelope;
    const b = this.items[this.items.length - 1].envelope.data || this.items[this.items.length - 1].envelope;
    const aMem = a.Memory || {};
    const bMem = b.Memory || {};
    return {
      availableDelta: (bMem.AvailableBytes || 0) - (aMem.AvailableBytes || 0),
      inUseDelta: (bMem.InUseBytes || 0) - (aMem.InUseBytes || 0),
      poolDelta: (bMem.NonpagedPoolBytes || 0) - (aMem.NonpagedPoolBytes || 0)
    };
  }
}
// H5aT1: extended deltas + trend over last 10 for spark
HistoryStore.prototype.deltasExtended = function() {
  if (this.items.length < 2) return null;
  const a = this.items[this.items.length - 2].envelope.data || this.items[this.items.length - 2].envelope;
  const b = this.items[this.items.length - 1].envelope.data || this.items[this.items.length - 1].envelope;
  const aMem = a.Memory || {};
  const bMem = b.Memory || {};
  const res = {
    availableDelta: (bMem.AvailableBytes || 0) - (aMem.AvailableBytes || 0),
    inUseDelta: (bMem.InUseBytes || 0) - (aMem.InUseBytes || 0),
    poolDelta: (bMem.NonpagedPoolBytes || 0) - (aMem.NonpagedPoolBytes || 0),
    standbyDelta: (bMem.StandbyBytes || 0) - (aMem.StandbyBytes || 0),
    modifiedDelta: (bMem.ModifiedBytes || 0) - (aMem.ModifiedBytes || 0)
  };
  // trend over last 10 samples (or all if fewer)
  if (this.items.length >= 2) {
    const startIdx = Math.max(0, this.items.length - 10);
    const first = this.items[startIdx].envelope.data || this.items[startIdx].envelope;
    const last = this.items[this.items.length - 1].envelope.data || this.items[this.items.length - 1].envelope;
    const fMem = first.Memory || {};
    const lMem = last.Memory || {};
    res.availableTrend = (lMem.AvailableBytes || 0) - (fMem.AvailableBytes || 0);
    res.inUseTrend = (lMem.InUseBytes || 0) - (fMem.InUseBytes || 0);
    res.poolTrend = (lMem.NonpagedPoolBytes || 0) - (fMem.NonpagedPoolBytes || 0);
    res.standbyTrend = (lMem.StandbyBytes || 0) - (fMem.StandbyBytes || 0);
    res.modifiedTrend = (lMem.ModifiedBytes || 0) - (fMem.ModifiedBytes || 0);
  }
  return res;
};
const historyStore = new HistoryStore(450);
if (typeof window !== 'undefined') { window.__historyStore = historyStore; window.HistoryStore = HistoryStore; window.historyStore = historyStore; }

// H5aT1: pure helpers — formatDelta + confidenceForSampleCount
function formatDelta(bytes) {
  if (bytes === 0 || bytes == null || Number.isNaN(bytes)) return '\u00B10 GB';
  const abs = Math.abs(bytes);
  const sign = bytes > 0 ? '+' : '-';
  // Show GB with 2 decimals for >=0.5 GB (512 MB) else MB with 0 decimals — ensures 0.7 GB => 0.70 GB and 220 MB stays MB
  if (abs >= 512 * 1024 * 1024) return sign + (abs / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (abs >= 1024 * 1024) return sign + (abs / (1024 * 1024)).toFixed(0) + ' MB';
  if (abs >= 1024) return sign + (abs / 1024).toFixed(0) + ' KB';
  return sign + abs + ' B';
}
function confidenceForSampleCount(n) {
  const intervalMs = (typeof window !== 'undefined' && typeof window.autoInterval === 'number') ? window.autoInterval : 2000;
  const elapsedSec = n * intervalMs / 1000;
  if (n <= 2) return { label: 'Low', class: 'confidence-low', elapsedSec };
  if (n <= 10) return { label: 'Med', class: 'confidence-med', elapsedSec };
  return { label: 'High', class: 'confidence-high', elapsedSec };
}
if (typeof window !== 'undefined') { window.formatDelta = formatDelta; window.confidenceForSampleCount = confidenceForSampleCount; window.deltasExtended = function() { return historyStore.deltasExtended(); }; }
if (typeof module !== 'undefined' && module.exports) { module.exports.formatDelta = formatDelta; module.exports.confidenceForSampleCount = confidenceForSampleCount; }
// H5aT2: evidenceCard factory — div.insight-item with .evidence-meta (Observed -> May mean -> Next safe check + confidence + elapsed)
function evidenceCard(opts) {
  opts = opts || {};
  const type = (opts.type === 'danger' || opts.type === 'warning' || opts.type === 'success' || opts.type === 'info') ? opts.type : 'info';
  const div = document.createElement('div');
  div.className = 'insight-item ' + type;
  const icon = document.createElement('div');
  icon.className = 'insight-icon';
  icon.setAttribute('aria-hidden', 'true');
  let svg = '';
  if (type === 'danger' || type === 'warning') svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  else if (type === 'success') svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  else svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  icon.innerHTML = svg;
  const content = document.createElement('div');
  content.className = 'insight-content';
  const h4 = document.createElement('h4');
  h4.textContent = opts.title || '';
  content.appendChild(h4);
  const meta = document.createElement('div');
  meta.className = 'evidence-meta';
  if (opts.observed != null && String(opts.observed).length) {
    const row = document.createElement('div');
    row.className = 'evidence-observed';
    row.textContent = 'Observed: ' + String(opts.observed);
    meta.appendChild(row);
  }
  if (opts.mayMean != null && String(opts.mayMean).length) {
    const row = document.createElement('div');
    row.className = 'evidence-maymean';
    row.textContent = 'May mean: ' + String(opts.mayMean);
    meta.appendChild(row);
  }
  if (opts.nextCheck != null && String(opts.nextCheck).length) {
    const row = document.createElement('div');
    row.className = 'evidence-next';
    const t = document.createElement('span');
    t.textContent = 'Next safe check: ' + String(opts.nextCheck) + ' ';
    row.appendChild(t);
    if (opts.confidenceLabel) {
      const badge = document.createElement('span');
      const lbl = String(opts.confidenceLabel);
      badge.className = lbl === 'Low' ? 'confidence-low' : lbl === 'High' ? 'confidence-high' : 'confidence-med';
      badge.textContent = lbl;
      row.appendChild(badge);
    }
    if (opts.elapsedSec != null) {
      const el = document.createElement('span');
      el.className = 'evidence-elapsed';
      const sec = Number(opts.elapsedSec);
      const txt = sec >= 60 ? ' \u00B7 ' + Math.round(sec / 60) + ' min elapsed' : ' \u00B7 ' + sec + 's elapsed';
      el.textContent = txt;
      row.appendChild(el);
    }
    meta.appendChild(row);
  } else if (opts.confidenceLabel) {
    const row = document.createElement('div');
    row.className = 'evidence-confidence';
    const badge = document.createElement('span');
    const lbl = String(opts.confidenceLabel);
    badge.className = lbl === 'Low' ? 'confidence-low' : lbl === 'High' ? 'confidence-high' : 'confidence-med';
    badge.textContent = lbl;
    row.appendChild(badge);
    if (opts.elapsedSec != null) {
      const el = document.createElement('span');
      const sec = Number(opts.elapsedSec);
      const txt = sec >= 60 ? ' ' + Math.round(sec / 60) + ' min' : ' ' + sec + 's';
      el.textContent = txt;
      row.appendChild(el);
    }
    meta.appendChild(row);
  }
  content.appendChild(meta);
  div.appendChild(icon);
  div.appendChild(content);
  return div;
}
if (typeof window !== 'undefined') { window.evidenceCard = evidenceCard; }
if (typeof module !== 'undefined' && module.exports) { module.exports.evidenceCard = evidenceCard; }

function buildExportPayload(envelope, {redact=true}={}){
  const clone = JSON.parse(JSON.stringify(envelope));
  clone.exportedAt = new Date().toISOString();
  clone.exportNote = redact ? "CommandLine redacted by default; toggle to include" : "CommandLine included — may contain secrets";
  if(redact && clone.data && clone.data.WebViewProcesses){
    clone.data.WebViewProcesses.forEach(p=>{ if(p.CommandLine) p.CommandLine="[redacted]"; });
  }
  if(redact && clone.data && clone.data.AllProcesses){
    clone.data.AllProcesses.forEach(p=>{ if(p.CommandLine) p.CommandLine="[redacted]"; });
  }
  if(redact && clone.data && clone.data.Startup){ clone.data.Startup.forEach(s=>{ if(s.Command) s.Command="[redacted]"; }); }
  return clone;
}
if (typeof window !== 'undefined') window.buildExportPayload = buildExportPayload;
if (typeof module !== 'undefined' && module.exports) { module.exports.buildExportPayload = buildExportPayload; module.exports.HistoryStore = HistoryStore; }

// H1T4: pure comparator — stable sort mimic, string for name, numeric for others
function sortProcesses(list, key, dir){
  const get={name:p=>p.Name.toLowerCase(), pid:p=>p.PID, private:p=>p.PrivateMemory, ws:p=>p.WorkingSet, cpu:p=>p.CPU, ioRead:p=>p.IOReadBytes||0, ioWrite:p=>p.IOWriteBytes||0, net:p=>p.TcpConnectionCount||0, startupName:p=>(p.Name||'').toLowerCase(), startupLocation:p=>(p.Location||'').toLowerCase()}[key];
  if(!get) return [...list];
  return [...list].sort((a,b)=>{
    const av=get(a), bv=get(b);
    if(typeof av==='string' && typeof bv==='string'){
      const cmp=av.localeCompare(bv);
      return dir==='asc' ? cmp : -cmp;
    }
    return dir==='asc' ? av - bv : bv - av;
  });
}
if(typeof window!=='undefined'){ window.sortProcesses=sortProcesses; }
if(typeof module!=='undefined' && module.exports){ module.exports.sortProcesses=sortProcesses; }

// H1T2 test hook: pure helper for memory unavailable detection (providers.memory === 'unavailable' or zero bytes)
function isMemUnavailable(providers, mem) {
	return (providers && providers.memory === 'unavailable') || !mem || (mem.VisiblePhysicalBytes === 0 && mem.TotalPhysicalBytes === 0);
}
if (typeof window !== 'undefined') { window.isMemUnavailable = isMemUnavailable; window.__memUnavailable = isMemUnavailable; }
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
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
    const runtimeGroupsContainer = document.getElementById('runtime-groups');
    const runtimeSearchInput = document.getElementById('runtime-search');
    const sensorChips = document.getElementById('sensor-chips');
    const dockerStrip = document.getElementById('docker-strip');
    const memoryHogsTable = document.getElementById('memory-hogs-table');
    const diagnosticInsightsContainer = document.getElementById('diagnostic-insights');
    if (diagnosticInsightsContainer && !diagnosticInsightsContainer.hasAttribute('aria-live')) diagnosticInsightsContainer.setAttribute('aria-live', 'polite');
    const historyBadge = document.getElementById('history-badge');
    const historyIntervalSelect = document.getElementById('history-interval');
    const historyPauseBtn = document.getElementById('history-pause');
    // H1T4: Tabs — role=tablist wiring + persistence
    const tabBtns = [...document.querySelectorAll('[role="tab"]')];
    const tabPanels = [...document.querySelectorAll('[data-panel]')];
    let _activeTab = null;
    function activateTab(name){
      const valid = ['overview','processes','webview','runtimes','wsl','storage','startup'];
      if(!valid.includes(name)) name='overview';
      _activeTab = name;
      tabBtns.forEach(b=>{ const on=b.dataset.tab===name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      tabPanels.forEach(p=>{ p.hidden = p.dataset.panel !== name; });
      window.__activeTab = name;
      try{ localStorage.setItem('sysview-tab', name); }catch{}
      try{ history.replaceState(null,'','#'+name); }catch{}
    }
    if(typeof window!=='undefined'){ window.activateTab = activateTab; }
    tabBtns.forEach(b=> b.addEventListener('click', ()=> activateTab(b.dataset.tab)));
    // keyboard on tablist: ArrowLeft/Right cycles, Home/End
    const tabBar = document.querySelector('.tab-bar');
    if(tabBar){
      tabBar.addEventListener('keydown', (e)=>{
        const idx = tabBtns.indexOf(document.activeElement);
        if(e.key==='ArrowRight'){ e.preventDefault(); const n=(idx+1)%tabBtns.length; tabBtns[n].focus(); activateTab(tabBtns[n].dataset.tab); }
        else if(e.key==='ArrowLeft'){ e.preventDefault(); const n=(idx-1+tabBtns.length)%tabBtns.length; tabBtns[n].focus(); activateTab(tabBtns[n].dataset.tab); }
        else if(e.key==='Home'){ e.preventDefault(); tabBtns[0].focus(); activateTab(tabBtns[0].dataset.tab); }
        else if(e.key==='End'){ e.preventDefault(); tabBtns[tabBtns.length-1].focus(); activateTab(tabBtns[tabBtns.length-1].dataset.tab); }
      });
    }
    // restore tab from hash or localStorage
    (function initTab(){
      let saved=null; try{ saved = localStorage.getItem('sysview-tab'); }catch{}
      const hash = (location.hash||'').replace('#','').toLowerCase();
      const valid=['overview','processes','webview','runtimes','wsl','storage','startup'];
      let initial='overview';
      if(valid.includes(hash)) initial=hash;
      else if(valid.includes(saved)) initial=saved;
      activateTab(initial);
      window.addEventListener('hashchange', ()=>{ const h=(location.hash||'').replace('#','').toLowerCase(); if(valid.includes(h)) activateTab(h); });
    })();
    // global keyboard: R refresh, / focus filter
    document.addEventListener('keydown', (e)=>{
      const tag=(e.target.tagName||'').toLowerCase();
      const isInput = tag==='input' || tag==='textarea' || tag==='select' || e.target.isContentEditable;
      if(!isInput && (e.key==='r' || e.key==='R')){ e.preventDefault(); grabSnapshot(); }
      if(!isInput && e.key==='/'){ e.preventDefault(); const inp=document.getElementById('wv-search'); if(inp){ inp.focus(); try{ activateTab('webview'); }catch{} } }
    });
    // H1T4: sortable hog table state
    let hogSortKey='private', hogSortDir='desc';
    let _lastAllProcesses=null;

    let currentData = null;
    // H1T3: AutoRefresh controller
    let autoTimer = null, autoInterval = 2000, autoPaused = false;
    if (typeof window !== 'undefined') window.autoInterval = autoInterval;
    function stopAuto(){ clearInterval(autoTimer); autoTimer=null; }
    function startAuto(){ stopAuto(); if(autoPaused) return; autoTimer=setInterval(grabSnapshot, autoInterval); }
    function updateHistoryBadge(){
        if(!historyBadge) return;
        const n = historyStore.length;
        if(n===0){ historyBadge.textContent='No samples yet'; return; }
        const lastAt = historyStore.items[historyStore.items.length-1].at;
        const secs = Math.round((Date.now()-lastAt)/1000);
        const age = secs<5 ? 'just now' : secs<60 ? secs+'s ago' : Math.round(secs/60)+'m ago';
        historyBadge.textContent = 'Updated ' + age + ' \u00B7 ' + n + ' sample' + (n===1?'':'s');
    }
    function formatDelta(bytes){
        if(bytes===0||bytes==null) return '';
        const sign = bytes>0?'+':'';
        const abs = Math.abs(bytes);
        let v;
        if(abs>=1024*1024*1024) v=(abs/(1024*1024*1024)).toFixed(1)+' GB';
        else if(abs>=1024*1024) v=(abs/(1024*1024)).toFixed(0)+' MB';
        else if(abs>=1024) v=(abs/1024).toFixed(0)+' KB';
        else v=abs+' B';
        return ' ('+sign+v+' since last)';
    }
    function renderSparklines(){
        const points = historyStore.items.slice(-30).map(function(it){
            const env = it.envelope; const d = env.data || env; const m = d.Memory || {};
            return m.AvailableBytes || 0;
        });
        const cards = document.querySelectorAll('.detail-card');
        if(cards.length===0) return;
        let wraps = document.querySelectorAll('.sparkline-wrap');
        if(wraps.length===0){
            cards.forEach(function(card){
                const w=document.createElement('div'); w.className='sparkline-wrap'; w.setAttribute('aria-hidden','true');
                const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
                svg.setAttribute('width','120'); svg.setAttribute('height','28'); svg.setAttribute('viewBox','0 0 120 28'); svg.classList.add('sparkline');
                w.appendChild(svg);
                const deltaEl=document.createElement('span'); deltaEl.className='sparkline-delta'; w.appendChild(deltaEl);
                card.appendChild(w);
            });
            wraps=document.querySelectorAll('.sparkline-wrap');
        }
        if(points.length<2){
            wraps.forEach(function(w){ const s=w.querySelector('svg'); if(s) s.innerHTML=''; const d=w.querySelector('.sparkline-delta'); if(d) d.textContent=''; });
            return;
        }
        const min=Math.min.apply(null,points), max=Math.max.apply(null,points);
        const range=(max-min)||1;
        const step=120/(points.length-1);
        const path=points.map(function(v,i){
            const x=i*step; const y=28 - ((v-min)/range)*22 - 3;
            return (i===0?'M':'L')+x.toFixed(1)+','+y.toFixed(1);
        }).join(' ');
        wraps.forEach(function(w){
            const svg=w.querySelector('svg');
            if(!svg) return;
            svg.innerHTML='<path d="'+path+'" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
        });
        const d = historyStore.deltas();
        if(d && wraps[0]){
            const deltaEl=wraps[0].querySelector('.sparkline-delta');
            if(deltaEl) deltaEl.textContent = formatDelta(d.availableDelta);
        }
    }
    if(typeof window!=='undefined'){ window.updateHistoryBadge=updateHistoryBadge; window.renderSparklines=renderSparklines; window.startAuto=startAuto; window.stopAuto=stopAuto; }

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
        if (pulse) { pulse.classList.remove('error'); pulse.classList.add('loading'); }
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
            // H1T3: bounded history + badge + sparklines
            historyStore.push(envelope);
            updateHistoryBadge();
            renderSparklines();
            
        } catch (error) {
            console.error('Error fetching snapshot:', error);
            const pulseErr = document.querySelector('.pulse-indicator');
            if (pulseErr) { pulseErr.classList.remove('loading'); pulseErr.classList.add('error'); }
            // Keep previous data visible, but show error in badge
            // If we have no previous data, show full error card
            if (!currentData || !currentData.Memory) {
                lastUpdatedSpan.textContent = 'Error fetching snapshot';
                diagnosticInsightsContainer.innerHTML = '';
                const div = document.createElement('div');
                div.className = 'insight-item danger';
                div.innerHTML = `<div class="insight-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div><div class="insight-content"><h4>Failed to communicate with SysView service</h4><p>Verify that <code>SysView.exe</code> is running locally and hasn't been closed.</p><p class="wsl-note">Details: ${String(error.message || error).slice(0,300)}</p></div>`;
                diagnosticInsightsContainer.appendChild(div);
            } else {
                // Have previous data — show inline error, keep dashboard
                lastUpdatedSpan.textContent = `Last update: ${new Date().toLocaleTimeString()} — refresh failed (${String(error.message || error).slice(0,80)})`;
            }
        } finally {
            refreshBtn.disabled = false;
            if (refreshIcon) refreshIcon.classList.remove('spinning');
            const pulse2 = document.querySelector('.pulse-indicator');
            if (pulse2) pulse2.classList.remove('loading');
            // Do not clear error class here — it stays until next success
        }
    }

    function updateUI(data) {
        // Update Timestamp — clear error state
        const pulseOk = document.querySelector('.pulse-indicator');
        if (pulseOk) pulseOk.classList.remove('error');
        const now = new Date();
        lastUpdatedSpan.textContent = `Last update: ${now.toLocaleTimeString()}`;
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
        const memUnavailable = isMemUnavailable(providers, mem);
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
        // H5aT2: pool trend line below detail-size using formatDelta + confidence; also update #pool-trend span if exists
        (function(){
            const store = (typeof window !== 'undefined' && window.historyStore) ? window.historyStore : (typeof historyStore !== 'undefined' ? historyStore : null);
            const n = store ? store.length : 0;
            let poolTrendEl = document.getElementById('pool-trend');
            if (!poolTrendEl && nonpagedDetailCard) {
                poolTrendEl = document.createElement('div');
                poolTrendEl.id = 'pool-trend';
                poolTrendEl.setAttribute('aria-live', 'polite');
                poolTrendEl.style.fontSize = '0.74rem';
                poolTrendEl.style.fontVariantNumeric = 'tabular-nums';
                poolTrendEl.style.marginTop = '0.35rem';
                nonpagedDetailCard.appendChild(poolTrendEl);
            }
            if (!poolTrendEl) return;
            const fmtFn2 = (typeof window !== 'undefined' && window.formatDelta) ? window.formatDelta : (typeof formatDelta !== 'undefined' ? formatDelta : null);
            const confFn2 = (typeof window !== 'undefined' && window.confidenceForSampleCount) ? window.confidenceForSampleCount : (typeof confidenceForSampleCount !== 'undefined' ? confidenceForSampleCount : null);
            if (n < 2 || !store || !store.deltasExtended) {
                poolTrendEl.textContent = n === 0 ? '' : '(' + n + ' sample' + (n===1?'':'s') + ', collecting\u2026)';
                poolTrendEl.className = 'trend-flat';
                return;
            }
            const dd = store.deltasExtended();
            if (!dd) { poolTrendEl.textContent = ''; return; }
            const delta = dd.poolTrend != null ? dd.poolTrend : dd.poolDelta;
            const nTrend = Math.min(n, 10);
            const conf2 = confFn2 ? confFn2(nTrend) : { label: nTrend <= 2 ? 'Low' : nTrend <= 10 ? 'Med' : 'High', class: nTrend <= 2 ? 'confidence-low' : nTrend <= 10 ? 'confidence-med' : 'confidence-high', elapsedSec: nTrend * 2 };
            const deltaStr = fmtFn2 ? fmtFn2(delta) : (delta > 0 ? '+' + (delta/(1024*1024)).toFixed(0) + ' MB' : (delta/(1024*1024)).toFixed(0) + ' MB');
            const elapsed2 = conf2.elapsedSec;
            const timeStr = elapsed2 >= 60 ? Math.round(elapsed2/60) + ' min' : elapsed2 + 's';
            poolTrendEl.textContent = 'Trend ' + deltaStr + ' over ' + nTrend + ' samples (' + timeStr + ', ' + conf2.label + ')';
            let tc2 = 'trend-flat';
            if (delta > 0) tc2 = 'trend-up';
            else if (delta < 0) tc2 = 'trend-down';
            poolTrendEl.className = tc2;
        })();
        // H5aT1: pressure banner — deltasExtended + confidence
        (function(){
            const pd = document.getElementById('pressure-delta');
            const pc = document.getElementById('pressure-confidence');
            if(!pd || !pc) return;
            const store = (typeof window !== 'undefined' && window.historyStore) ? window.historyStore : (typeof historyStore !== 'undefined' ? historyStore : null);
            const n = store ? store.length : 0;
            const confFn = (typeof window !== 'undefined' && window.confidenceForSampleCount) ? window.confidenceForSampleCount : (typeof confidenceForSampleCount !== 'undefined' ? confidenceForSampleCount : null);
            const fmtFn = (typeof window !== 'undefined' && window.formatDelta) ? window.formatDelta : (typeof formatDelta !== 'undefined' ? formatDelta : null);
            if(n < 2 || !store || !store.deltasExtended){
                pd.textContent = n === 0 ? '' : '(' + n + ' sample' + (n===1?'':'s') + ', collecting\u2026)';
                pc.textContent = '';
                pc.className = '';
                return;
            }
            const d = store.deltasExtended();
            if(!d){ pd.textContent=''; pc.textContent=''; return; }
            const memData = data.Memory || {};
            const gb = function(v){ return (v/(1024*1024*1024)).toFixed(1); };
            const availNow = memData.AvailableBytes || 0;
            const availPrev = availNow - d.availableDelta;
            const deltaStr = fmtFn ? fmtFn(d.availableDelta) : (d.availableDelta>0? '+'+(d.availableDelta/(1024*1024*1024)).toFixed(2)+' GB' : (d.availableDelta/(1024*1024*1024)).toFixed(2)+' GB');
            const conf = confFn ? confFn(n) : {label: n<=2?'Low': n<=10?'Med':'High', class: n<=2?'confidence-low': n<=10?'confidence-med':'confidence-high', elapsedSec: n*2};
            pd.textContent = 'Available ' + gb(availPrev) + '\u2192' + gb(availNow) + ' GB (' + deltaStr + ', ' + n + ' samples, ' + conf.elapsedSec + 's, ' + conf.label + ')';
            let trendClass = 'trend-flat';
            if(d.availableDelta > 0) trendClass = 'trend-down';
            else if(d.availableDelta < 0) trendClass = 'trend-up';
            pd.className = trendClass;
            pc.textContent = conf.label;
            pc.className = conf.class;
        })();
        
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
        
        // 5b. RuntimeGroups unified (WebView2/Electron/Node/Python)
        (function(){
            let groups = data.RuntimeGroups;
            if(!groups || groups.length===0){
                if(data.WebViewProcesses && data.WebViewProcesses.length){
                    const tmp={};
                    data.WebViewProcesses.forEach(function(proc){
                        const host=findHostApp(proc, allProcessesMap);
                        const key='webview2::'+host.name.toLowerCase();
                        if(!tmp[key]) tmp[key]={ Runtime:'webview2', Host: host.name, Count:0, TotalWorkingSet:0, TotalCpu:0, Pids:[] };
                        tmp[key].Count+=1;
                        tmp[key].TotalWorkingSet+=proc.WorkingSet||0;
                        tmp[key].TotalCpu+=proc.CPU||0;
                        tmp[key].Pids.push(proc.PID);
                    });
                    groups=Object.values(tmp);
                } else { groups=[]; }
            }
            renderRuntimeGroups(groups);
        })();
        renderSensors(data.Sensors);
        renderDocker(data.Docker);
        
        // 6. Render top memory hogs (labels corrected below)
        renderMemoryHogs(data.AllProcesses);
        
        // 6.5 Render WSL virtualization section
        renderWSLSection(data.WSL, data.AllProcesses);

        // 6.6 Volumes
        renderVolumes(data.Volumes || []);

        // 6.7 Startup
        renderStartup(data.Startup || []);
        // 7. Run diagnostics recommendations engine
        // 7. Run diagnostics recommendations engine — H5aT2 passes volumes/startup/wsl for evidence cards
        runDiagnosticsEngine(mem, data.WebViewProcesses, allProcessesMap, data.Volumes || [], data.Startup || [], data.WSL || null);
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

    // H3T2: RuntimeGroups unified (Runtime+Host grouping, reuse findHostApp logic)
    let _runtimeGroupsData=[];
    function renderRuntimeGroups(groups){
        _runtimeGroupsData = Array.isArray(groups) ? groups.slice() : [];
        // sort by TotalWorkingSet desc for stable display
        _runtimeGroupsData.sort(function(a,b){ return (b.TotalWorkingSet||0)-(a.TotalWorkingSet||0); });
        displayFilteredRuntimeGroups();
        if(typeof window!=='undefined'){ window.renderRuntimeGroups=renderRuntimeGroups; window._runtimeGroupsData=_runtimeGroupsData; }
    }
    function displayFilteredRuntimeGroups(){
        const container = runtimeGroupsContainer;
        if(!container) return;
        const query = runtimeSearchInput ? runtimeSearchInput.value.toLowerCase().trim() : '';
        container.innerHTML='';
        const filtered = _runtimeGroupsData.filter(function(g){
            if(!query) return true;
            const rt=(g.Runtime||'').toLowerCase();
            const host=(g.Host||'').toLowerCase();
            if(rt.includes(query) || host.includes(query)) return true;
            if(Array.isArray(g.Pids) && g.Pids.some(function(pid){ return String(pid).includes(query); })) return true;
            return false;
        });
        if(filtered.length===0){
            const empty=document.createElement('div');
            empty.className='loading-state';
            const p=document.createElement('p');
            p.textContent = _runtimeGroupsData.length===0 ? 'No runtime groups found.' : 'No runtime groups match filter.';
            empty.appendChild(p);
            container.appendChild(empty);
            return;
        }
        filtered.forEach(function(group, index){
            const runtime=(group.Runtime||'unknown').toString();
            const host=(group.Host||'Unknown Host').toString();
            const initials=host.replace('.exe','').substring(0,2).toUpperCase() || 'RU';
            const card=document.createElement('div');
            card.className='runtime-group-card ' + (index===0 ? 'expanded' : '');
            const header=document.createElement('div');
            header.className='wv-group-header';
            header.tabIndex=0;
            header.setAttribute('role','button');
            header.setAttribute('aria-expanded', index===0 ? 'true' : 'false');
            const info=document.createElement('div');
            info.className='wv-group-info';
            info.style.display='flex';
            info.style.alignItems='center';
            info.style.gap='0.65rem';
            const icon=document.createElement('div');
            icon.className='wv-app-icon';
            icon.textContent=initials;
            const details=document.createElement('div');
            details.className='wv-app-details';
            const nameSpan=document.createElement('span');
            nameSpan.className='wv-app-name';
            nameSpan.textContent=host;
            const runtimeBadge=document.createElement('span');
            runtimeBadge.className='role-badge role-'+runtime.toLowerCase();
            runtimeBadge.textContent=runtime;
            details.appendChild(nameSpan);
            details.appendChild(runtimeBadge);
            info.appendChild(icon);
            info.appendChild(details);
            const stats=document.createElement('div');
            stats.className='wv-group-stats';
            const countDiv=document.createElement('div');
            countDiv.className='wv-stat';
            const countLabel=document.createElement('span');
            countLabel.className='label';
            countLabel.textContent='Count';
            const countVal=document.createElement('span');
            countVal.className='value';
            countVal.textContent=String(group.Count||0);
            countDiv.appendChild(countLabel);
            countDiv.appendChild(countVal);
            const memDiv=document.createElement('div');
            memDiv.className='wv-stat';
            const memLabel=document.createElement('span');
            memLabel.className='label';
            memLabel.textContent='Total RAM';
            const memVal=document.createElement('span');
            memVal.className='value mem';
            memVal.textContent=((group.TotalWorkingSet||0)/(1024*1024)).toFixed(0)+' MB';
            memDiv.appendChild(memLabel);
            memDiv.appendChild(memVal);
            const cpuDiv=document.createElement('div');
            cpuDiv.className='wv-stat';
            const cpuLabel=document.createElement('span');
            cpuLabel.className='label';
            cpuLabel.textContent='Total CPU';
            const cpuVal=document.createElement('span');
            cpuVal.className='value cpu';
            cpuVal.textContent=(group.TotalCpu||0) > 0 ? (group.TotalCpu).toFixed(1)+'%' : '0.0%';
            cpuDiv.appendChild(cpuLabel);
            cpuDiv.appendChild(cpuVal);
            stats.appendChild(countDiv);
            stats.appendChild(memDiv);
            stats.appendChild(cpuDiv);
            const arrow=document.createElement('div');
            arrow.className='wv-expand-arrow';
            arrow.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            header.appendChild(info);
            header.appendChild(stats);
            header.appendChild(arrow);
            const detailsWrap=document.createElement('div');
            detailsWrap.className='wv-group-details';
            const list=document.createElement('div');
            list.className='wv-process-list';
            const pids = Array.isArray(group.Pids) ? group.Pids : [];
            if(pids.length===0){
                const emptyRow=document.createElement('div');
                emptyRow.className='wsl-empty';
                emptyRow.textContent='No PIDs reported.';
                list.appendChild(emptyRow);
            } else {
                pids.forEach(function(pid){
                    const row=document.createElement('div');
                    row.className='wv-process-row';
                    const identity=document.createElement('div');
                    identity.className='wv-proc-identity';
                    const pidBadge=document.createElement('span');
                    pidBadge.className='pid-badge';
                    pidBadge.textContent='PID '+String(pid);
                    identity.appendChild(pidBadge);
                    const desc=document.createElement('div');
                    desc.className='wv-proc-desc';
                    desc.textContent=runtime+' host '+host;
                    row.appendChild(identity);
                    row.appendChild(desc);
                    list.appendChild(row);
                });
            }
            detailsWrap.appendChild(list);
            card.appendChild(header);
            card.appendChild(detailsWrap);
            const toggle=function(){
                const isExpanded=card.classList.toggle('expanded');
                header.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            };
            header.addEventListener('click', toggle);
            header.addEventListener('keydown', function(e){ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle(); }});
            container.appendChild(card);
        });
    }
    if(typeof window!=='undefined'){ window.renderRuntimeGroups=renderRuntimeGroups; window.displayFilteredRuntimeGroups=displayFilteredRuntimeGroups; }
    function renderSensors(sensors){
        if(!sensorChips) return;
        sensorChips.innerHTML='';
        const s = sensors || {};
        const cpuTemp = (s.CpuTempC != null) ? s.CpuTempC : null;
        const gpuTemp = (s.GpuTempC != null) ? s.GpuTempC : null;
        const fanRpm = (s.FanRpm != null) ? s.FanRpm : null;
        function tempBadge(temp){
            if(temp==null) return 'unavailable';
            if(temp>90) return 'danger';
            if(temp>80) return 'warn';
            return 'good';
        }
        function makeChip(label, valueText, badge){
            const chip=document.createElement('span');
            chip.className='sensor-chip sensor-'+badge;
            chip.textContent=label+': '+valueText;
            chip.title=label+' '+valueText;
            return chip;
        }
        if(cpuTemp==null){
            sensorChips.appendChild(makeChip('CPU Temp','-- unavailable','unavailable'));
        } else {
            const badge=tempBadge(cpuTemp);
            sensorChips.appendChild(makeChip('CPU Temp', String(cpuTemp)+' C', badge));
        }
        if(gpuTemp!=null){
            const badge=tempBadge(gpuTemp);
            sensorChips.appendChild(makeChip('GPU Temp', String(gpuTemp)+' C', badge));
        }
        if(fanRpm!=null){
            sensorChips.appendChild(makeChip('Fan', String(fanRpm)+' RPM', 'good'));
        }
        if(typeof window!=='undefined') window.renderSensors=renderSensors;
    }
    function renderDocker(docker){
        if(!dockerStrip) return;
        dockerStrip.innerHTML='';
        const containers = (docker && Array.isArray(docker.Containers)) ? docker.Containers : [];
        if(containers.length===0){
            dockerStrip.classList.add('hidden');
            dockerStrip.style.display='none';
            return;
        }
        dockerStrip.classList.remove('hidden');
        dockerStrip.style.display='';
        const countBadge=document.createElement('span');
        countBadge.className='docker-badge docker-count';
        countBadge.textContent=String(containers.length)+' containers';
        dockerStrip.appendChild(countBadge);
        containers.slice(0,3).forEach(function(c){
            const badge=document.createElement('span');
            badge.className='docker-badge';
            const img=(c.Image||'').toString();
            const state=(c.State||'').toString();
            badge.textContent=img + ' (' + state + ')';
            badge.title=(c.Names||'') ? (c.Names+' - '+img) : img;
            dockerStrip.appendChild(badge);
        });
        if(typeof window!=='undefined') window.renderDocker=renderDocker;
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
        _lastAllProcesses = allProcesses;
        // Exclude WebView2 processes and sort via current sort key/dir
        const nonWv = allProcesses.filter(p => p.Name.toLowerCase() !== 'msedgewebview2');
        const sorted = sortProcesses(nonWv, hogSortKey, hogSortDir);
        const topHogs = sorted.slice(0, 15);
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
            const ioReadMB = ((p.IOReadBytes||0)/(1024*1024)).toFixed(1);
            const ioWriteMB = ((p.IOWriteBytes||0)/(1024*1024)).toFixed(1);
            const connCount = p.TcpConnectionCount||0;
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
                <td class="text-right hog-mono hog-io"></td>
                <td class="text-right hog-mono hog-io"></td>
                <td class="text-right"><span class="conn-badge"></span></td>
            `;
            // Assign dynamic values via textContent to avoid HTML injection
            const nameSpan = trMain.querySelector('.hog-name');
            if (nameSpan) nameSpan.textContent = p.Name;
            const ioCells = trMain.querySelectorAll('.hog-io');
            if(ioCells[0]) ioCells[0].textContent = ioReadMB + ' MB';
            if(ioCells[1]) ioCells[1].textContent = ioWriteMB + ' MB';
            const connBadge = trMain.querySelector('.conn-badge');
            if(connBadge) connBadge.textContent = String(connCount);
            
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
                <td colspan="8">
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
    function runDiagnosticsEngine(mem, wvProcesses, allProcessesMap, volumes, startup, wslData) {
        diagnosticInsightsContainer.innerHTML = '';
        const visible = mem.VisiblePhysicalBytes || mem.TotalPhysicalBytes;
        const elapsed = (mem.CPUSampleSeconds || 0.3);
        const factory = (typeof window !== 'undefined' && window.evidenceCard) ? window.evidenceCard : (typeof evidenceCard !== 'undefined' ? evidenceCard : null);
        const fmtFn = (typeof window !== 'undefined' && window.formatDelta) ? window.formatDelta : (typeof formatDelta !== 'undefined' ? formatDelta : null);
        const confFn = (typeof window !== 'undefined' && window.confidenceForSampleCount) ? window.confidenceForSampleCount : (typeof confidenceForSampleCount !== 'undefined' ? confidenceForSampleCount : null);
        const store = (typeof window !== 'undefined' && window.historyStore) ? window.historyStore : (typeof historyStore !== 'undefined' ? historyStore : null);
        const n = store ? store.length : 0;
        const dExt = (store && store.deltasExtended) ? store.deltasExtended() : null;
        const confAll = confFn ? confFn(n || 1) : { label: (n||1) <= 2 ? 'Low' : (n||1) <= 10 ? 'Med' : 'High', class: (n||1) <= 2 ? 'confidence-low' : (n||1) <= 10 ? 'confidence-med' : 'confidence-high', elapsedSec: (n||1) * 2 };
        const nTrend = Math.min(n || 1, 10);
        const confTrend = confFn ? confFn(nTrend) : { label: nTrend <= 2 ? 'Low' : nTrend <= 10 ? 'Med' : 'High', class: nTrend <= 2 ? 'confidence-low' : nTrend <= 10 ? 'confidence-med' : 'confidence-high', elapsedSec: nTrend * 2 };
        function mkCard(o){ if(!factory){ const d=document.createElement('div'); d.textContent=o.title||''; return d; } return factory(o); }
        let added = 0;
        const GB = 1024*1024*1024;
        // 1. Memory pressure — also banner but also card via factory
        const usedPct = visible ? ((visible - mem.AvailableBytes) / visible * 100) : 0;
        if (usedPct > 88) {
            const inUseGB = (mem.InUseBytes / GB).toFixed(1);
            const availGB = (mem.AvailableBytes / GB).toFixed(1);
            const visGB = (visible / GB).toFixed(1);
            const deltaStr = dExt && fmtFn ? fmtFn(dExt.availableDelta) : '';
            const trendInfo = dExt && fmtFn ? ' Trend ' + fmtFn(dExt.availableTrend != null ? dExt.availableTrend : dExt.availableDelta) + ' over ' + nTrend + ' samples.' : '';
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'warning',
                title: 'Memory pressure elevated \u2014 ' + usedPct.toFixed(0) + '% of visible RAM in use',
                observed: inUseGB + ' GB in use, ' + availGB + ' GB available (visible ' + visGB + ' GB)' + (deltaStr ? ' (' + deltaStr + ')' : '') + trendInfo + ' at ' + new Date().toLocaleTimeString(),
                mayMean: 'system may page to disk; foreground apps can stall',
                nextCheck: 'Sort Processes by Private commit; close heavy workloads',
                confidenceLabel: confAll.label,
                elapsedSec: confAll.elapsedSec
            }));
            added++;
        }
        // 2. Non-paged pool with trend poolDelta over last 10 samples (+220MB over 12 min, High)
        const nonPagedPoolGB = mem.NonpagedPoolBytes / GB;
        const poolPct = visible ? (mem.NonpagedPoolBytes / visible * 100).toFixed(2) : '0';
        const poolDelta = dExt ? (dExt.poolTrend != null ? dExt.poolTrend : dExt.poolDelta) : null;
        const poolDeltaStr = (poolDelta != null && fmtFn) ? fmtFn(poolDelta) : '';
        const poolTrendLine = poolDeltaStr ? (poolDeltaStr + ' over ' + nTrend + ' samples, ' + confTrend.label) : '';
        if (nonPagedPoolGB > 1.2) {
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'warning',
                title: 'Elevated non-paged pool \u2014 investigate, not confirmed leak',
                observed: 'non-paged pool ' + nonPagedPoolGB.toFixed(2) + ' GB (' + poolPct + '% of visible)' + (poolTrendLine ? ' [' + poolTrendLine + ']' : '') + ' at ' + new Date().toLocaleTimeString(),
                mayMean: 'driver or kernel component may be holding memory; one sample cannot confirm a leak',
                nextCheck: 'run RAMMap / PoolMon to identify pool tags, compare after reboot',
                confidenceLabel: confTrend.label,
                elapsedSec: confTrend.elapsedSec
            }));
            added++;
        } else if (nonPagedPoolGB > 0.8) {
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'info',
                title: 'Non-paged pool within elevated range \u2014 monitor trend',
                observed: (nonPagedPoolGB * 1024).toFixed(0) + ' MB (' + poolPct + '% of visible)' + (poolTrendLine ? ' \u00B7 ' + poolTrendLine : ''),
                mayMean: 'pool size varies with RAM, workload, drivers; no leak established',
                nextCheck: 'capture samples over time and compare pool tags before changing drivers',
                confidenceLabel: confTrend.label,
                elapsedSec: confTrend.elapsedSec
            }));
            added++;
        } else if (poolDeltaStr) {
            // still show pool trend as info when not elevated but trend available
            // only if we haven't already shown pool card and have at least 2 samples
            if (n >= 2) {
                const isUp = poolDelta > 50*1024*1024;
                diagnosticInsightsContainer.appendChild(mkCard({
                    type: isUp ? 'info' : 'info',
                    title: 'Non-paged pool trend',
                    observed: nonPagedPoolGB.toFixed(2) + ' GB (' + poolPct + '%) \u00B7 ' + poolTrendLine,
                    mayMean: isUp ? 'pool growing; watch for driver growth' : 'pool stable',
                    nextCheck: 're-sample after workload change',
                    confidenceLabel: confTrend.label,
                    elapsedSec: confTrend.elapsedSec
                }));
                added++;
            }
        }
        // 3. Standby cache
        const standbyGB = mem.StandbyBytes / GB;
        if (standbyGB > 8.0) {
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'info',
                title: 'Large standby cache \u2014 expected behavior',
                observed: standbyGB.toFixed(1) + ' GB standby (file cache)',
                mayMean: 'Windows keeps recently used files in RAM for speed; it releases immediately when an app needs it',
                nextCheck: 'No action required; RAMMap > Empty Standby List for benchmark',
                confidenceLabel: confAll.label,
                elapsedSec: confAll.elapsedSec
            }));
            added++;
        }
        // 4. WebView2 heavy instances
        const wvProcessesSafe = Array.isArray(wvProcesses) ? wvProcesses : [];
        const wvMemMB = wvProcessesSafe.reduce((sum, p) => sum + (p.WorkingSet || 0), 0) / (1024 * 1024);
        if (wvMemMB > 3000) {
            const hostMems = {};
            wvProcessesSafe.forEach(p => { const host = findHostApp(p, allProcessesMap || {}); hostMems[host.name] = (hostMems[host.name] || 0) + (p.WorkingSet || 0); });
            const topWvHost = Object.entries(hostMems).sort((a,b) => b[1] - a[1])[0] || ['Unknown', 0];
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'info',
                title: 'High WebView2 summed working sets',
                observed: 'summed working sets ' + wvMemMB.toFixed(0) + ' MB across ' + wvProcessesSafe.length + ' processes; top host ' + topWvHost[0] + ' ~' + (topWvHost[1]/(1024*1024)).toFixed(0) + ' MB',
                mayMean: 'embedded pages share memory; total may double-count shared pages',
                nextCheck: 'restart ' + topWvHost[0] + ' to release pages; check hardware acceleration',
                confidenceLabel: confAll.label,
                elapsedSec: confAll.elapsedSec
            }));
            added++;
        }
        // 5. WebView2 CPU
        const highCpuWv = wvProcessesSafe.filter(p => (p.CPU || 0) > 5.0);
        if (highCpuWv.length > 0) {
            const worst = highCpuWv.sort((a,b) => (b.CPU||0)-(a.CPU||0))[0];
            const host = findHostApp(worst, allProcessesMap || {});
            const role = getProcessRole(worst.CommandLine);
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'warning',
                title: 'WebView2 CPU observed at ' + worst.CPU.toFixed(1) + '% (sample ' + elapsed.toFixed(2) + 's)',
                observed: 'PID ' + worst.PID + ' (' + role.role + ') in ' + host.name + ' at ' + worst.CPU.toFixed(1) + '% over ' + elapsed.toFixed(2) + 's window',
                mayMean: 'page or renderer may be busy; single sample is noisy',
                nextCheck: 'restart host and re-sample; check add-ins',
                confidenceLabel: 'Low',
                elapsedSec: Math.round(elapsed)
            }));
            added++;
        }
        // 6. WSL — show card when WSL active
        (function(){
            const wsl = wslData;
            const hasWslProc = (allProcessesMap && Object.values(allProcessesMap).some(function(p){ return p && p.Name && String(p.Name).toLowerCase()==='vmmemwsl'; })) || false;
            const hasRunningDistros = wsl && wsl.Distros && wsl.Distros.some(function(d){ return String(d.State).toLowerCase()==='running'; });
            if (hasWslProc || hasRunningDistros) {
                const distNames = (wsl && wsl.Distros) ? wsl.Distros.map(function(d){ return d.Name; }).join(', ') : '';
                diagnosticInsightsContainer.appendChild(mkCard({
                    type: 'info',
                    title: 'WSL2 active',
                    observed: (hasRunningDistros ? 'running distros: ' + distNames : 'vmmemWSL process active') + (hasWslProc ? ' (VM memory held)' : ''),
                    mayMean: 'WSL2 holds VM memory until wsl --shutdown',
                    nextCheck: 'use Release WSL Memory button if reclaim needed',
                    confidenceLabel: confAll.label,
                    elapsedSec: confAll.elapsedSec
                }));
                added++;
            }
        })();
        // 7. Volumes low-space (<10% free -> warning evidence card)
        (function(){
            const vols = Array.isArray(volumes) ? volumes : [];
            vols.forEach(function(v){
                const size = v.SizeBytes || 0;
                const free = v.FreeBytes || 0;
                if (size <= 0) return;
                const pctFree = (free / size) * 100;
                if (pctFree < 10) {
                    const freeGB = (free / GB).toFixed(2);
                    const sizeGB = (size / GB).toFixed(2);
                    diagnosticInsightsContainer.appendChild(mkCard({
                        type: 'warning',
                        title: 'Low free space on ' + (v.DeviceID || 'volume'),
                        observed: freeGB + ' GB free of ' + sizeGB + ' GB (' + pctFree.toFixed(1) + '% free) on ' + (v.DeviceID || 'volume') + (v.Label ? ' (' + v.Label + ')' : ''),
                        mayMean: 'disk pressure may slow updates, paging, and caching',
                        nextCheck: 'Storage Sense or free disk space',
                        confidenceLabel: 'High',
                        elapsedSec: confAll.elapsedSec
                    }));
                    added++;
                }
            });
        })();
        // 8. Startup triage (if Startup.length>20 -> info card)
        (function(){
            const list = Array.isArray(startup) ? startup : [];
            if (list.length > 20) {
                diagnosticInsightsContainer.appendChild(mkCard({
                    type: 'info',
                    title: 'Startup triage: ' + list.length + ' autostart entries',
                    observed: list.length + ' startup entries (registry, startup folder, services)',
                    mayMean: 'high autostart count may extend boot time and background load',
                    nextCheck: 'review Startup tab and disable unused entries',
                    confidenceLabel: 'High',
                    elapsedSec: confAll.elapsedSec
                }));
                added++;
            }
        })();
        // If no anomalies found
        if (added === 0) {
            diagnosticInsightsContainer.appendChild(mkCard({
                type: 'success',
                title: 'No thresholds exceeded in this sample',
                observed: 'sample within current thresholds',
                mayMean: 'system not showing pressure in this snapshot',
                nextCheck: 're-sample after workload change; history gives confidence',
                confidenceLabel: confAll.label,
                elapsedSec: confAll.elapsedSec
            }));
        }
        if (typeof window !== 'undefined') window.runDiagnosticsEngine = runDiagnosticsEngine;
    }
    if (typeof window !== 'undefined') window.runDiagnosticsEngine = runDiagnosticsEngine;

    // H2T3: Volumes panel
    function renderVolumes(volumes){
        const c = document.getElementById('volumes-container');
        if(!c) return;
        c.innerHTML='';
        if(!volumes || volumes.length===0){
            const empty=document.createElement('div');
            empty.className='wsl-empty';
            empty.textContent='No volumes reported.';
            c.appendChild(empty);
            return;
        }
        volumes.forEach(v=>{
            const size = v.SizeBytes||0;
            const free = v.FreeBytes||0;
            const used = size>0 ? Math.max(0, size-free) : 0;
            const pct = size>0 ? Math.min(100, Math.max(0, (used/size)*100)) : 0;
            const health = (v.HealthStatus||'OK').toString();
            const isWarn = health.toLowerCase()!== 'ok' && health.toLowerCase()!== 'healthy';
            const lowSpace = size>0 && (free/size) < 0.1;
            const card=document.createElement('div');
            card.className='volume-card';
            const head=document.createElement('div');
            head.className='volume-head';
            const label=document.createElement('span');
            label.className='volume-label';
            label.textContent=(v.DeviceID||'Volume') + (v.Label ? ' (' + v.Label + ')' : '');
            const badge=document.createElement('span');
            badge.className = isWarn ? 'health-badge health-warn' : 'health-badge health-ok';
            badge.textContent = health;
            head.appendChild(label);
            head.appendChild(badge);
            const barWrap=document.createElement('div');
            barWrap.className='volume-bar';
            const fill=document.createElement('div');
            fill.className='volume-fill' + (lowSpace ? ' low' : '');
            fill.style.width=pct.toFixed(1)+'%';
            fill.title=pct.toFixed(1)+'% used';
            barWrap.appendChild(fill);
            const meta=document.createElement('div');
            meta.className='volume-meta';
            const freeGB=(free/(1024*1024*1024)).toFixed(2);
            const usedGB=(used/(1024*1024*1024)).toFixed(2);
            const sizeGB=(size/(1024*1024*1024)).toFixed(2);
            const fs=document.createElement('span');
            fs.textContent=(v.FileSystem||'') + ' ' + (v.DriveType||'');
            const nums=document.createElement('span');
            nums.textContent=freeGB+' GB free / '+usedGB+' GB used of '+sizeGB+' GB ('+pct.toFixed(0)+'%)';
            meta.appendChild(fs);
            meta.appendChild(nums);
            card.appendChild(head);
            card.appendChild(barWrap);
            card.appendChild(meta);
            if(lowSpace){
                const warn=document.createElement('div');
                warn.className='insight-item warning';
                warn.style.marginTop='0.5rem';
                const ic=document.createElement('div');
                ic.className='insight-icon';
                ic.textContent='!';
                const cc=document.createElement('div');
                cc.className='insight-content';
                const h=document.createElement('h4');
                h.textContent='Low space';
                const pp=document.createElement('p');
                pp.textContent='Less than 10% free on ' + (v.DeviceID||'this volume') + '.';
                cc.appendChild(h);
                cc.appendChild(pp);
                warn.appendChild(ic);
                warn.appendChild(cc);
                card.appendChild(warn);
            }
            c.appendChild(card);
        });
    }
    if(typeof window!=="undefined") window.renderVolumes=renderVolumes;

    // H2T4: Startup panel
    let _startupData=[];
    let _startupSortKey='startupName';
    let _startupSortDir='asc';
    function renderStartup(list){
        _startupData = Array.isArray(list) ? list.slice() : [];
        _renderStartupFiltered();
    }
    function _renderStartupFiltered(){
        const tbody=document.getElementById('startup-table');
        const filterEl=document.getElementById('startup-filter');
        if(!tbody) return;
        const q = (filterEl && filterEl.value ? filterEl.value.toLowerCase().trim() : '');
        let filtered=_startupData.filter(e=>{
            if(!q) return true;
            return (e.Name||'').toLowerCase().includes(q) || (e.Command||'').toLowerCase().includes(q) || (e.Location||'').toLowerCase().includes(q) || (e.User||'').toLowerCase().includes(q);
        });
        filtered = sortProcesses(filtered, _startupSortKey, _startupSortDir);
        tbody.innerHTML='';
        if(filtered.length===0){
            const tr=document.createElement('tr');
            const td=document.createElement('td');
            td.colSpan=4;
            td.className='text-center';
            td.textContent = _startupData.length===0 ? 'No startup entries reported.' : 'No entries match filter.';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }
        filtered.forEach(e=>{
            const tr=document.createElement('tr');
            const tdName=document.createElement('td');
            tdName.textContent=e.Name||'';
            const tdLoc=document.createElement('td');
            const badge=document.createElement('span');
            const loc=(e.Location||'').toString();
            let locClass='startup-badge';
            const ll=loc.toLowerCase();
            if(ll.includes('registry')) locClass+=' startup-registry';
            else if(ll.includes('startup folder') || ll.includes('startup')) locClass+=' startup-folder';
            else if(ll.includes('service')) locClass+=' startup-service';
            badge.className=locClass;
            badge.textContent=loc||'Unknown';
            tdLoc.appendChild(badge);
            const tdCmd=document.createElement('td');
            tdCmd.className='hog-mono';
            tdCmd.style.maxWidth='360px';
            tdCmd.style.overflow='hidden';
            tdCmd.style.textOverflow='ellipsis';
            tdCmd.style.whiteSpace='nowrap';
            tdCmd.textContent=e.Command||'';
            tdCmd.title=e.Command||'';
            const tdUser=document.createElement('td');
            tdUser.textContent=e.User||'';
            tr.appendChild(tdName);
            tr.appendChild(tdLoc);
            tr.appendChild(tdCmd);
            tr.appendChild(tdUser);
            tbody.appendChild(tr);
        });
        document.querySelectorAll('th[data-sort^="startup"]').forEach(th=>{
            const k=th.dataset.sort;
            if(k===_startupSortKey) th.setAttribute('aria-sort', _startupSortDir==='asc' ? 'ascending' : 'descending');
            else th.setAttribute('aria-sort','none');
        });
    }
    if(typeof window!=="undefined"){ window.renderStartup=renderStartup; window._renderStartupFiltered=_renderStartupFiltered; }

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
    // H5bT2: Reclaim Standby — capability token, confirm with Before GB, result banner
    const reclaimBtn = document.getElementById('reclaim-standby-btn');
    const reclaimResult = document.getElementById('reclaim-result');
    if (reclaimBtn) {
        reclaimBtn.addEventListener('click', async () => {
            const token = await ensureToken();
            if (!token) { alert('Missing capability token — reload the page.'); return; }
            const beforeBytes = (currentData && currentData.Memory && currentData.Memory.StandbyBytes) ? currentData.Memory.StandbyBytes : 0;
            const beforeGB = formatGB(beforeBytes);
            const confirmMsg = `Reclaim ${beforeGB} standby cache?\n\nBefore: ${beforeGB} standby\n\nThis releases file cache to Available memory. No apps or unsaved work are affected. Windows will repopulate cache as needed.\n\nProceed?`;
            if (!confirm(confirmMsg)) return;
            const origText = reclaimBtn.textContent;
            reclaimBtn.disabled = true;
            reclaimBtn.textContent = 'Reclaiming...';
            if (reclaimResult) { reclaimResult.className = 'reclaim-result'; reclaimResult.textContent = 'Reclaiming standby cache...'; }
            try {
                const res = await fetch('/api/reclaim/standby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-SysView-Token': token },
                    body: JSON.stringify({ confirm: true })
                });
                const bodyText = await res.text();
                let data = null;
                try { data = JSON.parse(bodyText); } catch {}
                if (res.status === 403 && data && data.error === 'Requires Administrator') {
                    if (reclaimResult) {
                        reclaimResult.className = 'reclaim-result warning';
                        reclaimResult.textContent = (data.details || 'Requires Administrator') + ' — Run SysView.exe as Administrator to reclaim standby';
                    }
                } else if (res.ok && data) {
                    const before = data.beforeBytes != null ? data.beforeBytes : beforeBytes;
                    const after = data.afterBytes != null ? data.afterBytes : 0;
                    const reclaimed = data.reclaimedBytes != null ? data.reclaimedBytes : (before - after);
                    if (reclaimResult) {
                        reclaimResult.className = 'reclaim-result success';
                        reclaimResult.textContent = `Standby ${formatGB(before)} -> ${formatGB(after)} (${formatBytes(reclaimed)} reclaimed)`;
                    }
                } else if (!res.ok) {
                    const msg = (data && (data.details || data.error)) ? (data.details || data.error) : bodyText.slice(0, 400);
                    if (reclaimResult) {
                        reclaimResult.className = 'reclaim-result danger';
                        reclaimResult.textContent = `Reclaim failed (${res.status}): ${msg}`;
                    }
                } else {
                    if (reclaimResult) {
                        reclaimResult.className = 'reclaim-result danger';
                        reclaimResult.textContent = 'Reclaim failed: unexpected response';
                    }
                }
            } catch (err) {
                if (reclaimResult) {
                    reclaimResult.className = 'reclaim-result danger';
                    reclaimResult.textContent = `Reclaim failed: ${err.message}`;
                }
            } finally {
                reclaimBtn.textContent = origText;
                reclaimBtn.disabled = false;
                grabSnapshot();
            }
        });
    }
    // H5cT2: WSL cap wizard — preview, validation, write
    const wslMemoryInput = document.getElementById('wsl-memory-input');
    const wslConfigPreview = document.getElementById('wsl-config-preview');
    const wslCapWriteBtn = document.getElementById('wsl-cap-write-btn');
    const wslConfigResult = document.getElementById('wsl-config-result');
    if (wslMemoryInput && wslConfigPreview && wslCapWriteBtn && wslConfigResult) {
        const input = wslMemoryInput;
        const preview = wslConfigPreview;
        const btn = wslCapWriteBtn;
        const result = wslConfigResult;
        function isValidMemory(v) { return /^\s*\d+(?:\.\d+)?\s*(GB|MB|G|M)?\s*$/i.test(v); }
        input.addEventListener('input', () => {
            const v = input.value.trim() || '4GB';
            const norm = v.trim();
            preview.textContent = '[wsl2]\nmemory=' + norm;
            btn.disabled = !isValidMemory(v || '4GB');
        });
        preview.textContent = '[wsl2]\nmemory=4GB';
        btn.addEventListener('click', async () => {
            const token = await ensureToken();
            if (!token) { alert('Missing capability token — reload the page.'); return; }
            const val = input.value.trim() || '4GB';
            if (!isValidMemory(val)) {
                result.textContent = 'Invalid memory value \u2014 expected e.g. 4GB';
                result.className = 'wsl-config-result warning';
                return;
            }
            const confirmMsg = `Write memory=${val} to %UserProfile%\\.wslconfig?\n\nPreview:\n[wsl2]\nmemory=${val}\n\nExisting settings in other sections will be preserved. This does not shut down WSL \u2014 use "Shut Down WSL" separately if you want the cap to take effect immediately.\n\nProceed?`;
            if (!confirm(confirmMsg)) return;
            btn.disabled = true;
            btn.textContent = 'Writing...';
            result.textContent = 'Writing .wslconfig...';
            result.className = 'wsl-config-result';
            try {
                const res = await fetch('/api/wsl/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SysView-Token': token }, body: JSON.stringify({ memory: val, confirm: true }) });
                const bodyText = await res.text();
                let data;
                try { data = JSON.parse(bodyText); } catch { data = { error: bodyText }; }
                if (!res.ok) {
                    if (res.status === 400 && data.error && data.error.includes('Invalid')) {
                        result.textContent = data.error + ': ' + (data.details || '');
                        result.className = 'wsl-config-result warning';
                    } else if (res.status === 403) {
                        result.textContent = data.error || 'Forbidden';
                        result.className = 'wsl-config-result warning';
                    } else if (res.status === 429) {
                        result.textContent = 'WSL config write already in progress';
                        result.className = 'wsl-config-result warning';
                    } else {
                        result.textContent = 'Failed to write .wslconfig: ' + (data.details || data.error || bodyText).slice(0, 300);
                        result.className = 'wsl-config-result danger';
                    }
                } else {
                    result.textContent = data.message || `Wrote memory=${data.memory} to ${data.path}`;
                    result.className = 'wsl-config-result success';
                    grabSnapshot();
                }
            } catch (err) {
                result.textContent = 'Failed: ' + err.message;
                result.className = 'wsl-config-result danger';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Write .wslconfig';
            }
        });
    }
    let searchTimeout = null;
    if(wvSearchInput){
        wvSearchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                displayFilteredWebViewGroups();
            }, 150);
        });
    }
    let runtimeSearchTimeout=null;
    if(runtimeSearchInput){
        runtimeSearchInput.addEventListener('input', ()=>{
            clearTimeout(runtimeSearchTimeout);
            runtimeSearchTimeout=setTimeout(()=>{ displayFilteredRuntimeGroups(); }, 150);
        });
    }
    const startupFilter = document.getElementById('startup-filter');
    let startupSearchTimeout=null;
    if(startupFilter){
        startupFilter.addEventListener('input', ()=>{
            clearTimeout(startupSearchTimeout);
            startupSearchTimeout=setTimeout(()=>{ _renderStartupFiltered(); }, 150);
        });
    }
    // H1T4+H2: sortable headers — data-sort, aria-sort, re-render
    const hogTable = document.querySelector('table thead');
    function updateHogSortUI(){
      document.querySelectorAll('#tab-processes th[data-sort]').forEach(th=>{
        const k=th.dataset.sort;
        if(k===hogSortKey) th.setAttribute('aria-sort', hogSortDir==='asc' ? 'ascending' : 'descending');
        else th.setAttribute('aria-sort','none');
      });
    }
    document.querySelectorAll('th[data-sort]').forEach(th=>{
      const key=th.dataset.sort;
      const isStartup = key && key.startsWith('startup');
      const handler = ()=>{
        if(isStartup){
            if(_startupSortKey===key){ _startupSortDir = _startupSortDir==='asc' ? 'desc' : 'asc'; }
            else { _startupSortKey=key; _startupSortDir='asc'; }
            _renderStartupFiltered();
        } else {
            if(hogSortKey===key){ hogSortDir = hogSortDir==='asc' ? 'desc' : 'asc'; }
            else { hogSortKey=key; hogSortDir = (key==='name' ? 'asc' : 'desc'); }
            updateHogSortUI();
            if(_lastAllProcesses) renderMemoryHogs(_lastAllProcesses);
        }
      };
      th.addEventListener('click', handler);
      th.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); handler(); }});
    });
    updateHogSortUI();
    // init startup header aria-sort
    _renderStartupFiltered();
    if(historyIntervalSelect){
        historyIntervalSelect.addEventListener('change', () => {
            const v = parseInt(historyIntervalSelect.value,10);
            if([2000,5000,10000].includes(v)) { autoInterval=v; if (typeof window !== 'undefined') window.autoInterval = v; }
            if(!autoPaused) startAuto();
        });
    }
    if(historyPauseBtn){
        historyPauseBtn.addEventListener('click', () => {
            autoPaused = !autoPaused;
            if(autoPaused){ stopAuto(); historyPauseBtn.textContent='Resume'; }
            else { historyPauseBtn.textContent='Pause'; startAuto(); }
        });
    }
    // H1T5: Export snapshot JSON — redacted by default
    const exportBtn = document.getElementById('export-btn');
    const exportIncludeCb = document.getElementById('export-include-cmdline');
    const exportStatus = document.getElementById('export-status');
    if(exportBtn){
        exportBtn.addEventListener('click', ()=>{
            const env = window.__historyStore?.latest() || (currentData?._envelope ? {capturedAt: currentData._envelope.capturedAt, schemaVersion: currentData._envelope.schemaVersion||1, providers: currentData._envelope.providers||{}, errors: currentData._envelope.errors||[], data: currentData} : currentData);
            if(!env){ if(exportStatus) exportStatus.textContent="No snapshot yet"; return; }
            const redact = exportIncludeCb ? !exportIncludeCb.checked : true;
            const source = env.data ? env : {data: env, providers:{}, errors:[], capturedAt: new Date().toISOString(), schemaVersion:1};
            const payload = buildExportPayload(source, {redact});
            const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
            const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
            a.download=`SysView_snapshot_${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click();
            setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
            if(exportStatus) exportStatus.textContent=redact?"Exported (command lines redacted)":"Exported (command lines included)";
        });
    }

    // Initial load + auto-refresh
    grabSnapshot();
    startAuto();
    // respect prefers-reduced-motion: if user prefers reduced motion, pause auto-refresh by default but allow resume
    try{
        if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
            // do not auto-pause; just ensure no sparkline animation (CSS handles) — keep auto going
        }
    }catch{}
});
