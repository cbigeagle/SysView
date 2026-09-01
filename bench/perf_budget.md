# Perf & Capability Budgets (H2/H3 gates)

Baseline: H1 (commit 03fadd2 base, post-H1T7). H2 proposals MUST publish delta vs `Current (H1)`.

| Metric | Budget | Current (H1) | H2 target |
|--------|--------|-------------|-----------|
| Snapshot latency p50 (loopback, `GET /api/snapshot`) | < 800 ms | not measured live; validation ~15 µs/op (see below); p50 budget untested at H1 (fixture 1 proc) | < 900 ms after disk/net providers |
| Snapshot JSON (599 procs) | < 1.2 MB | 1.5 KB fixture (1 proc; `testdata/envelope_ok.json`); ~0.8 MB est. live 599 procs (extrapolated) | < 1.5 MB after 3 providers |
| JSON validation allocs (`BenchmarkValidateEnvelope`) | < 5 allocs/op | **107 allocs/op, 6488 B/op, ~15.1 µs/op** (`BenchmarkValidateEnvelope-16 78254 15135 ns/op 6488 B/op 107 allocs/op` on AMD Ryzen 7 9700X) — exceeds budget; optimization candidate for H2 | flat (keep ≤107 or reduce to <5) |
| Go vet / node --check | pass | **pass** (`go vet ./...` 0, `node --check static/app.js` 0, 2026-09-01) | pass |
| HistoryStore 450 slots mem (JS heap) | < 2 MB | est. **~0.7–0.9 MB** fixture window (1.5 KB ×450 ≈0.68 MB + ~1.2× JS overhead); live 0.8MB×window capped by ring eviction; DevTools not measured | < 5 MB |
| Export (redacted) size | ~ same as snapshot | **~1.5 KB + exportedAt** (≈ snapshot + ~40 B; redacted CommandLine `[redacted]` parity) | — |

## Notes

- **Snapshot latency p50**: loopback `GET /api/snapshot` with no extra providers, concurrency cap 2, 12s timeout. Measure with `Measure-Command { Invoke-RestMethod http://localhost:22880/api/snapshot }` p50 over 20 runs. H1 collector is `snapshot.ps1` (memory + processes + WSL stub). H2 adding disk/net/GPU may add ~50–100ms each; budget relaxes to 900ms.
- **Snapshot JSON size**: raw response bytes. Fixture `testdata/envelope_ok.json` is ~1.5 KB (1 proc stub); extrapolate or capture a real 599-proc snapshot. H1 target ~0.8MB live; H2 with 3 providers ~1.5MB ceiling relates to wire + `HistoryStore` clone cost.
- **JSON validation allocs**: from `go test -bench=BenchmarkValidateEnvelope -benchmem .` — `allocs/op` and `B/op`. Validates envelope shape (`data.Memory.VisiblePhysicalBytes` etc.) via `validateEnvelope`. Budget <5 allocs/op keeps GC pressure flat on auto-refresh (2s interval).
- **Go vet / node --check**: `go vet ./...` and `node --check static/app.js` both pass at H1. Any H2 change that breaks them blocks merge.
- **HistoryStore 450 slots**: bounded ring buffer (15 min @ 2s interval = 450 envelopes). Each slot holds `{at, envelope}`; estimate `snapshot JSON bytes × 450 × ~1.2`. H1 ~0.8MB × 450 would be large if held raw — actual `HistoryStore` holds envelopes in-memory per-tab; budget is 2MB JS heap for the live window (measured via DevTools Memory). H2 with larger envelopes allows 5MB.
- **Export (redacted) size**: `buildExportPayload(envelope, {redact:true})` clones via `JSON.parse(JSON.stringify(...))` and redacts `CommandLine`. Size ~= snapshot JSON + `exportedAt` field; redacted vs unredacted differ by CommandLine length. No hard budget — track parity.

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
