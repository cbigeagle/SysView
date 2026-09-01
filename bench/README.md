# Benchmark Charter — Horizon 1 Baseline & H2/H3 Gates

This directory holds the benchmark harness and perf budgets that gate Horizon 2 (sensors / autostart / GPU) and Horizon 3 changes. H1 establishes the baseline; H2/H3 MUST NOT regress beyond the budgets without an explicit delta write-up.

## How to run

```bash
# Full suite with allocation stats (root + subpackages)
go test -bench=. -benchmem ./...

# Benchmark only (root package, where validateEnvelope lives)
go test -bench=BenchmarkValidateEnvelope -benchmem -run=^$ .

# Single-iteration timing for quick check
go test -bench=. -benchmem -benchtime=1x ./...
```

Requirements:

- Go 1.26.5 floor (`go.mod`).
- `go vet ./...` MUST still pass before recording numbers.
- `node --check static/app.js` MUST pass (JS budget rows are visual/heuristic, not blocking).

Bench file: `../snapshot_bench_test.go` (package `main` at repo root) so it can call unexported `validateEnvelope` directly. Placing it in `bench/` would require a duplicate or an exported shim — intentionally avoided. Run `go test -bench` from the repo root, not from `bench/`.

Fixture: `../testdata/envelope_ok.json` — the golden envelope emitted by `snapshot.ps1`. Bench reads it once outside the loop and validates in-loop with `b.ReportAllocs()`.

## When to record

- **After H1 merge** — capture the H1 baseline into `perf_budget.md` `Current (H1)` column (allocs/op, JSON size, latency note). Commit with `bench/perf_budget.md`.
- **Before H2 merge** — each H2 proposal (new provider, disk/net/GPU, autostart sensor) MUST run the same command and publish a delta table in the PR description:
  `| Metric | H1 baseline | H2 proposal | Delta | Budget? |`
- **On perf fix** — re-record `Current` and note the commit hash in the PR.

## H2/H3 delta rule

> **H2 features (sensors / autostart / GPU) and any H3 expansion MUST publish delta vs the H1 baseline and remain within `perf_budget.md` budgets.** If a proposal exceeds a budget, it MUST either (a) justify the cost with a measured user benefit, or (b) land an optimization that brings it back under budget. Budgets are gates, not suggestions — `Snapshot latency p50 < 800ms (loopback)` and `Snapshot JSON < 1.2MB (599 procs)` and `JSON validation < 5 allocs/op` are the H1 ceilings. H2 targets allow modest growth (`< 900ms`, `< 1.5MB` after 3 providers) but require the delta to be posted.

## Interpreting numbers

- `allocs/op` and `B/op` come from `BenchmarkValidateEnvelope` (`b.ReportAllocs`). The validation path is pure `encoding/json` — expect low single-digit allocs. Regressions usually mean extra `Unmarshal` copies or `fmt.Errorf` in the hot path.
- Snapshot latency and JSON size are not micro-benchmarks — measure with `Measure-Command { Invoke-RestMethod http://localhost:22880/api/snapshot }` and `wc -c` on the response or the fixture size (`(Get-Item testdata/envelope_ok.json).Length`). Record p50 over 20 runs.
- JS heap for `HistoryStore` (450 slots) is estimated: envelope JSON size × 450 × JS object overhead (~1.2×). Keep under 2 MB baseline, 5 MB H2.

## Not blocking H1 merge

This harness is scaffolding — it does not add providers or change `validateEnvelope`/`handleSnapshot` behavior. It exists so H2 decisions are data-driven.
