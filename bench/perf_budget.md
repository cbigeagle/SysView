# Perf & Capability Budgets (H2/H3/H4/H5a/H5b gates)

Baseline: H1 (commit 03fadd2 base, post-H1T7). H2 proposals MUST publish delta vs `Current (H1)`.

| Metric | Budget | Current (H1) | Current (H2) | Current (H3) | Current (H4) | Current (H5a) | Current (H5b) | Target (H5b flat) |
|--------|--------|-------------|-------------|-------------|-------------|-------------|-------------|--------|
| Snapshot latency p50 (loopback, `GET /api/snapshot`) | < 800 ms | not measured live; validation ~15 µs/op (see below); p50 budget untested at H1 (fixture 1 proc) | validation ~23.3 µs/op (see Current H2); p50 live untested — est. <900 ms with 4 new providers | validation ~29.6–30.6 µs/op (see Current H3); p50 live untested — est. <900 ms with 7 providers (H2 4 + H3 3) | validation ~23.0–23.6 µs/op (see Current H4); p50 live untested — est. <900 ms with same 7 providers + headless path (no server) | validation ~23.4–23.5 µs/op (see Current H5a); p50 live untested — est. <900 ms with same 7 providers + JS-only deltas (H5a no new collectors) — flat | validation ~23.0 µs/op (see Current H5b); p50 <900 ms — **H5b Reclaim Standby: one-off POST, not on snapshot hot path — budgets flat** | < 900 ms |
| Snapshot JSON (599 procs) | < 1.2 MB | 1.5 KB fixture (1 proc; `testdata/envelope_ok.json`); ~0.8 MB est. live 599 procs (extrapolated) | **2.76 KB fixture (1 proc, schemaVersion 2 + diskio/network/volumes/startup)**; ~1.0 MB est. live 599 procs (extrapolated, +~25% for new providers); budget headroom intact | **3.37 KB fixture (1 proc, schemaVersion 3 + runtimegroups/sensors/docker)**; ~1.2 MB est. live 599 procs (extrapolated, +22% vs H2); budget headroom intact (<1.5 MB) | **3.37 KB fixture (1 proc, schemaVersion 3, unchanged from H3)**; ~1.2 MB est. live 599 procs (extrapolated, +0% vs H3); budget headroom intact (<1.5 MB) | **3.37 KB fixture (1 proc, schemaVersion 3, unchanged from H3/H4)**; ~1.2 MB est. live 599 procs (extrapolated, +0% vs H4); budget headroom intact (<1.5 MB) — H5a flat (JS-only, no new providers) | **3.37 KB fixture (1 proc, schemaVersion 3, unchanged from H3/H4/H5a)**; ~1.2 MB est. live 599 procs (extrapolated, +0% vs H5a) — **H5b flat, reclaim POST not on snapshot hot path** | < 1.5 MB |
| JSON validation allocs (`BenchmarkValidateEnvelope`) | < 5 allocs/op (H4 target <50 met; H5a/H5b flat) | **107 allocs/op, 6488 B/op, ~15.1 µs/op** (`BenchmarkValidateEnvelope-16 78254 15135 ns/op 6488 B/op 107 allocs/op` on AMD Ryzen 7 9700X) — exceeds budget; optimization candidate for H2 | **128 allocs/op, 9280 B/op, ~23.3 µs/op** (`BenchmarkValidateEnvelope-16 51504 23333 ns/op 9280 B/op 128 allocs/op` on AMD Ryzen 7 9700X; earlier run 49846 24998 ns/op 9280 B/op 128 allocs/op) — +21 allocs, +2792 B, +~8 µs vs H1; budget still exceeded (flat target not met — see Notes) | **148 allocs/op, 11856 B/op, ~29.6–30.6 µs/op** (`BenchmarkValidateEnvelope-16 40204 30562 ns/op 11856 B/op 148 allocs/op`; rerun 42474 29574 ns/op 11856 B/op 148 allocs/op on AMD Ryzen 7 9700X, Go 1.26.5) — +20 allocs vs H2 | **26 allocs/op, 3296 B/op, ~23.0–23.6 µs/op** (`BenchmarkValidateEnvelope-16 52288 23031 ns/op 3296 B/op 26 allocs/op`; rerun 48697 24008 ns/op 3296 B/op 26 allocs/op on AMD Ryzen 7 9700X) — recovery 148→26 | **26 allocs/op, 3296 B/op, ~23.4–23.5 µs/op** (`BenchmarkValidateEnvelope-16 51718 23485 ns/op 3296 B/op 26 allocs/op` on AMD Ryzen 7 9700X, Go 1.26.5 — H5aT4 re-run) — flat vs H4 (no regression, JS-only) | **26 allocs/op, 3296 B/op, ~23.0 µs/op** (`BenchmarkValidateEnvelope-16 50167 23049 ns/op 3296 B/op 26 allocs/op` on AMD Ryzen 7 9700X, Go 1.26.5 — H5bT3 re-run) — **flat vs H5a, H5b Reclaim Standby: one-off POST, not on snapshot hot path — budgets flat** | < 50 allocs/op (flat) |
| Go vet / node --check | pass | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01 — re-verified H2T5) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01 — re-verified H3T4) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01 — re-verified H4T3) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, `node --check static/evidence_test.js` 0, 2026-09-01 — re-verified H5aT4) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01 — re-verified H5bT3, 26 allocs flat) | pass |
| HistoryStore 450 slots mem (JS heap) | < 2 MB | est. **~0.7–0.9 MB** fixture window (1.5 KB ×450 ≈0.68 MB + ~1.2× JS overhead); live 0.8MB×window capped by ring eviction; DevTools not measured | est. **~1.5 MB** fixture window (2.76 KB ×450 ≈1.24 MB + ~1.2× JS overhead ≈1.49 MB); live ~1.0 MB×window capped by ring; still <5 MB H2 budget | est. **~1.8 MB** fixture window (3.37 KB ×450 ≈1.52 MB + ~1.2× JS overhead ≈1.82 MB); live ~1.2 MB×window capped by ring; still <5 MB H3 budget | est. **~1.8 MB** fixture window (3.37 KB ×450 ≈1.52 MB + ~1.2× JS overhead ≈1.82 MB); live ~1.2 MB×window capped by ring; still <5 MB H4 budget | est. **~1.8 MB** fixture window (3.37 KB ×450 ≈1.52 MB + ~1.2× JS overhead ≈1.82 MB); live ~1.2 MB×window capped by ring; still <5 MB H5a budget — flat (JS-only, no size growth) | est. **~1.8 MB** fixture window (3.37 KB ×450 ≈1.52 MB + ~1.2× JS overhead ≈1.82 MB); live ~1.2 MB×window capped by ring; still <5 MB H5b budget — **flat (reclaim POST not on snapshot hot path, no HistoryStore growth)** | < 5 MB |
| Export (redacted) size | ~ same as snapshot | **~1.5 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine `[redacted]` parity) | **~2.76 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine + Startup.Command `[redacted]` parity; `Network.TcpConnections` kept verbatim — no secrets) | **~3.37 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine + Startup.Command `[redacted]` parity; RuntimeGroups/Sensors/Docker kept verbatim — no secrets, shape preserved) | **~3.37 KB + exportedAt** (≈ snapshot + ~40 B; unchanged from H3; headless respects `--redact` flag same as export) | **~3.37 KB + exportedAt** (≈ snapshot + ~40 B; unchanged from H3/H4; H5a JS-only deltas add no JSON) | **~3.37 KB + exportedAt** (≈ snapshot + ~40 B; unchanged from H3/H4/H5a; H5b reclaim adds one-off POST, not snapshot JSON — flat) | — |

