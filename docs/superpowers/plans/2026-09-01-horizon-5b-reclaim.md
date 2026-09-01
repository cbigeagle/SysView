# Horizon 5b — Safe Fixer: Reclaim Standby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Ship the first *safe* one-click fixer — **Reclaim Standby (Empty Standby List)** — with `Before → After` diff, privilege handling, and audit trail. Proves SysView can *fix*, not just *view*, without risking data loss.

**Architecture:** New `POST /api/reclaim/standby` handler in Go (token+origin+confirm+1-cap, 12s timeout, Windows P/Invoke via PowerShell `NtSetSystemInformation` with `MemoryPurgeStandbyList=4` or fallback `SetSystemFileCacheSize`/`EmptyWorkingSet` no-op) + frontend button + confirm modal + result banner + auto-refresh. No new PS providers in snapshot.ps1 (standby already collected). No schema bump.

**Tech Stack:** Go 1.21+ (`net/http`, `context`, `os/exec` PowerShell), PowerShell 5.1+ P/Invoke `ntdll.dll`, Vanilla JS, CSS tokens.

## Global Constraints

- Single binary, 12s timeout (both snapshot and reclaim), loopback-only, token+origin+confirm on POST, textContent for telemetry, schemaVersion 3 unchanged (no new envelope keys), redaction unchanged, vet/check green.
- Reclaim requires Administrator on most builds → handler must return 403 with JSON `{error:"Requires Administrator", details:"Run SysView.exe as Administrator to reclaim standby"}` when P/Invoke fails with `STATUS_PRIVILEGE_NOT_HELD` or `Access denied` — frontend shows guidance, not crash.
- Budgets: JSON 3.37KB fixture unchanged, HistoryStore 1.82MB unchanged, allocs 26 flat (no new envelope fields), p50 <900ms (reclaim adds one extra PowerShell spawn, but not on snapshot hot path).
- No destructive data loss: standby is cache, reclaim is safe; confirm still required with `Before: X GB standby`.

## File Structure

```
main.go        # + reclaimSem chan(1), handleReclaimStandby(), PowerShell P/Invoke snippet
static/
  app.js       # + reclaim button handler, confirm modal via confirm() listing Before GB, fetch /api/reclaim/standby, result banner
  index.html   # + #reclaim-standby-btn in standby card + #reclaim-result aria-live
  style.css    # + .btn-secondary reclaim + .reclaim-result success/warning + .health badge reuse
main_test.go   # + TestHandleReclaimStandby_RequiresToken/Confirm/Origin/RateLimit + mock PS success/failure
```

## Shared Contract

```
POST /api/reclaim/standby
Headers: X-SysView-Token: <capabilityToken>, Content-Type: application/json
Body: {"confirm": true}
Responses:
  200 {status:"success", beforeBytes: int64, afterBytes: int64, reclaimedBytes: int64, message:"Standby reclaimed: X GB → Y GB (Z MB freed)"}
  400 {error:"Confirmation required"} // missing/false confirm
  403 {error:"Requires Administrator", details:"..."} // privilege failure
  403 {error:"Missing or invalid capability token"} // token
  429 {error:"Reclaim already in progress"} // sem cap 1
  500 {error:"Reclaim failed", details: stderr}
GET disallowed 405
```

Frontend confirm string: `Reclaim 6.8 GB standby cache?\n\nBefore: 6.8 GB standby\n\nThis releases file cache to Available memory. No apps or unsaved work are affected. Windows will repopulate cache as needed.\n\nProceed?`

## Tasks (must be sequential — same files)

### Task H5bT1: Backend Reclaim Handler + PowerShell P/Invoke

**Files:**
- Modify: main.go — add reclaimSem, handleReclaimStandby, register mux /api/reclaim/standby
- Optional: static/evidence_test.js not needed

**Interfaces:**
- Consumes: snapshot.ps1 standby collection (for Before/After via snapshot after), capabilityToken, isSameOrigin, requireToken
- Produces: POST /api/reclaim/standby per contract

- [ ] Step 1: Add `reclaimSem = make(chan struct{},1)` alongside snapshotSem/wslSem at top of main.go
- [ ] Step 2: Implement `handleReclaimStandby(w,r)`: Method POST only, isSameOrigin, requireToken, read body LimitReader 1MB, require confirm true else 400, sem try else 429, context.WithTimeout 12s, exec PowerShell snippet: Add-Type P/Invoke `NtSetSystemInformation` with `MemoryPurgeStandbyList=4` (SystemMemoryListInformation 80), call with SeProfileSingleProcessPrivilege enable try, on success capture Before from `Win32_PerfFormattedData_PerfOS_Memory StandbyCache* sum` before + after, compute reclaimed, return JSON 200. On privilege failure, return 403 Requires Administrator. On other fail, 500.
- [ ] Step 3: Register `mux.HandleFunc("/api/reclaim/standby", handleReclaimStandby)` alongside wsl/shutdown.
- [ ] Step 4: Ensure file parses `go vet ./...` green, bench flat.

### Task H5bT2: Frontend Reclaim Button + Confirm + Result Banner

**Files:**
- Modify: static/index.html — #reclaim-standby-btn in standby card + #reclaim-result
- Modify: static/app.js — reclaim handler
- Modify: static/style.css — reclaim styles

**Interfaces:**
- Consumes: POST /api/reclaim/standby contract, formatBytes, formatDelta, confidence helpers, currentData Memory StandbyBytes

- [ ] Step 1: Add button `<button id="reclaim-standby-btn" class="btn-secondary" title="Reclaim file cache">Reclaim Standby</button>` inside standby-card detail (below #size-standby) + `<div id="reclaim-result" class="reclaim-result" aria-live="polite">`
- [ ] Step 2: In app.js, wire `#reclaim-standby-btn` click: ensureToken, read current standby Before, confirm with string containing Before GB, disable button + show "Reclaiming...", fetch POST with token+confirm, handle 403 Requires Administrator → show warning banner with guidance, 200 → show success banner `Standby 6.8 → 5.1 GB (1.7 GB reclaimed)`, error → danger banner, then grabSnapshot() to refresh deltas, re-enable.
- [ ] Step 3: Style .reclaim-result.success/.warning/.danger reusing insight-item tokens, .btn-secondary reclaim.
- [ ] Step 4: Verify with `node --check` + manual DOM: button exists, confirm shows Before, result banner is aria-live, textContent for bytes.

### Task H5bT3: Tests + Bench + Docs Gate

**Files:**
- Modify: main_test.go — add reclaim tests
- Modify: bench/perf_budget.md — add H5b flat note (no new envelope fields, reclaim adds one-off PS spawn not on snapshot hot path, allocs still 26)
- Modify: README.md — add `## One-click Fixers` section documenting Reclaim Standby (safe, what it does, admin requirement, before/after)

**Interfaces:** N/A
- [ ] Step 1: Add main_test.go: TestHandleReclaimStandby_RequiresToken/Origin/Confirm/MethodNotAllowed/RateLimit (fill reclaimSem then 429).
- [ ] Step 2: Run `go test ./... -v` 13→18 PASS, `go vet 0`, `node --check 0`, 4 JS tests PASS, bench 26 flat, html 15/15 67/67.
- [ ] Step 3: Update bench/perf_budget.md H5b flat note (reclaim is one-off POST, not snapshot poll, so p50 unchanged).
- [ ] Step 4: Update README.md with one-click fixers docs.
- [ ] Step 5: Commit.

