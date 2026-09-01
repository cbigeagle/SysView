# Horizon 5d — Safe Fixer: Restart Runtime Host Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps checkbox.

**Goal:** Third safe fixer — **Restart Runtime host** (Teams/Code/Electron/Node): restart the *host* PID, not its children, with unsaved-work confirm and audit. Completes the fixer trio (Reclaim Standby + Cap WSL + Restart host) without risking OMP work (never auto-restarts, requires explicit confirm with host name + PID + RAM).

**Architecture:** New `POST /api/runtime/restart` handler in Go (token+origin+confirm+cap1, 10s timeout, PowerShell `Stop-Process -Id <pid> -ErrorAction Stop` with `Get-Process` existence + runtime validation, returns before/after host existence), frontend button per RuntimeGroups card with confirm modal, result banner, auto-refresh. No schema bump.

**Tech Stack:** Go (`net/http`, `context`, `os/exec` PowerShell), PowerShell `Get-Process`/`Stop-Process`, Vanilla JS, CSS tokens.

## Global Constraints

- Single binary, vet/check green, schemaVersion 3 unchanged (no new envelope keys), textContent, loopback+token+confirm, budgets flat (no new snapshot providers, JSON 3.37KB, 26 allocs, 1.82MB).
- Safe: never kills without confirm listing `Host (PID X, N children, Y GB)` + warning "Unsaved work in Teams will be lost. Host will need to be relaunched manually if it doesn't auto-restart."
- Validates `host` and `pid` are runtime host (must be in current RuntimeGroups or AllProcesses with runtime name match, pid exists via Get-Process, not a critical system PID 0/4)
- Cap 1 via runtimeRestartSem, 10-12s timeout, no mass-kill, no children kill.

## File Structure

```
main.go        # + runtimeRestartSem chan(1), handleRuntimeRestart(), POST /api/runtime/restart
static/
  app.js       # + restart button per RuntimeGroups card + handler + result
  index.html   # + #runtime-restart-result aria-live (or per-card result)
  style.css    # + .runtime-restart-btn + result banners reusing tokens
main_test.go   # + TestHandleRuntimeRestart_* (token/origin/confirm/method/rateLimit/invalidPid)
```

## Shared Contract

```
POST /api/runtime/restart
Headers: X-SysView-Token, Content-Type application/json
Body: {"host":"Teams","pid":12345,"confirm":true}
Responses:
  200 {status:"success", host:"Teams", pid:12345, message:"Sent restart signal to Teams (PID 12345)"}
  400 {error:"Confirmation required"} / {error:"Host and PID required"} / {error:"PID not found"} / {error:"Not a runtime host"}
  403 {error:"Missing or invalid capability token"} / 403 Forbidden origin
  405 Method not allowed. Use POST.
  429 {error:"Runtime restart already in progress"}
  500 {error:"Failed to restart host", details:...}
GET 405
```

Frontend confirm: `Restart Teams? (PID 12345, 12 children, 2.1 GB)\n\nThis will close Teams and its embedded pages. Unsaved work will be lost. Windows may relaunch the app automatically, or you may need to start it manually.\n\nProceed?`

Button: per RuntimeGroups card `Restart host` `.btn-secondary` + result `#runtime-restart-result` aria-live. On success, `grabSnapshot()` refreshes groups.

## Tasks

### Task H5dT1: Backend Restart Handler

**Files:** Modify: main.go — add runtimeRestartSem, handleRuntimeRestart, mux registration
- [ ] Add `runtimeRestartSem = make(chan struct{},1)` alongside wslConfigSem
- [ ] Implement handleRuntimeRestart per contract: POST only, isSameOrigin, requireToken, LimitReader 1MB, confirm true else 400, host+pid required else 400, pid >4 else 400, sem try else 429, context 10s, PowerShell: Get-Process -Id <pid> else PID not found 400, validate host name matches ProcessName or RuntimeGroups host (case-insensitive), then Stop-Process -Id <pid> -Force ; on success return 200, on failure 500 with stderr, never kills children directly
- [ ] Register `mux.HandleFunc("/api/runtime/restart", handleRuntimeRestart)`
- [ ] vet green, commit

### Task H5dT2: Frontend Restart Button

**Files:** Modify: static/index.html (result container if needed), static/app.js (button + handler), static/style.css (button/result)
- [ ] Add per RuntimeGroups card button `<button class="btn-secondary runtime-restart-btn">Restart host</button>` + data-host/data-pid attributes + `<div id="runtime-restart-result" class="runtime-restart-result" aria-live="polite">` (global or per-card)
- [ ] In app.js, wire button click: ensureToken, host/pid from card data, confirm with `Restart ${host}? (PID ${pid}, ${count} children, ${mem} GB)...Proceed?`, disable button, fetch POST with token+confirm, handle 200 success (green) with message + grabSnapshot, 400/403/429 warning, 500 danger, re-enable, textContent only
- [ ] Style preview + result reusing tokens, commit

### Task H5dT3: Tests + Bench + Docs Gate

**Files:** Modify: main_test.go (5 tests), bench/perf_budget.md (H5d flat), README.md (One-click Fixers: Restart host docs)
- [ ] Add main_test.go: TestHandleRuntimeRestart_* 5 tests (token/origin/confirm/method/rateLimit/invalidPid)
- [ ] Update bench/perf_budget.md H5d flat note (one-off POST, not snapshot hot path)
- [ ] Update README.md add ### Restart Runtime Host subsection (safe, host not children, unsaved work warning, manual relaunch note)
- [ ] Run go test 24→29 PASS, vet 0, node --check 0, 4 JS PASS, bench 26 flat, html 15/15 70/70, commit