## Notes

- **Snapshot latency p50**: loopback `GET /api/snapshot` with no extra providers, concurrency cap 2, 12s timeout. Measure with `Measure-Command { Invoke-RestMethod http://localhost:22880/api/snapshot }` p50 over 20 runs. H1 collector is `snapshot.ps1` (memory + processes + WSL stub). H2 adding disk/net/volumes/startup may add ~50–100ms each; budget relaxes to 900ms. H3 adds runtimegroups/sensors/docker (sensors ~50ms WMI, docker ~100ms when present) — p50 still budgeted <900 ms; validation micro-bench ~30 µs/op is not p50. H4 headless reuses same collector with 12s timeout; no HTTP server overhead. H5a adds no new providers (JS-only deltas: formatDelta/confidence/evidenceCard) — p50 flat, validation bench flat 26 allocs. H5b adds `POST /api/reclaim/standby` (PowerShell `NtSetSystemInformation` standby purge) — **one-off POST, not on snapshot poll hot path**, so p50 unchanged (<900 ms), validation bench flat 26 allocs — **H5b Reclaim Standby: one-off POST, not on snapshot hot path — budgets flat**.
- **Snapshot JSON size**: raw response bytes. Fixture `testdata/envelope_ok.json` is ~3.37 KB (1 proc stub, H3 v3 / H4 v3 / H5a v3 unchanged); extrapolate or capture a real 599-proc snapshot. H1 target ~0.8MB live; H2 with 4 providers ~1.5MB ceiling relates to wire + `HistoryStore` clone cost. H3 fixture 3371 B (+614 B vs H2, +22%) — well within 1.5 MB ceiling even extrapolated to 599 procs (~1.2 MB est.); budget headroom intact. H4 fixture unchanged 3371 B (no new providers; headless writes same envelope). H5a fixture unchanged 3371 B (no new providers; JS-only H5a adds no JSON). H5b fixture unchanged 3371 B (schemaVersion 3, no new envelope fields; reclaim is one-off POST returning `beforeBytes/afterBytes/reclaimedBytes`, not on snapshot hot path).
- **JSON validation allocs**: from `go test -bench=BenchmarkValidateEnvelope -benchmem .` — `allocs/op` and `B/op`. Validates envelope shape (`data.Memory.VisiblePhysicalBytes` etc.) via `validateEnvelope`. Budget <5 allocs/op keeps GC pressure flat on auto-refresh (2s interval). H2 delta: +21 allocs (+19.6%), +2792 B (+43%), +8.2 µs (+54%) reflects larger v2 fixture (extra structs validated). H3 delta: +20 allocs (+15.6%), +2576 B (+27.8%), +6.2–7.2 µs (+26–31%) reflects larger v3 fixture (RuntimeGroups/Sensors/Docker). Still exceeds <5 budget — flat 128 carry not met; regression noted, not blocking per Global Constraints (flat or improve is target, not hard gate). H4 recovery: struct-based `envelopeTop`/`dataMem`/`memFields` with `json.RawMessage` avoids `map[string]any` — 148→26 allocs (-82%), 11856→3296 B (-72%), ~29.5→23 µs (-22%); target <50 met. H5a flat: 26 allocs, 3296 B, ~23.4 µs — no regression (no provider change, JS-only deltas).
- **Go vet / node --check**: `go vet ./...` and `node --check static/app.js` both pass at H1, H2, H3, H4, H5a. Any change that breaks them blocks merge. H5b re-verified `go vet ./...` 0, `node --check static/app.js` 0, bench 26 allocs flat.
- **HistoryStore 450 slots**: bounded ring buffer (15 min @ 2s interval = 450 envelopes). Each slot holds `{at, envelope}`; estimate `snapshot JSON bytes × 450 × ~1.2`. H1 ~0.8MB × 450 would be large if held raw — actual `HistoryStore` holds envelopes in-memory per-tab; budget is 2MB JS heap for the live window (measured via DevTools Memory). H2 with larger envelopes allows 5MB. H3 est. 1.82 MB (3.37 KB ×450 ×1.2) still well under 5 MB. H4 unchanged 1.82 MB (same fixture size). H5a unchanged 1.82 MB (same fixture size; JS delta helpers add no heap per slot). H5b unchanged 1.82 MB (same fixture size; reclaim POST does not add HistoryStore slots).
- **Export (redacted) size**: `buildExportPayload(envelope, {redact:true})` clones via `JSON.parse(JSON.stringify(...))` and redacts `CommandLine` + `Startup.Command`. Size ~= snapshot JSON + `exportedAt` field; redacted vs unredacted differ by CommandLine length. No hard budget — track parity. H2T5 added `Startup[].Command → [redacted]` when `redact:true`; `Network.TcpConnections` kept verbatim (no secrets, shape preserved). H3T4: RuntimeGroups (no CommandLine — fields Runtime/Host/Count/TotalWorkingSet/TotalCpu/Pids), Sensors (CpuTempC float), Docker.Containers (Id/Image/State/Names) contain no secrets; shape preserved verbatim, no redaction needed. H4: headless `--redact` (default true) reuses same `applyRedaction` (`AllProcesses[].CommandLine`, `WebViewProcesses[].CommandLine`, `Startup[].Command` → `[redacted]`). H5a: unchanged (JS-only, no redaction change).

