---
name: Running long browser tests in this environment
description: Why puppeteer/dev-server tests can't be run via the bash tool and must use a temporary console workflow.
---

# Long-running browser tests must run via a workflow, not bash

Browser tests here spawn their own dev server (`startDevServer` in
`test/helpers/browser.ts`) whose first Vite compile plus the Chromium run easily
exceeds the bash tool's hard 120s ceiling, so a synchronous `npx tsx test/X.test.ts`
gets killed mid-run with no output.

**Also:** each bash invocation is its own sandbox — `/tmp` is NOT shared between
calls and backgrounded processes (`nohup ... &`) are killed when the call returns.
So the "background + poll the log file" trick does not work either.

**Why:** the bash tool isolates per-call and caps at 120s; the dev server needs
longer and its log/process don't survive the call boundary.

**How to apply:** run the test through a temporary console workflow instead:
`configureWorkflow({name, command:"npx tsx test/X.test.ts", outputType:"console", autoStart:true})`,
poll `getWorkflowStatus({name})` until `state !== "running"`, read `.output`, then
`removeWorkflow({name})`. To wire a test into CI it must join the `test-privacy`
workflow's `&&` chain; `.replit` is not directly editable, so append via
`configureWorkflow({name:"test-privacy", command: existing + " && npx tsx test/X.test.ts"})`.
