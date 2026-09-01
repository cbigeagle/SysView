# Horizon 4 — Headless + Perf Recovery Plan

> Goal: Make SysView fleet-usable — headless JSON for RMM/intune + claw back validation allocs (148→<50) without breaking HistoryStore/export.

## Global Constraints
- Single binary, 12s/cap2, [IP_ADDRESS]+token on served mode only, textContent, schemaVersion stays 3, redaction, vet/check green.
- Budgets: JSON <1.5MB, HistoryStore <5MB, p50 <900ms, allocs target <50 (recover from 148).
- No breaking envelope shape.

## Shared Contract
- New CLI: `SysView.exe --headless [--once] [--output <file>] [--pretty]` — runs snapshot collector (shared snapshot.ps1), writes envelope JSON to stdout or file, exits 0 on success, non-zero + stderr JSON on provider failure, no HTTP server, no browser open.
- Perf: `validateEnvelope` refactor — avoid `map[string]json.RawMessage` allocation per call; use struct + `json.RawMessage` fields pooled or `encoding/json` decoder with `UseNumber` + prealloc.

## Tasks
- H4T1 Perf: validateEnvelope zero-alloc refactor + bench must show 148→<80 (stretch <50), keep error messages identical.
- H4T2 Headless: flag parsing (--headless, --once, --output, --pretty), execution path bypasses http.Server/openBrowser, reuses snapshot collection timeout 12s, writes to file/stdout, honors redaction flag --redact (default true).
- H4T3 Bench + Tests: extend main_test.go with headless flag tests (help, --once writes file, exit codes), bench v4 numbers, update perf_budget Current (H4), html still valid.

## File Structure
```
main.go              # + flag --headless, --output, --pretty, --redact flag + headless runner
main_test.go         # + headless tests
snapshot_bench_test.go # bench refactor
bench/perf_budget.md # H4 column
README.md            # headless docs
```