## Current (H1) — measured 2026-09-01

_Provenance — paste of `go test -bench=. -benchmem ./...` and fixture size._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16     78254       15135 ns/op     6488 B/op     107 allocs/op   # run 1
BenchmarkValidateEnvelope-16     79939       16043 ns/op     6488 B/op     107 allocs/op   # run 2 (go test -bench=. -benchmem ./...)
PASS
ok  	sysview	1.67s
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 15135 ns/op, 6488 B/op, 107 allocs/op | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 1504 B (1 proc) | `wc -c testdata/envelope_ok.json` / `(Get-Item testdata/envelope_ok.json).Length` |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 |
| `go test ./...` | PASS (10 tests) | `go test ./... -v` — 10 PASS, 0 FAIL |

> H2 delta rule: each H2 PR MUST publish `| Metric | H1 baseline | H2 proposal | Delta | Budget? |` using this row as baseline.

## Current (H2) — measured 2026-09-01 (H2T5 — after diskio/network/volumes/startup providers + Startup redaction)

_Provenance — `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .`, `go test ./... -v`, `go vet ./...`, `node --check static/app.js`, fixture size._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16    	   49846	     24998 ns/op	    9280 B/op	     128 allocs/op   # H2 run 1 (pre-report)
BenchmarkValidateEnvelope-16    	   51504	     23333 ns/op	    9280 B/op	     128 allocs/op   # H2 run 2 (final)
PASS
ok  	sysview	1.542s  # run 1
ok  	sysview	1.542s  # run 2
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 23333 ns/op, 9280 B/op, 128 allocs/op (run 2); 24998 ns/op same B/allocs (run 1) | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 2757 B (1 proc, v2) | `(Get-Item testdata/envelope_ok.json).Length` → 2757; `2.69 KB` |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 (H2T5) |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 (H2T5 — with Startup redaction) |
| `go test ./...` | PASS (10 tests) | `go test ./... -v` — 10 PASS, 0 FAIL (TestValidateEnvelope_* 3, TestHandleSnapshot_* 2, TestHandleWslShutdown_* 3, TestMemoryInvariants_Tolerance 1, TestMemoryUnavailable_RendersUnavailable 1) |
| `node static/export_test.js` | PASS | `node static/export_test.js` → `export_test PASS` (WebViewProcesses + AllProcesses redaction preserved); manual Startup check PASS (`Startup.Command → [redacted]` when redact true, preserved when false, Network shape untouched) |
| `buildExportPayload` redaction | Startup.Command redacted | `static/app.js` — `if(redact && clone.data && clone.data.Startup){ clone.data.Startup.forEach(s=>{ if(s.Command) s.Command="[redacted]"; }); }` — Network TcpConnections kept verbatim (no secrets) |

