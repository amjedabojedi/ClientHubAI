---
name: Notification recipient-rule gotchas (driver)
description: Which notificationTriggers.recipientRules paths actually resolve recipients under the Neon driver, and the latent specificUsers bug.
---

# calculateRecipients recipient-rule gotchas

`NotificationService.calculateRecipients` resolves a trigger's JSON
`recipientRules` to a `User[]`. The whole method is wrapped in a try/catch that
returns `[]` on ANY error — so a throw in one branch silently yields ZERO
recipients (no email, no in-app), with only a swallowed console log.

**Latent bug:** the `specificUsers` branch builds
`sql\`${users.id} = ANY(${recipientRules.specificUsers})\``. Under the Neon
serverless driver this throws (`The "string" argument must be of type
string ... Received type number`) — the array param isn't bound as a pg array.
So `specificUsers` recipient rules resolve to nobody. Not yet fixed (out of
scope when discovered); if a trigger relies on `specificUsers` and "no
notification is sent," this is why.

**How to apply:** when seeding a trigger in a test (or wiring a real one) and you
need a deterministic single recipient, prefer `assignedTherapist: true` with
`entityData.therapistId` (uses a plain `eq(users.id, …)`, works fine) or
`roles: [...]`. Avoid `specificUsers` until the ANY bind is fixed.
`sessionClient: true` needs `entityData.clientId` and the client row to have
`emailNotifications` truthy + a non-null `email`.
