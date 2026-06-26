---
name: Running browser tests locally vs the test-privacy workflow
description: How to actually get one clean run of a single privacy/browser tsx test on this box without OOM, stale-tsx confusion, or self-killing the shell.
---

# Running a single privacy/browser test locally

Hard-won environment facts (cost many wasted cycles):

- **Background processes die when the bash tool call returns.** `nohup` and even
  `setsid` do NOT keep an ad-hoc process alive across tool calls — only managed
  *workflows* survive. A detached test is alive during the launching command and
  gone by the next one (its log shows only the lines printed in those first few
  seconds, then nothing). Don't trust a poll in a later call; the process is dead.
- **Run the test synchronously, in the foreground, in one command.** A single
  browser test (~90–110s) fits under the bash 120s cap **only when isolated** (no
  competing suite). Tee to a file (`> /tmp/x.log 2>&1; echo EXIT=$?`) so a timeout
  still leaves readable progress.
- **`test-privacy` competes and causes OOM.** It runs the full suite (two extra
  dev servers + chromium). Two heavy browser suites at once get one SIGKILLed
  (empty/truncated log, no error written). Stop it before an isolated run. It is
  the authoritative serial validation, so it WILL run your test anyway on
  mark_task_complete.
- **`pkill -f PATTERN` self-kills the shell (exit 143/137).** `pkill -f` matches
  the *full command line* of every process, INCLUDING the shell running the pkill
  (whose command line literally contains PATTERN) and your own launch command if
  it contains the substring. Use the bracket trick so the literal doesn't match
  itself: `pkill -f 'run-priv[a]cy-tests'`, `pkill -f 'chrom[e]-linux'`,
  `pkill -f 'head[l]ess'`. Never `pkill -f "tsx test/"` in a command that also
  launches a tsx test.

**Reliable recipe for one isolated run:**
```
pkill -f 'run-priv[a]cy-tests'; pkill -f 'chrom[e]-linux'; pkill -f 'head[l]ess'; sleep 3
rm -rf /tmp/tsx-1000
npx tsx test/<the-test>.test.ts > /tmp/run.log 2>&1; echo "EXIT=$?"
```
Then restart the `test-privacy` workflow afterwards to leave it healthy.