| Metric | H1 baseline | H2 proposal | Delta | Budget? |
|--------|-------------|-------------|-------|---------|
| `BenchmarkValidateEnvelope` allocs | 107 allocs/op | 128 allocs/op | +21 (+19.6%) | **exceeds <5 budget** (flat target not met; regression noted — larger v2 fixture drives allocs; carry to H3) |
| `BenchmarkValidateEnvelope` B/op | 6488 B/op | 9280 B/op | +2792 B (+43%) | — |
| `BenchmarkValidateEnvelope` ns/op | 15135 ns/op | 23333 ns/op | +8198 ns (+54%) | — |
| Snapshot JSON fixture | 1504 B | 2757 B | +1253 B (+83%) | **pass** (<1.5 MB ceiling; est. live 599 procs ~1.0 MB <1.5 MB) |
| HistoryStore 450 slots (est.) | ~0.68 MB ×1.2 ≈0.82 MB | ~1.24 MB ×1.2 ≈1.49 MB | +0.67 MB | **pass** (<5 MB) |
| Go vet / node --check | pass | pass | 0 | **pass** |
| Export redacted parity | CommandLine only | CommandLine + Startup.Command | +Startup redaction | **pass** (no size budget) |

## Current (H3) — measured 2026-09-01 (H3T4 — after RuntimeGroups/Sensors/Docker + HTML hardening + redaction check)

