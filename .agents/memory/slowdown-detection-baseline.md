---
name: Privacy-suite slow-down detector baseline
description: How the privacy test-suite slow-down regression detector must compute its baseline to avoid self-masking and false CI failures.
---

# Privacy-suite slow-down detector baseline

The `run-privacy-tests.sh` slow-down detector (logic in `scripts/lib/slowdown-detect.sh`)
flags suites whose runtime regresses. Two rules are load-bearing:

**Rule 1 — the baseline must EXCLUDE the most recent recorded run.**
Baseline = median of a suite's older durations, dropping the latest recorded entry.
**Why:** if the baseline includes the previous run, a single slow sample immediately
re-anchors the baseline upward and masks the very slow-down on the next run (the
classic counterexample: history `[10]`, then `20`, then `[10,20]` median `15` makes a
sustained `20` look like only +33% and it stops flagging). Excluding the latest sample
keeps the baseline anchored to known-good history.

**Rule 2 — only a SUSTAINED slow-down fails CI.**
Fail only when BOTH the current run and the most recent recorded run exceed the
threshold vs. the stable baseline; a lone slow run is a warning, never a failure.
**Why:** the shared CI machine has scheduling jitter; one-off slow runs were failing
`FAIL_ON_SLOWDOWN=1` builds with no real regression.

**How to apply:** keep a rolling window (currently 10) per suite; require a minimum
number of older baseline points (currently 3) before flagging so fresh checkouts never
false-fail; classify BEFORE appending the current run so it never pollutes its own
baseline. Deterministic tests live in `test/slowdown-detection.test.sh` and run first
inside the privacy runner.

**Rule 3 — the baseline must survive fresh/ephemeral checkouts (two layers).**
The rolling history file lives under `.local/` which is gitignored, so on an ephemeral
CI checkout it starts empty and the detector never accumulates a baseline — the CI
safety net effectively never fires. A committed baseline ALONE is not enough: confirming
a *sustained* slow-down needs the *previous run's* duration, and a cold-start seed always
makes "prev" look good, so a newly-introduced regression could only ever WARN. Fix is two
layers in `run-privacy-tests.sh`:
1. **Cross-run persistence via Replit Object Storage** (`scripts/privacy-history-store.ts`,
   key `ci/privacy-test-durations.json`): pull the previous run's history before
   classifying, push after a CLEAN run (failed runs never push, so they can't poison the
   store). This carries "prev" across independent fresh checkouts → run 1 WARNs, run 2
   FAILs. Disable with `PERSIST_HISTORY=0`.
2. **Cold-start seed** from TRACKED `scripts/privacy-test-baseline.json` when the store is
   empty/unavailable. `UPDATE_BASELINE=1` re-blesses it (clean runs only). Neither layer
   clobbers an already-populated local history.
**Why:** without persisted prev, `FAIL_ON_SLOWDOWN=1` in CI can never escalate a new
sustained slow-down past a warning. Verified by `test/privacy-baseline-persistence.test.sh`
(simulates two fresh checkouts sharing a store; runs first in the privacy runner).

**Rule 4 — auto-refreshing the committed baseline must NEVER absorb a real regression.**
`AUTO_UPDATE_BASELINE=1` (enabled in the CI `test-privacy` workflow) rolls the committed
`scripts/privacy-test-baseline.json` forward from the rolling history so it doesn't drift
stale and emit false warnings. The gate (`sd_baseline_refresh_mode` in the lib) is the
load-bearing part: AUTO refreshes ONLY when no suite failed AND `SLOWDOWN_DETECTED=0`, so a
sustained slow-down is skipped (and fails CI under `FAIL_ON_SLOWDOWN`) instead of being
silently baked into the baseline. Manual `UPDATE_BASELINE=1` is the deliberate opposite — it
re-blesses even on a slow-down (that is its purpose), and takes precedence over AUTO.
**Why:** an auto-refresh that absorbed regressions would defeat the whole detector. The
copy (`sd_refresh_baseline_if_changed`) compares only `.suites` (not the per-run `updated`
timestamp) so it only rewrites on real number changes — no commit churn. Verified by
`test/baseline-refresh.test.sh` (runs first in the privacy runner).
