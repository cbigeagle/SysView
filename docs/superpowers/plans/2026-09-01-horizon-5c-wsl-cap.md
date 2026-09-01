# Horizon 5c — Cap WSL Wizard (Preview + Write, No Auto-Shutdown) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps checkbox.

**Goal:** Second safe fixer — **Cap WSL** — preview + write `%UserProfile%\.wslconfig` `[wsl2] memory=4GB` with validation, no auto-`wsl --shutdown` (user triggers shutdown separately via existing button). Proves fixer pattern without risking OMP work.

**Architecture:** New `POST /api/wsl/config` handler in Go (token+origin+confirm, 5s timeout, writes file atomically via temp+rename, preserves other keys/sections, validates `memory` regex `^\d+(\.\d+)?\s*(GB|MB|G|M)$`), frontend wizard in WSL panel with input, preview `<pre>`, Write button, result banner, re-reads config status.

**Tech Stack:** Go (`net/http`, `os`, `path/filepath`), PowerShell not needed (Go writes file), Vanilla JS, CSS tokens.

## Global Constraints

- Single binary, vet/check green, schemaVersion 3 unchanged (no new envelope keys, config is file-write not snapshot), textContent, loopback+token+confirm, budgets flat (no new snapshot providers, JSON 3.37KB, 26 allocs, 1.82MB).
- Safe: never calls `wsl --shutdown` (existing button remains separate, user-controlled). Write only touches `%UserProfile%\.wslconfig`, preserves comments/other keys via parse-then-serialize, atomic via temp file + rename.
- Validates `memory` strictly; on invalid → 400 with `{error:"Invalid memory value", details:"Expected e.g. 4GB, 4096MB"}`.

## File Structure

```
main.go        # + wslConfigSem chan(1), handleWslConfig(), POST /api/wsl/config
static/
  app.js       # + cap wizard: input #wsl-memory-input, preview #wsl-config-preview, write handler, result #wsl-config-result
  index.html   # + wizard UI inside wsl-advice-card (input+preview+Write button+result)
  style.css    # + .wsl-config-preview, .wsl-cap-result success/warning reusing tokens
main_test.go   # + TestHandleWslConfig_* (token/origin/confirm/invalidMemory/rateLimit/method)
```

## Shared Contract

```
POST /api/wsl/config
Headers: X-SysView-Token, Content-Type application/json
Body: {"memory":"4GB","confirm":true}
Responses:
  200 {status:"success", path:"C:\\Users\\...\\.wslconfig", memory:"4GB", message:"Wrote memory=4GB to .wslconfig"}
  400 {error:"Invalid memory value", details:"Expected e.g. 4GB"} // or 400 Confirmation required
  400 {error:"Confirmation required"} // missing/false confirm
  403 {error:"Missing or invalid capability token"} / 403 Forbidden origin
  405 {error:"Method not allowed. Use POST."}
  429 {error:"WSL config write already in progress"}
  500 {error:"Failed to write .wslconfig", details: os error}
GET 405
```

Frontend confirm: `Write memory=4GB to %UserProfile%\.wslconfig?\n\nPreview:\n[wsl2]\nmemory=4GB\n\nExisting settings in other sections will be preserved. This does not shut down WSL — use "Shut Down WSL" separately if you want the cap to take effect immediately.\n\nProceed?`

Wizard shows current config status (already rendered), input with placeholder "4GB", preview updates on input, Write button disabled until valid.

## Tasks

### Task H5cT1: Backend Cap Config Handler

**Files:** Modify: main.go — add wslConfigSem, handleWslConfig, mux registration
- [ ] Add `wslConfigSem = make(chan struct{},1)` alongside reclaimSem
- [ ] Implement handleWslConfig per contract: POST only, isSameOrigin, requireToken, LimitReader 1MB, confirm true else 400, validate memory regex, sem try else 429, get wslConfigPath via `os.UserHomeDir()` + ".wslconfig", read existing file if exists, parse to preserve other sections/keys, update `[wsl2] memory=`, write via temp file + `os.Rename` atomic, return 200 with path+memory
- [ ] Register `mux.HandleFunc("/api/wsl/config", handleWslConfig)`
- [ ] vet green, commit

### Task H5cT2: Frontend Wizard

**Files:** Modify: static/index.html (wizard UI), static/app.js (wizard logic), static/style.css (preview/result)
- [ ] Add inside wsl-advice-card: `<input id="wsl-memory-input" placeholder="4GB" pattern="...">` + `<pre id="wsl-config-preview" class="code-preview" aria-live="polite">` + `<button id="wsl-cap-write-btn" class="btn-secondary">Write .wslconfig</button>` + `<div id="wsl-config-result" class="wsl-config-result" aria-live="polite">`
- [ ] In app.js, wire: ensureToken, input `input` event updates preview textContent `[wsl2]\nmemory=${val||"4GB"}`, validate regex, toggle Write disabled, click: confirm with preview, fetch POST with token+confirm, handle 200 success (green) with path+memory + call grabSnapshot to refresh config status, 400 invalid (red), 403/429 (warning), re-enable
- [ ] Style preview + result reusing code-preview + insight tokens, commit

### Task H5cT3: Tests + Bench + Docs Gate

**Files:** Modify: main_test.go (5 tests), bench/perf_budget.md (H5c flat), README.md (One-click Fixers: Cap WSL docs)
- [ ] Add main_test.go: TestHandleWslConfig_* 5 tests (token/origin/confirm/invalidMemory/method)
- [ ] Update bench/perf_budget.md H5c flat note (no new snapshot providers, JSON still 3.37KB, allocs 26 flat, HistoryStore 1.82MB)
- [ ] Update README.md ## One-click Fixers add Cap WSL subsection (preview+write, no auto-shutdown, separate shutdown button, validation)
- [ ] Run go test 18→23 PASS, vet 0, node --check 0, 4 JS tests PASS, html 15/15 68/68, bench 26 flat, commit