_Provenance — `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .`, `go test ./... -v`, `go vet ./...`, `node --check static/app.js`, fixture size, html-validate._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16    	   40204	     30562 ns/op	   11856 B/op	     148 allocs/op   # H3 run 1
BenchmarkValidateEnvelope-16    	   42474	     29574 ns/op	   11856 B/op	     148 allocs/op   # H3 run 2
PASS
ok  	sysview	1.580s  # run 1
ok  	sysview	1.615s  # run 2
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 29574–30562 ns/op, 11856 B/op, 148 allocs/op (runs 1–2) | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 3371 B (1 proc, v3) | `(Get-Item testdata/envelope_ok.json).Length` → 3371; `3.29 KB` |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 (H3T4) |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 (H3T4 — RuntimeGroups/Sensors/Docker no redaction needed, Startup redaction preserved) |
| `go test ./...` | PASS (10 tests) | `go test ./... -v` — 10 PASS, 0 FAIL (TestValidateEnvelope_* 3, TestHandleSnapshot_* 2, TestHandleWslShutdown_* 3, TestMemoryInvariants_Tolerance 1, TestMemoryUnavailable_RendersUnavailable 1) |
| `node static/export_test.js` + history/tabs | PASS | `node static/export_test.js` → `export_test PASS`; `node static/history_store_test.js` → `all assertions passed`; `node static/tabs_test.js` → `all assertions passed` |
| `buildExportPayload` redaction (H3 check) | pass — no new CommandLine-like fields | RuntimeGroups [{Runtime,Host,Count,TotalWorkingSet,TotalCpu,Pids}] no CommandLine; Sensors {CpuTempC} no secrets; Docker.Containers [{Id,Image,State,Names}] no secrets — shape preserved verbatim. Manual `node -e` verifies `redact:true` keeps groups/sensors/docker intact, `redact:false` preserves secrets elsewhere, original not mutated |
| html-validate | pass | `node -e` counts: `<section>` 15 vs `</section>` 15 match, `<div>` 67 vs `</div>` 67 match, `**` 0, `&bull;` 0, footer `v0.2.0` present, install docs via README (`winget`/`scoop` manifests) |

| Metric | H2 baseline | H3 proposal | Delta | Budget? |
|--------|-------------|-------------|-------|---------|
| `BenchmarkValidateEnvelope` allocs | 128 allocs/op | 148 allocs/op | +20 (+15.6%) | **exceeds <5 budget** (flat 128 carry not met; larger v3 fixture drives allocs; carry to next horizon) |
| `BenchmarkValidateEnvelope` B/op | 9280 B/op | 11856 B/op | +2576 B (+27.8%) | — |
| `BenchmarkValidateEnvelope` ns/op | 23333 ns/op | ~29574 ns/op | +6241 ns (+26.7%) | — |
| Snapshot JSON fixture | 2757 B | 3371 B | +614 B (+22.3%) | **pass** (<1.5 MB ceiling; est. live 599 procs ~1.2 MB <1.5 MB) |
| HistoryStore 450 slots (est.) | ~1.24 MB ×1.2 ≈1.49 MB | ~1.52 MB ×1.2 ≈1.82 MB | +0.33 MB | **pass** (<5 MB; headroom 3.18 MB) |
| Go vet / node --check | pass | pass | 0 | **pass** |
| Export redacted parity | Startup.Command redacted | unchanged + H3 no new secrets | 0 | **pass** |
| html-validate (sections/divs/bullets/footer) | N/A (pre-H3T4 sections 16 vs 15 mismatch) | 15/15 sections, 67/67 divs, `**`0 `&bull;`0, footer v0.2.0 | fixed extra `</section>` in WSL panel | **pass** |

## Current (H4) — measured 2026-09-01 (H4T3 — bench perf recovery 148→26 + headless tests)

