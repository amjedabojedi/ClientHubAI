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
