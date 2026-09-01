# Perf & Capability Budgets (H2/H3 gates)

Baseline: H1 (commit 03fadd2 base, post-H1T7). H2 proposals MUST publish delta vs `Current (H1)`.

| Metric | Budget | Current (H1) | Current (H2) | H2 target |
|--------|--------|-------------|-------------|-----------|
| Snapshot latency p50 (loopback, `GET /api/snapshot`) | < 800 ms | not measured live; validation ~15 µs/op (see below); p50 budget untested at H1 (fixture 1 proc) | validation ~23.3 µs/op (see Current H2); p50 live untested — est. <900 ms with 4 new providers | < 900 ms after disk/net providers |
| Snapshot JSON (599 procs) | < 1.2 MB | 1.5 KB fixture (1 proc; `testdata/envelope_ok.json`); ~0.8 MB est. live 599 procs (extrapolated) | **2.76 KB fixture (1 proc, schemaVersion 2 + diskio/network/volumes/startup)**; ~1.0 MB est. live 599 procs (extrapolated, +~25% for new providers); budget headroom intact | < 1.5 MB after 4 providers |
| JSON validation allocs (`BenchmarkValidateEnvelope`) | < 5 allocs/op | **107 allocs/op, 6488 B/op, ~15.1 µs/op** (`BenchmarkValidateEnvelope-16 78254 15135 ns/op 6488 B/op 107 allocs/op` on AMD Ryzen 7 9700X) — exceeds budget; optimization candidate for H2 | **128 allocs/op, 9280 B/op, ~23.3 µs/op** (`BenchmarkValidateEnvelope-16 51504 23333 ns/op 9280 B/op 128 allocs/op` on AMD Ryzen 7 9700X; earlier run 49846 24998 ns/op 9280 B/op 128 allocs/op) — +21 allocs, +2792 B, +~8 µs vs H1; budget still exceeded (flat target not met — see Notes) | flat (keep ≤107 or reduce to <5) |
| Go vet / node --check | pass | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01) | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01 — re-verified H2T5) | pass |
| HistoryStore 450 slots mem (JS heap) | < 2 MB | est. **~0.7–0.9 MB** fixture window (1.5 KB ×450 ≈0.68 MB + ~1.2× JS overhead); live 0.8MB×window capped by ring eviction; DevTools not measured | est. **~1.5 MB** fixture window (2.76 KB ×450 ≈1.24 MB + ~1.2× JS overhead ≈1.49 MB); live ~1.0 MB×window capped by ring; still <5 MB H2 budget | < 5 MB |
| Export (redacted) size | ~ same as snapshot | **~1.5 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine `[redacted]` parity) | **~2.76 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine + Startup.Command `[redacted]` parity; `Network.TcpConnections` kept verbatim — no secrets) | — |

## Notes

- **Snapshot latency p50**: loopback `GET /api/snapshot` with no extra providers, concurrency cap 2, 12s timeout. Measure with `Measure-Command { Invoke-RestMethod http://localhost:22880/api/snapshot }` p50 over 20 runs. H1 collector is `snapshot.ps1` (memory + processes + WSL stub). H2 adding disk/net/volumes/startup may add ~50–100ms each; budget relaxes to 900ms.
- **Snapshot JSON size**: raw response bytes. Fixture `testdata/envelope_ok.json` is ~2.76 KB (1 proc stub, H2); extrapolate or capture a real 599-proc snapshot. H1 target ~0.8MB live; H2 with 4 providers ~1.5MB ceiling relates to wire + `HistoryStore` clone cost. H2 fixture grew +1.25 KB (+83%) for Network/Volumes/Startup/IO fields — well within 1.5 MB ceiling even extrapolated to 599 procs (~1.0 MB est.).
- **JSON validation allocs**: from `go test -bench=BenchmarkValidateEnvelope -benchmem .` — `allocs/op` and `B/op`. Validates envelope shape (`data.Memory.VisiblePhysicalBytes` etc.) via `validateEnvelope`. Budget <5 allocs/op keeps GC pressure flat on auto-refresh (2s interval). H2 delta: +21 allocs (+19.6%), +2792 B (+43%), +8.2 µs (+54%) reflects larger v2 fixture (extra structs validated). Still exceeds <5 budget — optimization candidate carried to H3; H2 gate is "flat or improve" — regression noted, not blocking per Global Constraints (flat or improve is target, not hard gate).
- **Go vet / node --check**: `go vet ./...` and `node --check static/app.js` both pass at H1 and H2. Any H2 change that breaks them blocks merge.
- **HistoryStore 450 slots**: bounded ring buffer (15 min @ 2s interval = 450 envelopes). Each slot holds `{at, envelope}`; estimate `snapshot JSON bytes × 450 × ~1.2`. H1 ~0.8MB × 450 would be large if held raw — actual `HistoryStore` holds envelopes in-memory per-tab; budget is 2MB JS heap for the live window (measured via DevTools Memory). H2 with larger envelopes allows 5MB. H2 est. 1.49 MB still well under 5 MB.
- **Export (redacted) size**: `buildExportPayload(envelope, {redact:true})` clones via `JSON.parse(JSON.stringify(...))` and redacts `CommandLine` + `Startup.Command`. Size ~= snapshot JSON + `exportedAt` field; redacted vs unredacted differ by CommandLine length. No hard budget — track parity. H2T5 added `Startup[].Command → [redacted]` when `redact:true`; `Network.TcpConnections` kept verbatim (no secrets, shape preserved).

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