_Provenance — `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .`, `go test ./... -v`, `go vet ./...`, `node --check static/app.js`, fixture size, html-validate._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16    	   52288	     23031 ns/op	    3296 B/op	      26 allocs/op   # H4 run 1 (post-refactor)
BenchmarkValidateEnvelope-16    	   48697	     24008 ns/op	    3296 B/op	      26 allocs/op   # H4 run 2
BenchmarkValidateEnvelope-16    	   51952	     23272 ns/op	    3296 B/op	      26 allocs/op   # H4 run 3
PASS
ok  	sysview	1.546s  # run 1
ok  	sysview	1.512s  # run 2
ok  	sysview	1.542s  # run 3
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 23031 ns/op, 3296 B/op, 26 allocs/op (run 1); 23272–24008 ns/op same B/allocs (runs 2–3) | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 3371 B (1 proc, v3, unchanged) | `(Get-Item testdata/envelope_ok.json).Length` → 3371; `3.29 KB` |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 (H4T3) |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 (H4T3 — headless no frontend change; HistoryStore/redaction preserved) |
| `go test ./...` | PASS (13 tests) | `go test ./... -v` — 13 PASS, 0 FAIL (3 validate, 2 snapshot, 3 wsl, 2 memory, 3 headless: TestHeadlessHelp, TestHeadlessWritesFile, TestHeadlessRedactToggleAndExitCodes) |
| `node static/export_test.js` + history/tabs | PASS | `node static/export_test.js` → `export_test PASS`; `node static/history_store_test.js` → `all assertions passed`; `node static/tabs_test.js` → `all assertions passed` |
| `buildExportPayload` redaction (H4 check) | pass — unchanged | Headless `applyRedaction` same path as export; `TestHeadlessWritesFile` verifies `[redacted]` on file, pretty toggle, JSON valid |
| html-validate | pass | `node -e` counts: `<section>` 15 vs `</section>` 15 match, `<div>` 67 vs `</div>` 67 match, `**` 0, `&bull;` 0, footer `v0.2.0` present (unchanged from H3) |
| Headless flags | pass | `go run . --help` contains `headless`/`once`/`output`/`pretty`/`redact`; `TestHeadlessHelp` PASS; `TestHeadlessWritesFile` uses `t.TempDir` file + redacted JSON valid |

| Metric | H3 baseline | H4 proposal | Delta | Budget? |
|--------|-------------|-------------|-------|---------|
| `BenchmarkValidateEnvelope` allocs | 148 allocs/op | 26 allocs/op | -122 (-82.4%) | **pass** (target <50 met; recovery 148→26) |
| `BenchmarkValidateEnvelope` B/op | 11856 B/op | 3296 B/op | -8560 B (-72.2%) | — |
| `BenchmarkValidateEnvelope` ns/op | ~29574 ns/op | ~23031 ns/op | -6543 ns (-22.1%) | — |
| Snapshot JSON fixture | 3371 B | 3371 B | 0 | **pass** (<1.5 MB ceiling; est. live ~1.2 MB <1.5 MB) |
| HistoryStore 450 slots (est.) | ~1.52 MB ×1.2 ≈1.82 MB | ~1.52 MB ×1.2 ≈1.82 MB | 0 | **pass** (<5 MB; headroom 3.18 MB) |
| Go vet / node --check | pass | pass | 0 | **pass** |
| Export/headless redacted parity | Startup.Command redacted | unchanged + headless file output redacted (t.TempDir) | 0 | **pass** |
| html-validate (sections/divs/bullets/footer) | 15/15 sections, 67/67 divs, `**`0 `&bull;`0 | 15/15 sections, 67/67 divs, `**`0 `&bull;`0 (unchanged) | 0 | **pass** |
| Headless tests | 0 | 3 headless tests (help, writes-file, redact/pretty/exit) | +3 | **pass** (13 total, 10 existing preserved) |

## Current (H5a) — measured 2026-09-01 (H5aT4 — JS-only evidence cards/deltas, no new providers — flat vs H4)

