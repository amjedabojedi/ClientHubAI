#!/usr/bin/env bash
#
# Pure, side-effect-free helpers for the privacy-suite slow-down detector,
# plus thin history read/append helpers that take the history file as an
# explicit argument. Kept separate from run-privacy-tests.sh so the detection
# logic can be unit-tested deterministically (see test/slowdown-detection.test.sh)
# without running the real test suite.
#
# Detection design (why it is robust to one-off noise):
#   - A suite's history is a rolling list of its most recent durations.
#   - The BASELINE a run is judged against is the MEDIAN of the OLDER part of
#     that history — explicitly EXCLUDING the most recent recorded run. This
#     matters: if the baseline included the previous run, a single slow sample
#     would immediately re-anchor the baseline upward and mask the very
#     slow-down we are trying to catch on the next run.
#   - A slow-down is only a FAILURE when it is SUSTAINED: both the current run
#     (now) AND the most recent recorded run (prev) must exceed the threshold
#     relative to that stable older baseline. A single noisy run trips only
#     "now", so it is a WARNING, never a failure.
#   - A minimum number of older baseline points is required before anything is
#     flagged, so early runs on a fresh checkout never produce false failures.

# Median (whole seconds) of the numbers read from stdin. Empty stdin prints
# nothing. For an even count we average the two middle values and round.
median() {
  sort -n | awk '
    { a[NR] = $1 }
    END {
      if (NR == 0) exit
      if (NR % 2 == 1) print a[(NR + 1) / 2]
      else printf "%d\n", (a[NR / 2] + a[NR / 2 + 1]) / 2 + 0.5
    }'
}

# is_slower NOW BASE THRESHOLD
# Exit 0 (true) when NOW is more than THRESHOLD (a fraction, e.g. 0.5) slower
# than BASE. False for non-positive BASE.
is_slower() {
  awk -v now="$1" -v base="$2" -v t="$3" \
    'BEGIN { exit !(base > 0 && (now - base) / base > t) }'
}

# classify_run BASELINE PREV NOW MIN_SECONDS THRESHOLD
# Echoes one of: OK | WARN | FAIL
#   OK   — not slow (or too fast to judge / no usable baseline)
#   WARN — this run is slow but the previous recorded run was not (one-off)
#   FAIL — this run AND the previous recorded run are both slow (sustained)
classify_run() {
  local baseline=$1 prev=$2 now=$3 min=$4 t=$5
  { [ -n "${baseline}" ] && [ "${baseline}" -gt 0 ]; } 2>/dev/null || { echo "OK"; return; }
  [ "${now}" -ge "${min}" ] 2>/dev/null || { echo "OK"; return; }
  is_slower "${now}" "${baseline}" "${t}" || { echo "OK"; return; }
  if is_slower "${prev}" "${baseline}" "${t}"; then
    echo "FAIL"
  else
    echo "WARN"
  fi
}

# sd_history_read FILE SUITE
# Echoes a suite's recorded durations (oldest first), one per line. Handles
# both the rolling-list format and the legacy single-number format. Empty
# output means no baseline yet. Requires jq.
sd_history_read() {
  local file=$1 suite=$2
  if [ -f "${file}" ]; then
    jq -r --arg s "${suite}" \
      '.suites[$s] // empty | if type == "array" then .[] else . end' \
      "${file}" 2>/dev/null
  fi
}

