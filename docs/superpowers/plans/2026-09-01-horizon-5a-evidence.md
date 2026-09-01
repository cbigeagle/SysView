# Horizon 5a — Evidence & Presentation Payoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax. Parallelize only where file ownership disjoint; app.js is single owner per batch if needed.

**Goal:** Make every number self-explaining — turn Horizon 1-4's raw data into evidence cards + trend deltas + confidences so a helpdesk tech knows *why* and *what to do next* without docs. No new collectors, no H5b fixers yet — purely presentation/intelligence layering over existing HistoryStore + envelope.

**Architecture:** Extend `HistoryStore` deltas across all providers, add pure helpers `formatDelta`, `confidenceForSampleCount`, `evidenceCard` factory, wire to existing `runDiagnosticsEngine` and new banner deltas on Pressure/Pools/Volumes/Startup panels. All dynamic values via `textContent`, `aria-live` for badge/pressure updates. HistoryStore cap 450 already.

**Tech Stack:** Vanilla JS, CSS tokens, `go test`/`node --check` unchanged, `bench/perf_budget.md` target flat.

## Global Constraints

- Single binary, 12s/cap2, [IP_ADDRESS]+token on served, textContent for telemetry, schemaVersion 3 unchanged, redaction unchanged, vet/check green.
- HistoryStore cap 450 @2s (15 min), sparklines 120×28 last 30 already, reduced-motion + focus-visible already.
- Budgets: JSON 3.37KB fixture → est. live 1.2MB <1.5MB, HistoryStore 1.82MB <5MB, p50 <900ms, allocs 26 flat (H4 target <50 met, keep flat).
- No new PowerShell providers, no schema bump, no new deps.

## File Structure

```
static/
  app.js        # + HistoryStore.deltasExtended(), formatDelta(), confidence(), evidenceCard(), pressureBanner trend, pools trend, volumes/storage low-space evidence, startup triage evidence, aria-live hooks
  index.html    # + pressure banner delta span, pool trend span, aria-live regions for pressure/pools/volumes/startup
  style.css     # + .evidence-meta, .confidence-low/med/high, .trend-up/down/flat, .pressure-banner tokens
bench/perf_budget.md # H5a target flat (no new providers, so no size growth expected — note deltas are JS-only)
```

## Shared Contract (pure helpers)

```js
// New pure helpers (window-exposed for tests)
function formatDelta(bytesDelta): string // "+0.7 GB", "-220 MB", "±0 GB" with sign and GB/MB
function confidenceForSampleCount(n): {label:"Low"|"Med"|"High", class:"confidence-low/med/high", elapsedSec: n*interval}
function deltasExtended(): { availableDelta, inUseDelta, poolDelta, standbyDelta, modifiedDelta } // uses HistoryStore last 2 + last 10 for spark trend
function evidenceCard({type:"info"/"success"/"warning"/"danger", title, observed, mayMean, nextCheck, confidenceLabel, elapsedSec}): HTMLElement // builds insight-item with Observed → May mean → Next safe check + confidence + elapsed
```

All insight rendering switches to evidenceCard factory (replaces ad-hoc insight push). Pressure banner and pools/volume/startup panels show delta line with confidence.

---

### Task H5aT1: History Deltas + Confidence Helpers + Pressure Banner

**Files:**
- Modify: static/app.js — HistoryStore + helpers + updateHistoryBadge/pressureBanner
- Modify: static/index.html — pressure banner delta span
- Modify: static/style.css — trend/confidence tokens

**Interfaces:**
- Consumes: HistoryStore.items {at, envelope}, envelope.data.Memory
- Produces: window.formatDelta, window.confidenceForSampleCount, window.deltasExtended, pressure banner DOM #pressure-delta #pressure-confidence

- [ ] Step 1: Write failing JS contract test `static/evidence_test.js` — asserts formatDelta(0.7GB) → "+0.70 GB", confidenceForSampleCount(1)→Low, 10→Med, 30→High, deltasExtended on 2-item store.
- [ ] Step 2: Run `node static/evidence_test.js` → FAIL (missing helpers)
- [ ] Step 3: Implement helpers in app.js before grabSnapshot: HistoryStore.deltasExtended(), formatDelta(bytes) with GB/MB sign, confidenceForSampleCount(n) (1-2 Low, 3-10 Med, 11+ High), expose window.*
- [ ] Step 4: Wire pressure banner: in updateUI after mem block, compute deltasExtended(), render #pressure-delta textContent `Available 6.8→6.1 GB (−0.7 GB, 3 samples, 6s, Med)` and #pressure-confidence class, update aria-live="polite" region. Add #pressure-delta span in index.html memory-section header.
- [ ] Step 5: Run `node --check static/app.js` + `node static/evidence_test.js` + `go vet` + `go test` + existing JS tests → PASS. Commit.

### Task H5aT2: Evidence Cards Across All Insights + Trend Deltas on Pools/Volumes/Startup

**Files:**
- Modify: static/app.js — runDiagnosticsEngine refactor to evidenceCard factory + pool/volumes/startup trends
- Modify: static/style.css — evidence card meta

**Interfaces:**
- Consumes: formatDelta, confidence, deltasExtended, envelope.data.*
- Produces: insight-item DOM built via evidenceCard factory; pool trend line, volumes low-space evidence, startup triage evidence

- [ ] Step 1: Create evidenceCard factory: builds div.insight-item with .evidence-meta containing Observed / May mean / Next safe check + confidence + elapsed, using textContent for all telemetry strings.
- [ ] Step 2: Refactor runDiagnosticsEngine to use factory for: pressure, pool (add trend `poolDelta over last 10 samples (+220MB over 12 min, High)`), standby, webview, wsl, plus new: volumes low-space (<10% free → warning evidence card with "May mean: disk pressure → Next: Storage Sense"), startup triage (if >20 startup items → info card).
- [ ] Step 3: Pool card shows trend line below detail-size using formatDelta + confidence.
- [ ] Step 4: Verify with `node --check` + manual DOM: pool trend updates on second snapshot, volumes card appears when fixture <10% free, startup card appears when mock >20.

### Task H5aT3: Aria-live Polish + Tabular-nums & Single Accent Audit

**Files:**
- Modify: static/index.html — aria-live regions
- Modify: static/style.css — polish

**Interfaces:** N/A

- [ ] Step 1: Add aria-live="polite" to #pressure-delta, #pool-trend, #history-badge, ensure insights container has aria-live="polite" and refresh state announced.
- [ ] Step 2: Audit tabular-nums: ensure all metric spans have `font-variant-numeric: tabular-nums` via existing .stat-val/.value; add if missing for new delta spans.
- [ ] Step 3: Single accent audit: ensure only --accent used for primary actions/selection, not for every icon (reuse H1 token audit).
- [ ] Step 4: Run `go vet`, `node --check`, section/div count still 15/15 67/67, vet green, commit.

### Task H5aT4: Perf Budget + Tests Gate

**Files:**
- Modify: bench/perf_budget.md — add H5a target flat (no new providers, so Current H5a = Current H4)
- Modify: static/evidence_test.js — commit as harness

**Interfaces:** N/A
- [ ] Step 1: Update bench/perf_budget.md: add Current (H5a) column with same numbers as H4 (26 allocs, 3371 B, 1.82MB) — flat prove no regression.
- [ ] Step 2: Run `go test -bench=BenchmarkValidateEnvelope -benchmem` to confirm flat, `go test ./... -v` 13→15 PASS (adds evidence_test via node, not Go), commit.