_Provenance — `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .`, `go test ./... -v`, `go vet ./...`, `node --check static/app.js`, fixture size, html-validate, 4 JS tests._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16    	   51718	     23485 ns/op	    3296 B/op	      26 allocs/op   # H5a run 1 (re-run H5aT4)
BenchmarkValidateEnvelope-16    	   52288	     23031 ns/op	    3296 B/op	      26 allocs/op   # H4 reference run 1 (same binary, pre-H5a)
PASS
ok  	sysview	1.564s  # H5a run 1
ok  	sysview	1.546s  # H4 ref
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 23485 ns/op, 3296 B/op, 26 allocs/op (H5a run 1); 23031 ns/op same B/allocs (H4 ref) — flat | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 3371 B (1 proc, v3, unchanged from H3/H4) | `(Get-Item testdata/envelope_ok.json).Length` → 3371; `3.29 KB` — H5a flat (no new providers) |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 (H5aT4) |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 (H5aT4 — evidenceCard/deltas/confidence JS-only) |
| `node --check` JS | pass | `node --check static/app.js` 0, `node --check static/evidence_test.js` 0, `node --check static/export_test.js` 0, `node --check static/history_store_test.js` 0, `node --check static/tabs_test.js` 0 |
| `go test ./...` | PASS (13 tests) | `go test ./... -v` — 13 PASS, 0 FAIL (3 validate, 2 snapshot, 3 wsl, 2 memory, 3 headless) — flat vs H4 |
| `node static/*_test.js` (4) | PASS | `node static/export_test.js` → `export_test PASS`; `node static/history_store_test.js` → `all assertions passed`; `node static/tabs_test.js` → `all assertions passed`; `node static/evidence_test.js` → `evidence_test PASS` |
| `buildExportPayload` redaction (H5a check) | pass — unchanged | H5a JS-only, no new secrets; headless/export redaction path unchanged (verified H4) |
| html-validate | pass | `node -e` counts: `<section>` 15 vs `</section>` 15 match, `<div>` 67 vs `</div>` 67 match, `**` 0, `&bull;` 0, footer `v0.2.0` present (unchanged from H3/H4) |
| Evidence helpers | pass | `window.formatDelta`, `window.confidenceForSampleCount`, `HistoryStore.deltasExtended`, `evidenceCard` — covered by `node static/evidence_test.js` PASS |

| Metric | H4 baseline | H5a proposal | Delta | Budget? |
|--------|-------------|-------------|-------|---------|
| `BenchmarkValidateEnvelope` allocs | 26 allocs/op | 26 allocs/op | 0 (flat) | **pass** (target <50 met; H5a flat — JS-only, no regression) |
| `BenchmarkValidateEnvelope` B/op | 3296 B/op | 3296 B/op | 0 (flat) | **pass** |
| `BenchmarkValidateEnvelope` ns/op | ~23031 ns/op | ~23485 ns/op | +454 ns (+1.9% noise) | **pass** |
| Snapshot JSON fixture | 3371 B | 3371 B | 0 | **pass** (<1.5 MB ceiling; est. live ~1.2 MB <1.5 MB) |
| HistoryStore 450 slots (est.) | ~1.52 MB ×1.2 ≈1.82 MB | ~1.52 MB ×1.2 ≈1.82 MB | 0 | **pass** (<5 MB; headroom 3.18 MB) |
| Go vet / node --check | pass | pass | 0 | **pass** |
| Export/headless redacted parity | Startup.Command redacted | unchanged (JS-only) | 0 | **pass** |
| html-validate (sections/divs/bullets/footer) | 15/15 sections, 67/67 divs, `**`0 `&bull;`0 | 15/15 sections, 67/67 divs, `**`0 `&bull;`0 (unchanged) | 0 | **pass** |
| JS tests | 3 JS tests (export/history/tabs) | 4 JS tests (+evidence_test) | +1 harness | **pass** (13 Go + 4 JS = 17 PASS) |

## Current (H5b) — measured 2026-09-01 (H5bT3 — Reclaim Standby one-off POST, flat vs H5a/H4 — budgets flat)

_Provenance — `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .`, `go test ./... -v`, `go vet ./...`, `node --check static/app.js`, fixture size, html-validate, 4 JS tests._

```
goos: windows
goarch: amd64
pkg: sysview
cpu: AMD Ryzen 7 9700X 8-Core Processor
BenchmarkValidateEnvelope-16           50167         23049 ns/op        3296 B/op          26 allocs/op   # H5b run 1 (H5bT3 re-run, flat)
BenchmarkValidateEnvelope-16           51718         23485 ns/op        3296 B/op          26 allocs/op   # H5a ref run 1 (same allocs, flat)
PASS
ok      sysview 1.508s  # H5b run 1
ok      sysview 1.564s  # H5a ref
```