# sd_history_append FILE SUITE DURATION WINDOW
# Appends DURATION to SUITE's rolling list in FILE, capping to the last WINDOW
# entries. Upgrades legacy single-number entries to lists transparently and
# leaves other suites untouched. Requires jq.
sd_history_append() {
  local file=$1 suite=$2 duration=$3 window=$4
  local existing='{}'
  [ -f "${file}" ] && existing="$(cat "${file}")"
  mkdir -p "$(dirname "${file}")"
  printf '%s' "${existing}" | jq \
    --arg s "${suite}" \
    --argjson d "${duration}" \
    --argjson n "${window}" \
    --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
    (.suites // {}) as $old
    | { updated: $updated,
        suites: ($old | .[$s] = (
          (($old[$s] // []) | if type == "array" then . else [.] end)
          + [$d] | .[-$n:]
        ))
      }
  ' > "${file}"
}

# sd_evaluate FILE SUITE NOW MIN_SECONDS THRESHOLD MIN_BASELINE_POINTS
# Reads SUITE's history from FILE, derives the stable baseline (median of the
# history EXCLUDING the most recent recorded run), and classifies NOW.
# Echoes: "VERDICT|BASELINE|PREV|PCT"
#   VERDICT  — OK | WARN | FAIL (see classify_run)
#   BASELINE — median seconds the run was judged against (empty if none)
#   PREV     — most recent recorded duration (empty if none)
#   PCT      — integer percent NOW is above BASELINE (0 if no baseline)
# A baseline is only used when there are at least MIN_BASELINE_POINTS older
# entries (i.e. excluding the most recent recorded run), so early runs never
# produce a spurious verdict.
sd_evaluate() {
  local file=$1 suite=$2 now=$3 min=$4 t=$5 minbase=$6
  local vals prev baseline_vals baseline_count baseline pct verdict

  vals="$(sd_history_read "${file}" "${suite}")"
  [ -n "${vals}" ] || { echo "OK|||0"; return; }

  # prev = most recent recorded run; baseline window = everything before it.
  prev="$(printf '%s\n' "${vals}" | tail -n 1)"
  baseline_vals="$(printf '%s\n' "${vals}" | sed '$d')"
  baseline_count="$(printf '%s\n' "${baseline_vals}" | grep -c .)"

  if [ "${baseline_count}" -lt "${minbase}" ]; then
    echo "OK||${prev}|0"
    return
  fi

  baseline="$(printf '%s\n' "${baseline_vals}" | median)"
  verdict="$(classify_run "${baseline}" "${prev}" "${now}" "${min}" "${t}")"
  pct="$(awk -v now="${now}" -v base="${baseline}" \
    'BEGIN { if (base > 0) printf "%d", ((now - base) / base) * 100; else printf "0" }')"
  echo "${verdict}|${baseline}|${prev}|${pct}"
}

# sd_baseline_refresh_mode FAILED_COUNT SLOWDOWN_DETECTED UPDATE_BASELINE AUTO_UPDATE_BASELINE
# Decides whether (and how) the committed cold-start baseline should be rolled
# forward from this run's rolling history. Echoes one of:
#   UPDATE — manual, deliberate re-bless (UPDATE_BASELINE=1, no suite failed);
#            absorbs this run's numbers even if they tripped a slow-down, because
#            re-blessing is an explicit "accept the new runtime" action.
#   AUTO   — automatic roll-forward on a fully GREEN run (AUTO_UPDATE_BASELINE=1,
#            no suite failed AND no slow-down detected). The slow-down gate is
#            the safety net: a sustained slow-down yields NONE here, so it is
#            never silently absorbed and (under FAIL_ON_SLOWDOWN) fails the run.
#   NONE   — do not refresh.
# A failed suite ALWAYS yields NONE — a broken run must never write the baseline.
# UPDATE takes precedence over AUTO when both are requested.
sd_baseline_refresh_mode() {
  local failed=$1 slowdown=$2 update=$3 auto=$4
  [ "${failed}" -eq 0 ] 2>/dev/null || { echo "NONE"; return; }
  if [ "${update}" -eq 1 ] 2>/dev/null; then
    echo "UPDATE"
    return
  fi
  if [ "${auto}" -eq 1 ] 2>/dev/null && [ "${slowdown}" -eq 0 ] 2>/dev/null; then
    echo "AUTO"
    return
  fi
  echo "NONE"
}

# sd_refresh_baseline_if_changed HISTORY_FILE BASELINE_FILE
# Copies HISTORY_FILE -> BASELINE_FILE, but only when the per-suite numbers
# actually differ (the rolling history's `updated` timestamp changes every run,
# so a plain copy would always produce a diff/commit). Echoes:
#   REFRESHED — the committed baseline was rewritten.
#   NOCHANGE  — the committed baseline already matched; left untouched.
#   SKIP      — no rolling history to copy from.
# Always returns 0. Requires jq.
sd_refresh_baseline_if_changed() {
  local history=$1 baseline=$2
  [ -f "${history}" ] || { echo "SKIP"; return 0; }
  if [ -f "${baseline}" ] \
    && cmp -s \
      <(jq -S '.suites // {}' "${history}" 2>/dev/null) \
      <(jq -S '.suites // {}' "${baseline}" 2>/dev/null); then
    echo "NOCHANGE"
    return 0
  fi
  cp "${history}" "${baseline}"
  echo "REFRESHED"
}
