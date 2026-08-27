---
name: npm audit downgrade trap
description: Why current npm audit fix suggestions must be reviewed before applying them.
---

Do not automatically apply an npm audit “fix” when it proposes downgrading an already-current dependency.

**Why:** Some advisory metadata can mark a broad, newer version range while offering an older release as its only “fix.” This happened for the current Puppeteer and Drizzle tooling lines; accepting that recommendation would restore older transitive dependencies instead of resolving the issue.

**How to apply:** Compare the installed version, advisory range, and proposed version. Prefer an upstream patched release or removing/replacing the dependency; retain the current version and document an upstream no-safe-fix condition when the only remediation is a downgrade.