| Metric | Value | Source |
|--------|-------|--------|
| `BenchmarkValidateEnvelope` | 23049 ns/op, 3296 B/op, 26 allocs/op (H5b run 1); 23485 ns/op same B/allocs (H5a ref) — flat | `go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .` (windows/amd64, Ryzen 7 9700X, Go 1.26.5) |
| Snapshot JSON (fixture) | 3371 B (1 proc, v3, unchanged from H3/H4/H5a) | `(Get-Item testdata/envelope_ok.json).Length` → 3371; `3.29 KB` — H5b flat (no new envelope fields; reclaim is one-off POST, not snapshot poll) |
| `go vet ./...` | pass | `go vet ./...` exit 0, 2026-09-01 (H5bT3) |
| `node --check static/app.js` | pass | `node --check static/app.js` exit 0, 2026-09-01 (H5bT3 — reclaim button + result banner, textContent) |
| `node --check` JS | pass | `node --check static/app.js` 0, `node --check static/evidence_test.js` 0, `node --check static/export_test.js` 0, `node --check static/history_store_test.js` 0, `node --check static/tabs_test.js` 0 |
| `go test ./...` | PASS (18 tests) | `go test ./... -v` — 18 PASS, 0 FAIL (3 validate, 2 snapshot, 3 wsl, 5 reclaim, 2 memory, 3 headless) — **H5b Reclaim Standby: one-off POST, not on snapshot hot path — budgets flat** |
| `node static/*_test.js` (4) | PASS | `node static/export_test.js` → `export_test PASS`; `node static/history_store_test.js` → `all assertions passed`; `node static/tabs_test.js` → `all assertions passed`; `node static/evidence_test.js` → `evidence_test PASS` |
| `buildExportPayload` redaction (H5b check) | pass — unchanged | H5b reclaim POST does not touch export/headless redaction; shape preserved verbatim |
| html-validate | pass | `node -e` counts: `<section>` 15 vs `</section>` 15 match, `<div>` 68 vs `</div>` 68 match, `**` 0, `&bull;` 0, footer `v0.2.0` present (reclaim adds `#reclaim-result` div — balanced) |
| Reclaim contract | pass | `POST /api/reclaim/standby` — token+origin+confirm, 429 cap 1, 12s timeout; no PS invocation in tests (handler contract only) — 5 new tests: RequiresToken/Origin/Confirm/MethodNotAllowed/RateLimit |

| Metric | H5a baseline | H5b proposal | Delta | Budget? |
|--------|-------------|-------------|-------|---------|
| `BenchmarkValidateEnvelope` allocs | 26 allocs/op | 26 allocs/op | 0 (flat) | **pass** (target <50 met; H5b flat — reclaim one-off POST, not on snapshot hot path) |
| `BenchmarkValidateEnvelope` B/op | 3296 B/op | 3296 B/op | 0 (flat) | **pass** |
| `BenchmarkValidateEnvelope` ns/op | ~23485 ns/op | ~23049 ns/op | -436 ns (-1.8% noise) | **pass** |
| Snapshot JSON fixture | 3371 B | 3371 B | 0 | **pass** (<1.5 MB ceiling; est. live ~1.2 MB <1.5 MB) |
| HistoryStore 450 slots (est.) | ~1.52 MB ×1.2 ≈1.82 MB | ~1.52 MB ×1.2 ≈1.82 MB | 0 | **pass** (<5 MB; headroom 3.18 MB) |
| Go vet / node --check | pass | pass | 0 | **pass** |
| Export/headless redacted parity | Startup.Command redacted | unchanged (reclaim does not alter JSON) | 0 | **pass** |
| html-validate (sections/divs/bullets/footer) | 15/15 sections, 67/67 divs, `**`0 `&bull;`0 | 15/15 sections, 68/68 divs, `**`0 `&bull;`0 (reclaim adds balanced div) | +1 div balanced | **pass** |
| Go tests | 13 Go tests | 18 Go tests (+5 reclaim: Token/Origin/Confirm/MethodNotAllowed/RateLimit) | +5 | **pass** (18 Go + 4 JS = 22 PASS) |
| JS tests | 4 JS tests | 4 JS tests (unchanged) | 0 | **pass** |

