---
name: Multi-step wizard Next/Submit button morph causes accidental submit
description: Why a wizard's "Next" and final "Submit" must not share one JSX slot, and the safe pattern.
---

# Wizard "Next" vs final "Submit" must be distinct elements

In a multi-step form wizard, do NOT render the step-advance "Next" button and the
final submit button in the SAME JSX ternary slot where only the `type` differs
(`type="button"` ↔ `type="submit"`). React reconciles them to the SAME `<button>`
DOM node and mutates its `type` in place on the step change; the in-progress click
that advanced the step then lands on a now-`type="submit"` button and fires the
form submit — so clicking "Next" silently books/saves before the user reaches the
final step.

**Why:** observed in the scheduling new-session wizard — clicking Next into the
last step created the session with no final-button click.

**How to apply:** give the two buttons distinct `key`s so React mounts separate
nodes, AND make the final CTA `type="button"` with an explicit
`onClick={() => form.handleSubmit(onSubmit)()}` so no button can ever trigger an
implicit form submit. Keep a form-level `onSubmit` guard that `preventDefault()`s
unless on the final step (covers Enter on steps 1..n-1).
